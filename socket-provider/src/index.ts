import express from "express";
import { createServer } from "http";
import { Server, type Socket } from "socket.io";

type Vote = "up" | "down";

type Track = {
  id: string;
  uri: string;
  title: string;
  artist: string;
  albumArt: string;
  durationMs: number;
  addedBy: string;
};

type QueueItem = {
  track: Track;
  upvotes: number;
  downvotes: number;
  score: number;
  voters: Record<string, Vote>;
};

type PlaybackState = {
  isPlaying: boolean;
  startedAtTimestamp: number;
  startedAtPosition: number;
  pausedAtPosition: number;
  duration: number;
  track: Track | null;
};

type Room = {
  roomCode: string;
  hostId: string;
  accessToken: string;
  refreshToken: string;
  deviceId: string;
  access: "open" | "locked";
  queue: QueueItem[];
  currentTrack: Track | null;
  playback: PlaybackState;
  guests: Record<string, string>;
  pendingGuests: Record<string, string>;
  createdAt: number;
  lastActivity: number;
};

type PresenceEntry = {
  displayName: string;
  isHost: boolean;
  sockets: Set<string>;
  connectedAt: number;
  lastSeenAt: number;
};

type PublicQueueItem = QueueItem & {
  myVote: Vote | null;
  voteCount: number;
};

type PublicRoomState = {
  roomCode: string;
  hostId: string;
  accessToken?: string;
  refreshToken?: string;
  deviceId?: string;
  queue: PublicQueueItem[];
  currentTrack: Track | null;
  playback: PlaybackState;
  guests: Record<string, string>;
  pendingGuests: Record<string, string>;
  guestCount: number;
  access: "open" | "locked";
};

type SocketAck = {
  ok?: boolean;
  error?: string;
  status?: "approved" | "pending";
  state?: PublicRoomState;
};

type RoomConnectionData = {
  roomCode?: string;
  guestId?: string;
  displayName?: string;
  isHost?: boolean;
};

type SpotifyTokenResponse = {
  access_token: string;
};

const PORT = Number(process.env.PORT ?? 4001);
const ROOM_TTL_MS = 12 * 60 * 60 * 1000;
const TRACK_END_GUARD_MS = 2000;
const STALE_SOCKET_MS = 30000;
const CODE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const corsOrigins = (process.env.CORS_ORIGIN ?? "http://127.0.0.1:3000")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const rooms = new Map<string, Room>();
const queueAddedAt = new Map<string, Map<string, number>>();
const presence = new Map<string, Map<string, PresenceEntry>>();
const socketConnections = new Map<string, { roomCode: string; guestId: string; isHost: boolean }>();
const nextTrackLocks = new Map<string, boolean>();

function now(): number {
  return Date.now();
}

function normalizeRoomCode(value: unknown): string {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

function trimString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() || fallback : fallback;
}

function getRoom(code: string): Room | undefined {
  return rooms.get(normalizeRoomCode(code));
}

function touchRoom(room: Room): void {
  room.lastActivity = now();
}

function getQueueOrder(code: string): Map<string, number> {
  const normalized = normalizeRoomCode(code);
  if (!queueAddedAt.has(normalized)) {
    queueAddedAt.set(normalized, new Map<string, number>());
  }
  return queueAddedAt.get(normalized)!;
}

function getPresenceMap(code: string): Map<string, PresenceEntry> {
  const normalized = normalizeRoomCode(code);
  if (!presence.has(normalized)) {
    presence.set(normalized, new Map<string, PresenceEntry>());
  }
  return presence.get(normalized)!;
}

function generateCode(): string {
  let code = "";
  do {
    code = "";
    for (let index = 0; index < 6; index += 1) {
      code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    }
  } while (rooms.has(code));
  return code;
}

