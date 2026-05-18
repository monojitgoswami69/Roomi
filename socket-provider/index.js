const express = require("express");
const { createServer } = require("http");
const { Server } = require("socket.io");

const port = Number(process.env.PORT ?? 4001);
const corsOrigin = process.env.CORS_ORIGIN ?? "http://127.0.0.1:3000";

function parseCorsOrigins(value) {
  return value
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

const CODE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const ROOM_TTL_MS = 12 * 60 * 60 * 1000;

const rooms = new Map();
const queueAddedAt = new Map();

function normalizeRoomCode(value) {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

function now() {
  return Date.now();
}

function touchRoom(room) {
  room.lastActivity = now();
}

function getQueueOrder(code) {
  if (!queueAddedAt.has(code)) {
    queueAddedAt.set(code, new Map());
  }
  return queueAddedAt.get(code);
}

function generateCode() {
  let code = "";
  do {
    code = "";
    for (let index = 0; index < 6; index += 1) {
      code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    }
  } while (rooms.has(code));
  return code;
}

function getRoom(code) {
  return rooms.get(normalizeRoomCode(code));
}

function createRoom({ hostId, accessToken, refreshToken }) {
  const code = generateCode();
  const room = {
    code,
    hostId,
    accessToken,
    refreshToken,
    deviceId: "",
    access: "open",
    queue: [],
    currentTrack: null,
    guests: {},
    pendingGuests: {},
    createdAt: now(),
    lastActivity: now(),
  };
  rooms.set(code, room);
  queueAddedAt.set(code, new Map());
  return room;
}

function deleteRoom(code) {
  const normalized = normalizeRoomCode(code);
  rooms.delete(normalized);
  queueAddedAt.delete(normalized);
}

function sortQueue(code) {
  const room = getRoom(code);
  if (!room) return;
  const order = getQueueOrder(room.code);
  room.queue.sort((a, b) => {
    if (a.score !== b.score) {
      return b.score - a.score;
    }

    const aAddedAt = order.get(a.track.id) ?? Number.MAX_SAFE_INTEGER;
    const bAddedAt = order.get(b.track.id) ?? Number.MAX_SAFE_INTEGER;
    return aAddedAt - bAddedAt;
  });
}

function toPublicQueueItem(item, viewerId) {
  return {
    track: item.track,
    upvotes: item.upvotes,
    downvotes: item.downvotes,
    score: item.score,
    voters: item.voters,
    myVote: viewerId ? item.voters[viewerId] ?? null : null,
    voteCount: item.upvotes - item.downvotes,
  };
}

function buildPublicRoomState(room, viewerId) {
  return {
    roomCode: room.code,
    hostId: room.hostId,
    accessToken: room.accessToken,
    refreshToken: room.refreshToken,
    deviceId: room.deviceId,
    queue: room.queue.map((item) => toPublicQueueItem(item, viewerId)),
    currentTrack: room.currentTrack,
    guests: room.guests,
    pendingGuests: room.pendingGuests,
    guestCount: Object.keys(room.guests).length,
    access: room.access,
  };
}

function emitRoomUpdated(io, code) {
  const room = getRoom(code);
  if (!room) return;
  io.sockets.sockets.forEach((roomSocket) => {
    if (!roomSocket.rooms.has(room.code)) return;
    roomSocket.emit("room-updated", buildPublicRoomState(room, roomSocket.data?.guestId));
  });
}

function isTrackInUse(code, trackId) {
  const room = getRoom(code);
  if (!room) return false;
  if (room.currentTrack && room.currentTrack.id === trackId) return true;
  return room.queue.some((item) => item.track.id === trackId);
}

function canInteractInRoom(code, guestId) {
  const room = getRoom(code);
  if (!room) return false;
  return guestId === room.hostId || Boolean(room.guests[guestId]);
}

function requestGuestAccess(code, guestId, displayName) {
  const room = getRoom(code);
  if (!room) return "missing";
  if (room.guests[guestId]) {
    touchRoom(room);
    return "approved";
  }
  if (room.access === "open") {
    room.guests[guestId] = displayName;
    delete room.pendingGuests[guestId];
    touchRoom(room);
    return "approved";
  }
  room.pendingGuests[guestId] = displayName;
  touchRoom(room);
  return "pending";
}

function approvePendingGuest(code, guestId) {
  const room = getRoom(code);
  if (!room) return;
  const displayName = room.pendingGuests[guestId];
  if (!displayName) return;
  room.guests[guestId] = displayName;
  delete room.pendingGuests[guestId];
  touchRoom(room);
}

function rejectPendingGuest(code, guestId) {
  const room = getRoom(code);
  if (!room) return;
  delete room.pendingGuests[guestId];
  touchRoom(room);
}

function removeGuest(code, guestId) {
  const room = getRoom(code);
  if (!room) return;
  delete room.guests[guestId];
  touchRoom(room);
}

function setRoomAccess(code, access) {
  const room = getRoom(code);
  if (!room) return;
  room.access = access;
  if (access === "open") {
    for (const [guestId, displayName] of Object.entries(room.pendingGuests)) {
      room.guests[guestId] = displayName;
    }
    room.pendingGuests = {};
  }
  touchRoom(room);
}

function addToQueue(code, item) {
  const room = getRoom(code);
  if (!room) return;
  room.queue.push(item);
  getQueueOrder(room.code).set(item.track.id, now());
  sortQueue(room.code);
  touchRoom(room);
}

function vote(code, trackId, guestId, voteValue) {
  const room = getRoom(code);
  if (!room) return [];
  const item = room.queue.find((entry) => entry.track.id === trackId);
  if (!item) return room.queue;

  const currentVote = item.voters[guestId];
  if (currentVote === voteValue) {
    if (voteValue === "up") item.upvotes = Math.max(0, item.upvotes - 1);
    else item.downvotes = Math.max(0, item.downvotes - 1);
    delete item.voters[guestId];
  } else if (currentVote === "up" && voteValue === "down") {
    item.upvotes = Math.max(0, item.upvotes - 1);
    item.downvotes += 1;
    item.voters[guestId] = "down";
  } else if (currentVote === "down" && voteValue === "up") {
    item.downvotes = Math.max(0, item.downvotes - 1);
    item.upvotes += 1;
    item.voters[guestId] = "up";
  } else {
    if (voteValue === "up") item.upvotes += 1;
    else item.downvotes += 1;
    item.voters[guestId] = voteValue;
  }

  item.score = item.upvotes - item.downvotes;
  sortQueue(room.code);
  touchRoom(room);
  return room.queue;
}

function removeTracks(code, trackIds) {
  const room = getRoom(code);
  if (!room) return;
  const trackIdSet = new Set(trackIds);
  room.queue = room.queue.filter((item) => !trackIdSet.has(item.track.id));
  const order = getQueueOrder(room.code);
  trackIds.forEach((trackId) => order.delete(trackId));
  touchRoom(room);
}

function setCurrentTrack(code, track) {
  const room = getRoom(code);
  if (!room) return;
  room.currentTrack = track;
  touchRoom(room);
}

function setDeviceId(code, deviceId) {
  const room = getRoom(code);
  if (!room) return;
  room.deviceId = deviceId;
  touchRoom(room);
}

function setRoomAccessToken(code, accessToken) {
  const room = getRoom(code);
  if (!room) return;
  room.accessToken = accessToken;
  touchRoom(room);
}

function cleanupExpiredRooms() {
  const current = now();
  for (const [code, room] of rooms.entries()) {
    if (current - room.lastActivity > ROOM_TTL_MS) {
      rooms.delete(code);
      queueAddedAt.delete(code);
    }
  }
}

setInterval(cleanupExpiredRooms, 30 * 60 * 1000);

const app = express();
app.use(express.json({ limit: "1mb" }));

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: parseCorsOrigins(corsOrigin),
    methods: ["GET", "POST"],
  },
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/rooms", (req, res) => {
  const hostId = typeof req.body?.hostId === "string" ? req.body.hostId.trim() : "";
  const accessToken = typeof req.body?.accessToken === "string" ? req.body.accessToken.trim() : "";
  const refreshToken = typeof req.body?.refreshToken === "string" ? req.body.refreshToken.trim() : "";
  if (!hostId || !accessToken || !refreshToken) {
    res.status(400).json({ error: "hostId, accessToken, and refreshToken are required" });
    return;
  }
  const room = createRoom({ hostId, accessToken, refreshToken });
  res.json({ roomCode: room.code, code: room.code });
});