function createRoom(input: { hostId: string; accessToken: string; refreshToken: string }): Room {
  const roomCode = generateCode();
  const playback: PlaybackState = {
    isPlaying: false,
    startedAtTimestamp: 0,
    startedAtPosition: 0,
    pausedAtPosition: 0,
    duration: 0,
    track: null,
  };
  const room: Room = {
    roomCode,
    hostId: input.hostId,
    accessToken: input.accessToken,
    refreshToken: input.refreshToken,
    deviceId: "",
    access: "open",
    queue: [],
    currentTrack: null,
    playback,
    guests: {},
    pendingGuests: {},
    createdAt: now(),
    lastActivity: now(),
  };
  rooms.set(roomCode, room);
  queueAddedAt.set(roomCode, new Map<string, number>());
  presence.set(roomCode, new Map<string, PresenceEntry>());
  nextTrackLocks.set(roomCode, false);
  return room;
}

function deleteRoom(code: string): void {
  const normalized = normalizeRoomCode(code);
  rooms.delete(normalized);
  queueAddedAt.delete(normalized);
  presence.delete(normalized);
  nextTrackLocks.delete(normalized);
}

function sortQueue(room: Room): void {
  const order = getQueueOrder(room.roomCode);
  room.queue.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    const aAddedAt = order.get(a.track.id) ?? Number.MAX_SAFE_INTEGER;
    const bAddedAt = order.get(b.track.id) ?? Number.MAX_SAFE_INTEGER;
    return aAddedAt - bAddedAt;
  });
}

function toPublicQueueItem(item: QueueItem, viewerId?: string): PublicQueueItem {
  return {
    ...item,
    myVote: viewerId ? item.voters[viewerId] ?? null : null,
    voteCount: item.upvotes - item.downvotes,
  };
}

function getLiveGuestCount(room: Room): number {
  return Object.keys(getLiveGuests(room)).length;
}

function getLiveGuests(room: Room): Record<string, string> {
  const roomPresence = presence.get(room.roomCode);
  if (!roomPresence) return {};
  const liveGuests: Record<string, string> = {};
  for (const [guestId, displayName] of Object.entries(room.guests)) {
    if (guestId === room.hostId) continue;
    const entry = roomPresence.get(guestId);
    if (entry?.sockets.size) {
      liveGuests[guestId] = displayName;
    }
  }
  return liveGuests;
}

function buildPublicRoomState(room: Room, viewerId?: string): PublicRoomState {
  return {
    roomCode: room.roomCode,
    hostId: room.hostId,
    accessToken: room.accessToken,
    refreshToken: room.refreshToken,
    deviceId: room.deviceId,
    queue: room.queue.map((item) => toPublicQueueItem(item, viewerId)),
    currentTrack: room.currentTrack,
    playback: room.playback,
    guests: getLiveGuests(room),
    pendingGuests: room.pendingGuests,
    guestCount: getLiveGuestCount(room),
    access: room.access,
  };
}

function emitRoomUpdated(io: Server, roomCode: string): void {
  const room = getRoom(roomCode);
  if (!room) return;
  for (const socket of io.sockets.sockets.values()) {
    if (socket.data.roomCode !== room.roomCode) continue;
    socket.emit("room-updated", buildPublicRoomState(room, socket.data.guestId));
  }
}

function emitPlaybackState(io: Server, room: Room, event: "playback:state" | "playback:started" | "playback:error", payload: unknown): void {
  io.to(room.roomCode).emit(event, payload);
}

function canInteractInRoom(room: Room, guestId: string): boolean {
  return guestId === room.hostId || Boolean(room.guests[guestId]);
}

function requestGuestAccess(room: Room, guestId: string, displayName: string): "approved" | "pending" {
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

function approvePendingGuest(room: Room, guestId: string): void {
  const displayName = room.pendingGuests[guestId];
  if (!displayName) return;
  room.guests[guestId] = displayName;
  delete room.pendingGuests[guestId];
  touchRoom(room);
}

function rejectPendingGuest(room: Room, guestId: string): void {
  delete room.pendingGuests[guestId];
  touchRoom(room);
}

function removeGuest(room: Room, guestId: string): void {
  delete room.guests[guestId];
  touchRoom(room);
}

function setRoomAccess(room: Room, access: "open" | "locked"): void {
  room.access = access;
  if (access === "open") {
    for (const [guestId, displayName] of Object.entries(room.pendingGuests)) {
      room.guests[guestId] = displayName;
    }
    room.pendingGuests = {};
  }
  touchRoom(room);
}

function addToQueue(room: Room, item: QueueItem): void {
  room.queue.push(item);
  getQueueOrder(room.roomCode).set(item.track.id, now());
  sortQueue(room);
  touchRoom(room);
}

function isTrackInUse(room: Room, trackId: string): boolean {
  if (room.currentTrack?.id === trackId) return true;
  return room.queue.some((item) => item.track.id === trackId);
}

function vote(room: Room, trackId: string, guestId: string, voteValue: Vote): void {
  const item = room.queue.find((entry) => entry.track.id === trackId);
  if (!item) return;

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
  sortQueue(room);
  touchRoom(room);
}

function removeTracks(room: Room, trackIds: string[]): void {
  const removeSet = new Set(trackIds);
  room.queue = room.queue.filter((item) => !removeSet.has(item.track.id));
  const order = getQueueOrder(room.roomCode);
  for (const trackId of trackIds) {
    order.delete(trackId);
  }
  touchRoom(room);
}

function setCurrentTrack(room: Room, track: Track | null): void {
  room.currentTrack = track;
  room.playback.track = track;
  room.playback.duration = track?.durationMs ?? 0;
  if (!track) {
    room.playback.isPlaying = false;
    room.playback.startedAtTimestamp = 0;
    room.playback.startedAtPosition = 0;
    room.playback.pausedAtPosition = 0;
  }
  touchRoom(room);
}

function setDeviceId(room: Room, deviceId: string): void {
  room.deviceId = deviceId;
  touchRoom(room);
}

function setRoomAccessToken(room: Room, accessToken: string): void {
  room.accessToken = accessToken;
  touchRoom(room);
}

function setPlaybackFromTrack(room: Room, track: Track, positionMs = 0, isPlaying = true): PlaybackState {
  const playback: PlaybackState = {
    isPlaying,
    startedAtTimestamp: now(),
    startedAtPosition: Math.max(0, Math.min(track.durationMs, positionMs)),
    pausedAtPosition: Math.max(0, Math.min(track.durationMs, positionMs)),
    duration: track.durationMs,
    track,
  };
  room.playback = playback;
  room.currentTrack = track;
  room.lastActivity = now();
  return playback;
}

function setPlaybackPaused(room: Room, track: Track | null, positionMs: number): PlaybackState {
  const clamped = Math.max(0, Math.min(track?.durationMs ?? 0, positionMs));
  const playback: PlaybackState = {
    isPlaying: false,
    startedAtTimestamp: now(),
    startedAtPosition: clamped,
    pausedAtPosition: clamped,
    duration: track?.durationMs ?? 0,
    track,
  };
  room.playback = playback;
  room.currentTrack = track;
  room.lastActivity = now();
  return playback;
}

function getCurrentPlaybackPosition(room: Room): number {
  if (!room.playback.track) return 0;
  const position = room.playback.isPlaying
    ? room.playback.startedAtPosition + (now() - room.playback.startedAtTimestamp)
    : room.playback.pausedAtPosition;
  return Math.max(0, Math.min(room.playback.duration, position));
}

function cleanupExpiredRooms(): void {
  const current = now();
  for (const [roomCode, room] of rooms.entries()) {
    if (current - room.lastActivity > ROOM_TTL_MS) {
      deleteRoom(roomCode);
    }
  }
}

function getSpotifyAuthHeader(): string {
  const clientId = process.env.SPOTIFY_CLIENT_ID ?? "";
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET ?? "";
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
}

async function refreshSpotifyToken(room: Room): Promise<string> {
  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: getSpotifyAuthHeader(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: room.refreshToken,
    }),
  });
  if (!response.ok) {
    throw new Error(`Spotify token refresh failed: ${response.status}`);
  }
  const payload = (await response.json()) as SpotifyTokenResponse;
  room.accessToken = payload.access_token;
  return payload.access_token;
}