app.get("/api/rooms/:roomCode", (req, res) => {
  const room = getRoom(req.params.roomCode);
  if (!room) {
    res.status(404).json({ error: "Room not found" });
    return;
  }
  const viewerId = typeof req.query.viewerId === "string" ? req.query.viewerId.trim() : undefined;
  res.json(buildPublicRoomState(room, viewerId));
});

app.delete("/api/rooms/:roomCode", (req, res) => {
  deleteRoom(req.params.roomCode);
  res.json({ ok: true });
});

app.post("/api/rooms/join", (req, res) => {
  const roomCode = normalizeRoomCode(req.body?.roomCode);
  const guestId = typeof req.body?.guestId === "string" ? req.body.guestId.trim() : "";
  const displayName = typeof req.body?.displayName === "string" ? req.body.displayName.trim() || "Guest" : "Guest";
  const room = getRoom(roomCode);
  if (!room) {
    res.status(404).json({ error: "Room not found" });
    return;
  }
  const status = requestGuestAccess(roomCode, guestId, displayName);
  emitRoomUpdated(io, roomCode);
  res.json({ status, roomCode, state: buildPublicRoomState(room, guestId) });
});

app.post("/api/rooms/disconnect", (req, res) => {
  const roomCode = normalizeRoomCode(req.body?.roomCode);
  const guestId = typeof req.body?.guestId === "string" ? req.body.guestId.trim() : "";
  const isHost = Boolean(req.body?.isHost);
  if (!roomCode || !guestId) {
    res.status(400).json({ error: "roomCode and guestId are required" });
    return;
  }
  if (!isHost) removeGuest(roomCode, guestId);
  emitRoomUpdated(io, roomCode);
  res.json({ ok: true });
});