async function spotifyRequest(room: Room, path: string, init: RequestInit = {}): Promise<Response> {
  const request = async (token: string): Promise<Response> =>
    fetch(`https://api.spotify.com/v1${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.headers ?? {}),
      },
    });

  let response = await request(room.accessToken);
  if (response.status === 401 && room.refreshToken) {
    const freshToken = await refreshSpotifyToken(room);
    response = await request(freshToken);
  }
  return response;
}

async function activateSpotifyDevice(room: Room): Promise<void> {
  if (!room.deviceId) throw new Error("Player not ready");
  const response = await spotifyRequest(room, `/me/player`, {
    method: "PUT",
    body: JSON.stringify({ device_ids: [room.deviceId], play: false }),
    headers: { "Content-Type": "application/json" },
  });
  if (!response.ok && response.status !== 204) {
    throw new Error(`Spotify device activation failed: ${response.status}`);
  }
}

async function playSpotifyTrack(room: Room, track: Track, positionMs = 0): Promise<void> {
  await activateSpotifyDevice(room);
  const response = await spotifyRequest(room, `/me/player/play?device_id=${encodeURIComponent(room.deviceId)}`, {
    method: "PUT",
    body: JSON.stringify({ uris: [track.uri], position_ms: Math.max(0, positionMs) }),
    headers: { "Content-Type": "application/json" },
  });
  if (!response.ok && response.status !== 204) {
    throw new Error(`Spotify play failed: ${response.status}`);
  }
}

async function pauseSpotify(room: Room): Promise<void> {
  if (!room.deviceId) return;
  const response = await spotifyRequest(room, `/me/player/pause?device_id=${encodeURIComponent(room.deviceId)}`, {
    method: "PUT",
  });
  if (!response.ok && response.status !== 204) {
    throw new Error(`Spotify pause failed: ${response.status}`);
  }
}

async function seekSpotify(room: Room, positionMs: number): Promise<void> {
  if (!room.deviceId) throw new Error("Player not ready");
  const response = await spotifyRequest(room, `/me/player/seek?position_ms=${Math.max(0, positionMs)}&device_id=${encodeURIComponent(room.deviceId)}`, {
    method: "PUT",
  });
  if (!response.ok && response.status !== 204) {
    throw new Error(`Spotify seek failed: ${response.status}`);
  }
}

function selectNextTrack(room: Room): QueueItem | null {
  if (!room.queue.length) return null;
  return room.queue.find((item) => item.score >= 0) ?? room.queue[0] ?? null;
}

async function startNextTrack(io: Server, roomCode: string): Promise<void> {
  const room = getRoom(roomCode);
  if (!room || nextTrackLocks.get(room.roomCode)) return;
  const nextItem = selectNextTrack(room);
  if (!nextItem) {
    room.currentTrack = null;
    room.playback = {
      isPlaying: false,
      startedAtTimestamp: 0,
      startedAtPosition: 0,
      pausedAtPosition: 0,
      duration: 0,
      track: null,
    };
    emitRoomUpdated(io, room.roomCode);
    return;
  }

  nextTrackLocks.set(room.roomCode, true);
  try {
    room.queue = room.queue.filter((item) => item.track.id !== nextItem.track.id);
    getQueueOrder(room.roomCode).delete(nextItem.track.id);
    await pauseSpotify(room).catch(() => undefined);
    await playSpotifyTrack(room, nextItem.track, 0);
    const playback = setPlaybackFromTrack(room, nextItem.track, 0, true);
    emitPlaybackState(io, room, "playback:started", playback);
    emitRoomUpdated(io, room.roomCode);
  } catch (error) {
    emitPlaybackState(io, room, "playback:error", {
      error: error instanceof Error ? error.message : "Failed to start next track",
    });
  } finally {
    nextTrackLocks.set(room.roomCode, false);
  }
}

async function handleSeek(io: Server, roomCode: string, positionMs: number): Promise<PlaybackState> {
  const room = getRoom(roomCode);
  if (!room) throw new Error("Room not found");
  if (!room.currentTrack) throw new Error("No active track");

  await seekSpotify(room, positionMs);
  const playback = setPlaybackFromTrack(room, room.currentTrack, positionMs, true);
  emitPlaybackState(io, room, "playback:state", playback);
  emitRoomUpdated(io, room.roomCode);
  return playback;
}

async function playTrackByUri(io: Server, roomCode: string, uri: string): Promise<PlaybackState> {
  const room = getRoom(roomCode);
  if (!room) throw new Error("Room not found");
  const current = room.currentTrack?.uri === uri ? room.currentTrack : null;
  const queued = room.queue.find((item) => item.track.uri === uri);
  const track = current ?? queued?.track ?? null;
  if (!track) throw new Error("Track is not in this room");

  if (queued) {
    room.queue = room.queue.filter((item) => item.track.id !== queued.track.id);
    getQueueOrder(room.roomCode).delete(queued.track.id);
  }
  await pauseSpotify(room).catch(() => undefined);
  await playSpotifyTrack(room, track, 0);
  const playback = setPlaybackFromTrack(room, track, 0, true);
  emitPlaybackState(io, room, "playback:started", playback);
  emitRoomUpdated(io, room.roomCode);
  return playback;
}

async function togglePlayback(io: Server, roomCode: string): Promise<PlaybackState> {
  const room = getRoom(roomCode);
  if (!room) throw new Error("Room not found");
  if (!room.currentTrack) throw new Error("No active track");
  const positionMs = getCurrentPlaybackPosition(room);

  if (room.playback.isPlaying) {
    await pauseSpotify(room);
    const playback = setPlaybackPaused(room, room.currentTrack, positionMs);
    emitPlaybackState(io, room, "playback:state", playback);
    emitRoomUpdated(io, room.roomCode);
    return playback;
  }

  await playSpotifyTrack(room, room.currentTrack, positionMs);
  const playback = setPlaybackFromTrack(room, room.currentTrack, positionMs, true);
  emitPlaybackState(io, room, "playback:state", playback);
  emitRoomUpdated(io, room.roomCode);
  return playback;
}

function syncRoomSocket(socket: Socket, room: Room, guestId: string): void {
  socket.data.roomCode = room.roomCode;
  socket.data.guestId = guestId;
  socket.data.displayName = room.hostId === guestId ? "Host" : room.guests[guestId] ?? "Guest";
  socket.data.isHost = guestId === room.hostId;
  socket.join(room.roomCode);
  socketConnections.set(socket.id, { roomCode: room.roomCode, guestId, isHost: socket.data.isHost });
}

function registerPresence(room: Room, socket: Socket, guestId: string, displayName: string, isHost: boolean): void {
  const roomPresence = getPresenceMap(room.roomCode);
  const entry = roomPresence.get(guestId) ?? {
    displayName,
    isHost,
    sockets: new Set<string>(),
    connectedAt: now(),
    lastSeenAt: now(),
  };
  entry.displayName = displayName;
  entry.isHost = isHost;
  entry.sockets.add(socket.id);
  entry.lastSeenAt = now();
  roomPresence.set(guestId, entry);
}

function unregisterPresence(roomCode: string, socketId: string, guestId?: string): void {
  const roomPresence = presence.get(roomCode);
  if (!roomPresence || !guestId) return;
  const entry = roomPresence.get(guestId);
  if (!entry) return;
  entry.sockets.delete(socketId);
  entry.lastSeenAt = now();
  if (!entry.sockets.size) {
    roomPresence.delete(guestId);
  }
}

function updatePresenceHeartbeat(roomCode: string, guestId: string): void {
  const roomPresence = presence.get(roomCode);
  const entry = roomPresence?.get(guestId);
  if (!entry) return;
  entry.lastSeenAt = now();
}

const app = express();
app.use(express.json({ limit: "1mb" }));

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: corsOrigins,
    methods: ["GET", "POST"],
  },
});

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    rooms: rooms.size,
    sockets: io.sockets.sockets.size,
    presence: presence.size,
  });
});

app.post("/api/rooms", (req, res) => {
  const hostId = trimString(req.body?.hostId);
  const accessToken = trimString(req.body?.accessToken);
  const refreshToken = trimString(req.body?.refreshToken);
  if (!hostId || !accessToken || !refreshToken) {
    res.status(400).json({ error: "hostId, accessToken, and refreshToken are required" });
    return;
  }
  const room = createRoom({ hostId, accessToken, refreshToken });
  res.json({ roomCode: room.roomCode, code: room.roomCode });
});

app.get("/api/rooms/:roomCode", (req, res) => {
  const room = getRoom(req.params.roomCode);
  if (!room) {
    res.status(404).json({ error: "Room not found" });
    return;
  }
  const viewerId = trimString(req.query.viewerId, "") || undefined;
  res.json(buildPublicRoomState(room, viewerId));
});

app.delete("/api/rooms/:roomCode", (req, res) => {
  deleteRoom(req.params.roomCode);
  res.json({ ok: true });
});

app.post("/api/rooms/join", (req, res) => {
  const roomCode = normalizeRoomCode(req.body?.roomCode);
  const guestId = trimString(req.body?.guestId);
  const displayName = trimString(req.body?.displayName, "Guest");
  const room = getRoom(roomCode);
  if (!room) {
    res.status(404).json({ error: "Room not found" });
    return;
  }
  if (!guestId) {
    res.status(400).json({ error: "guestId is required" });
    return;
  }
  const status = room.hostId === guestId ? "approved" : requestGuestAccess(room, guestId, displayName);
  emitRoomUpdated(io, roomCode);
  res.json({ status, roomCode, state: buildPublicRoomState(room, guestId) });
});

app.post("/api/rooms/disconnect", (req, res) => {
  const roomCode = normalizeRoomCode(req.body?.roomCode);
  const guestId = trimString(req.body?.guestId);
  const isHost = Boolean(req.body?.isHost);
  const room = getRoom(roomCode);
  if (!room || !guestId) {
    res.status(400).json({ error: "roomCode and guestId are required" });
    return;
  }
  if (!isHost) removeGuest(room, guestId);
  emitRoomUpdated(io, roomCode);
  res.json({ ok: true });
});

app.post("/api/rooms/:roomCode/device", (req, res) => {
  const room = getRoom(req.params.roomCode);
  const deviceId = trimString(req.body?.deviceId);
  if (!room || !deviceId) {
    res.status(400).json({ error: "deviceId is required" });
    return;
  }
  setDeviceId(room, deviceId);
  res.json({ ok: true });
});

app.post("/api/rooms/:roomCode/token", (req, res) => {
  const room = getRoom(req.params.roomCode);
  const accessToken = trimString(req.body?.accessToken);
  if (!room || !accessToken) {
    res.status(400).json({ error: "accessToken is required" });
    return;
  }
  setRoomAccessToken(room, accessToken);
  res.json({ ok: true });
});

app.post("/api/rooms/:roomCode/access", (req, res) => {
  const room = getRoom(req.params.roomCode);
  const access = req.body?.access;
  if (!room || (access !== "open" && access !== "locked")) {
    res.status(400).json({ error: "Invalid access setting" });
    return;
  }
  setRoomAccess(room, access);
  emitRoomUpdated(io, room.roomCode);
  res.json({ ok: true });
});

app.post("/api/rooms/:roomCode/guests", (req, res) => {
  const room = getRoom(req.params.roomCode);
  const guestId = trimString(req.body?.guestId);
  const intent = req.body?.intent;
  if (!room || !guestId) {
    res.status(400).json({ error: "guestId is required" });
    return;
  }
  if (intent === "approve-guest") approvePendingGuest(room, guestId);
  else if (intent === "reject-guest") rejectPendingGuest(room, guestId);
  else if (intent === "kick-guest") {
    rejectPendingGuest(room, guestId);
    removeGuest(room, guestId);
  } else {
    res.status(400).json({ error: "Invalid intent" });
    return;
  }
  emitRoomUpdated(io, room.roomCode);
  res.json({ ok: true });
});

app.post("/api/rooms/:roomCode/queue", (req, res) => {
  const room = getRoom(req.params.roomCode);
  const guestId = trimString(req.body?.guestId);
  const track = req.body?.track as Track | undefined;
  if (!room) {
    res.status(404).json({ error: "Room not found" });
    return;
  }
  if (!guestId || !track?.id || !track?.uri || !track?.title) {
    res.status(400).json({ error: "Invalid queue payload" });
    return;
  }
  if (!canInteractInRoom(room, guestId)) {
    res.status(403).json({ error: "Guest not approved for this room" });
    return;
  }
  if (isTrackInUse(room, track.id)) {
    res.status(409).json({ error: "Track already in queue or playing" });
    return;
  }
  const queueItem: QueueItem = {
    track: { ...track, addedBy: guestId },
    upvotes: 1,
    downvotes: 0,
    score: 1,
    voters: { [guestId]: "up" },
  };
  addToQueue(room, queueItem);
  const shouldAutoPlay = !room.currentTrack && room.queue.length === 1 && Boolean(room.deviceId);
  emitRoomUpdated(io, room.roomCode);
  void (async () => {
    if (shouldAutoPlay) {
      await startNextTrack(io, room.roomCode);
    }
  })();
  res.json({ ok: true, state: buildPublicRoomState(room, guestId) });
});

app.post("/api/rooms/:roomCode/queue/batch", (req, res) => {
  const room = getRoom(req.params.roomCode);
  const guestId = trimString(req.body?.guestId);
  const tracks = Array.isArray(req.body?.tracks) ? (req.body.tracks as Track[]) : [];
  if (!room) {
    res.status(404).json({ error: "Room not found" });
    return;
  }
  if (!guestId || tracks.length === 0) {
    res.status(400).json({ error: "Invalid queue payload" });
    return;
  }
  if (!canInteractInRoom(room, guestId)) {
    res.status(403).json({ error: "Guest not approved for this room" });
    return;
  }

  let addedCount = 0;
  for (const track of tracks) {
    if (!track?.id || !track?.uri || !track?.title || isTrackInUse(room, track.id)) {
      continue;
    }
    const queueItem: QueueItem = {
      track: { ...track, addedBy: guestId },
      upvotes: 1,
      downvotes: 0,
      score: 1,
      voters: { [guestId]: "up" },
    };
    addToQueue(room, queueItem);
    addedCount += 1;
  }

  if (addedCount > 0) {
    emitRoomUpdated(io, room.roomCode);
    if (!room.currentTrack && room.queue.length >= addedCount && Boolean(room.deviceId)) {
      void startNextTrack(io, room.roomCode);
    }
  }

  res.json({ ok: true, addedCount, state: buildPublicRoomState(room, guestId) });
});

app.post("/api/rooms/:roomCode/vote", (req, res) => {
  const room = getRoom(req.params.roomCode);
  const guestId = trimString(req.body?.guestId);
  const trackId = trimString(req.body?.trackId);
  const voteValue = req.body?.vote;
  if (!room || !guestId || !trackId || (voteValue !== "up" && voteValue !== "down")) {
    res.status(400).json({ error: "Invalid vote payload" });
    return;
  }
  if (!canInteractInRoom(room, guestId)) {
    res.status(403).json({ error: "Guest not approved for this room" });
    return;
  }
  vote(room, trackId, guestId, voteValue);
  emitRoomUpdated(io, room.roomCode);
  res.json(buildPublicRoomState(room, guestId));
});

app.post("/api/rooms/:roomCode/current", (req, res) => {
  const room = getRoom(req.params.roomCode);
  if (!room) {
    res.status(404).json({ error: "Room not found" });
    return;
  }
  setCurrentTrack(room, (req.body?.track as Track | null) ?? null);
  emitRoomUpdated(io, room.roomCode);
  res.json({ ok: true });
});

app.post("/api/rooms/:roomCode/queue/remove", (req, res) => {
  const room = getRoom(req.params.roomCode);
  const trackIds = Array.isArray(req.body?.trackIds) ? req.body.trackIds.map(String) : [];
  if (!room) {
    res.status(404).json({ error: "Room not found" });
    return;
  }
  removeTracks(room, trackIds);
  emitRoomUpdated(io, room.roomCode);
  res.json({ ok: true });
});

app.post("/api/rooms/:roomCode/playback/next", async (req, res) => {
  const room = getRoom(req.params.roomCode);
  if (!room) {
    res.status(404).json({ error: "Room not found" });
    return;
  }
  try {
    await startNextTrack(io, room.roomCode);
    res.json({ currentTrack: room.currentTrack, playback: room.playback });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to play next track" });
  }
});

app.post("/api/rooms/:roomCode/playback/seek", async (req, res) => {
  const room = getRoom(req.params.roomCode);
  const positionMs = Number(req.body?.positionMs ?? 0);
  if (!room || !Number.isFinite(positionMs)) {
    res.status(400).json({ error: "Invalid seek payload" });
    return;
  }
  try {
    const playback = await handleSeek(io, room.roomCode, positionMs);
    res.json({ playback });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to seek playback" });
  }
});

app.post("/api/rooms/:roomCode/playback/play", async (req, res) => {
  const room = getRoom(req.params.roomCode);
  const uri = trimString(req.body?.uri);
  if (!room || !uri) {
    res.status(400).json({ error: "roomCode and uri are required" });
    return;
  }
  try {
    const playback = await playTrackByUri(io, room.roomCode, uri);
    res.json({ currentTrack: room.currentTrack, playback });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to play track" });
  }
});

app.post("/api/rooms/:roomCode/playback/toggle", async (req, res) => {
  const room = getRoom(req.params.roomCode);
  if (!room) {
    res.status(404).json({ error: "Room not found" });
    return;
  }
  try {
    const playback = await togglePlayback(io, room.roomCode);
    res.json({ currentTrack: room.currentTrack, playback });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to toggle playback" });
  }
});

io.on("connection", (socket) => {
  socket.on("join-room", (payload: RoomConnectionData, ack?: (response: SocketAck) => void) => {
    const room = getRoom(payload?.roomCode ?? "");
    const guestId = trimString(payload?.guestId);
    const displayName = trimString(payload?.displayName, "Guest");
    if (!room || !guestId) {
      ack?.({ error: "Room not found" });
      return;
    }
    const isHost = guestId === room.hostId;
    const status = isHost ? "approved" : requestGuestAccess(room, guestId, displayName);
    syncRoomSocket(socket, room, guestId);
    registerPresence(room, socket, guestId, displayName, isHost);
    socket.emit("room-join-status", { status });
    socket.emit("room-updated", buildPublicRoomState(room, guestId));
    ack?.({ ok: true, status, state: buildPublicRoomState(room, guestId) });
    emitRoomUpdated(io, room.roomCode);
  });

  socket.on("sync-room", (_payload: unknown, ack?: (response: SocketAck) => void) => {
    const room = socket.data.roomCode ? getRoom(socket.data.roomCode) : undefined;
    const guestId = socket.data.guestId as string | undefined;
    if (!room || !guestId) {
      ack?.({ error: "Room not found" });
      return;
    }
    ack?.({ ok: true, state: buildPublicRoomState(room, guestId) });
  });

  socket.on("room-ping", (_payload: unknown, ack?: (response: SocketAck) => void) => {
    const roomCode = socket.data.roomCode as string | undefined;
    const guestId = socket.data.guestId as string | undefined;
    if (roomCode && guestId) {
      updatePresenceHeartbeat(roomCode, guestId);
      const room = getRoom(roomCode);
      if (room) touchRoom(room);
    }
    ack?.({ ok: true });
  });

  socket.on("disconnect", () => {
    const meta = socketConnections.get(socket.id);
    socketConnections.delete(socket.id);
    if (!meta) return;
    unregisterPresence(meta.roomCode, socket.id, meta.guestId);
    const room = getRoom(meta.roomCode);
    if (room) {
      emitRoomUpdated(io, room.roomCode);
    }
  });
});

setInterval(cleanupExpiredRooms, 30 * 60 * 1000);
setInterval(() => {
  const cutoff = now() - STALE_SOCKET_MS;
  for (const [roomCode, roomPresence] of presence.entries()) {
    for (const [guestId, entry] of roomPresence.entries()) {
      if (entry.lastSeenAt < cutoff && !entry.sockets.size) {
        roomPresence.delete(guestId);
        const room = getRoom(roomCode);
        if (room) emitRoomUpdated(io, room.roomCode);
      }
    }
  }
}, 15000);
setInterval(() => {
  for (const room of rooms.values()) {
    if (!room.playback.isPlaying || !room.playback.track) continue;
    const elapsed = room.playback.startedAtPosition + (now() - room.playback.startedAtTimestamp);
    if (elapsed >= room.playback.duration - TRACK_END_GUARD_MS && !nextTrackLocks.get(room.roomCode)) {
      void startNextTrack(io, room.roomCode);
    }
  }
}, 3000);

httpServer.listen(PORT, () => {
  console.log(`Socket provider listening on http://127.0.0.1:${PORT}`);
});