app.post("/api/rooms/:roomCode/device", (req, res) => {
  const roomCode = normalizeRoomCode(req.params.roomCode);
  const deviceId = typeof req.body?.deviceId === "string" ? req.body.deviceId.trim() : "";
  if (!deviceId) {
    res.status(400).json({ error: "deviceId is required" });
    return;
  }
  setDeviceId(roomCode, deviceId);
  res.json({ ok: true });
});

app.post("/api/rooms/:roomCode/token", (req, res) => {
  const roomCode = normalizeRoomCode(req.params.roomCode);
  const accessToken = typeof req.body?.accessToken === "string" ? req.body.accessToken.trim() : "";
  if (!accessToken) {
    res.status(400).json({ error: "accessToken is required" });
    return;
  }
  setRoomAccessToken(roomCode, accessToken);
  res.json({ ok: true });
});

app.post("/api/rooms/:roomCode/access", (req, res) => {
  const roomCode = normalizeRoomCode(req.params.roomCode);
  const access = req.body?.access;
  if (access !== "open" && access !== "locked") {
    res.status(400).json({ error: "Invalid access setting" });
    return;
  }
  setRoomAccess(roomCode, access);
  emitRoomUpdated(io, roomCode);
  res.json({ ok: true });
});

app.post("/api/rooms/:roomCode/guests", (req, res) => {
  const roomCode = normalizeRoomCode(req.params.roomCode);
  const guestId = typeof req.body?.guestId === "string" ? req.body.guestId.trim() : "";
  const intent = req.body?.intent;
  if (!guestId) {
    res.status(400).json({ error: "guestId is required" });
    return;
  }
  if (intent === "approve-guest") approvePendingGuest(roomCode, guestId);
  else if (intent === "reject-guest") rejectPendingGuest(roomCode, guestId);
  else if (intent === "kick-guest") {
    rejectPendingGuest(roomCode, guestId);
    removeGuest(roomCode, guestId);
  } else {
    res.status(400).json({ error: "Invalid intent" });
    return;
  }
  emitRoomUpdated(io, roomCode);
  res.json({ ok: true });
});

app.post("/api/rooms/:roomCode/queue", (req, res) => {
  const roomCode = normalizeRoomCode(req.params.roomCode);
  const guestId = typeof req.body?.guestId === "string" ? req.body.guestId.trim() : "";
  const track = req.body?.track;
  const room = getRoom(roomCode);
  if (!room) {
    res.status(404).json({ error: "Room not found" });
    return;
  }
  if (!guestId || !track?.id || !track?.uri || !track?.title) {
    res.status(400).json({ error: "Invalid queue payload" });
    return;
  }
  if (!canInteractInRoom(roomCode, guestId)) {
    res.status(403).json({ error: "Guest not approved for this room" });
    return;
  }
  if (isTrackInUse(roomCode, track.id)) {
    res.status(409).json({ error: "Track already in queue or playing" });
    return;
  }

  const queueItem = {
    track: { ...track, addedBy: guestId },
    upvotes: 1,
    downvotes: 0,
    score: 1,
    voters: { [guestId]: "up" },
  };
  addToQueue(roomCode, queueItem);
  const autoPlayTrack = room.currentTrack === null && room.queue.length === 1 ? queueItem.track : null;
  emitRoomUpdated(io, roomCode);
  res.json({ ok: true, autoPlayTrack, state: buildPublicRoomState(room, guestId) });
});

app.post("/api/rooms/:roomCode/vote", (req, res) => {
  const roomCode = normalizeRoomCode(req.params.roomCode);
  const guestId = typeof req.body?.guestId === "string" ? req.body.guestId.trim() : "";
  const trackId = typeof req.body?.trackId === "string" ? req.body.trackId.trim() : "";
  const voteValue = req.body?.vote;
  if (!guestId || !trackId || (voteValue !== "up" && voteValue !== "down")) {
    res.status(400).json({ error: "Invalid vote payload" });
    return;
  }
  if (!canInteractInRoom(roomCode, guestId)) {
    res.status(403).json({ error: "Guest not approved for this room" });
    return;
  }
  vote(roomCode, trackId, guestId, voteValue);
  const room = getRoom(roomCode);
  emitRoomUpdated(io, roomCode);
  res.json(room ? buildPublicRoomState(room, guestId) : { queue: [] });
});

app.post("/api/rooms/:roomCode/current", (req, res) => {
  const roomCode = normalizeRoomCode(req.params.roomCode);
  setCurrentTrack(roomCode, req.body?.track ?? null);
  emitRoomUpdated(io, roomCode);
  res.json({ ok: true });
});

app.post("/api/rooms/:roomCode/queue/remove", (req, res) => {
  const roomCode = normalizeRoomCode(req.params.roomCode);
  const trackIds = Array.isArray(req.body?.trackIds) ? req.body.trackIds.map((value) => String(value)) : [];
  removeTracks(roomCode, trackIds);
  emitRoomUpdated(io, roomCode);
  res.json({ ok: true });
});

io.on("connection", (socket) => {
  socket.on("join-room", (payload) => {
    const roomCode = normalizeRoomCode(payload?.roomCode);
    const guestId = typeof payload?.guestId === "string" ? payload.guestId.trim() : "";
    const displayName = typeof payload?.displayName === "string" ? payload.displayName.trim() || "Guest" : "Guest";
    const room = getRoom(roomCode);
    if (!room || !guestId) return;

    const isHost = guestId === room.hostId;
    let joinState = "approved";
    if (!isHost) {
      joinState = requestGuestAccess(room.code, guestId, displayName);
      if (joinState === "missing") return;
    }

    socket.data.roomCode = room.code;
    socket.data.guestId = guestId;
    socket.join(room.code);
    socket.emit("room-join-status", { status: joinState });
    socket.emit("room-updated", buildPublicRoomState(room, guestId));
    emitRoomUpdated(io, room.code);
  });
});

httpServer.listen(port, () => {
  console.log(`Socket provider listening on http://127.0.0.1:${port}`);
});
