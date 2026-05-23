import "dotenv/config";
import express, { type Request, type Response, type NextFunction } from "express";
import { createServer } from "http";
import { Server, type Socket } from "socket.io";

/* ────────────────────────────── Types ────────────────────────────── */

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

type SkipVote = {
  id: string;
  trackId: string;
  trackTitle: string;
  initiatorId: string;
  initiatorName: string;
  startedAt: number;
  endsAt: number;
  votes: Record<string, "yes" | "no">;
  yesCount: number;
  noCount: number;
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
  skipVote: SkipVote | null;
  createdAt: number;
  lastActivity: number;
};

type PublicRoomState = {
  roomCode: string;
  hostId: string;
  access: "open" | "locked";
  queue: QueueItem[];
  currentTrack: Track | null;
  playback: PlaybackState;
  guests: Record<string, string>;
  pendingGuests: Record<string, string>;
  guestCount: number;
  skipVote: SkipVote | null;
};

type PresenceEntry = {
  displayName: string;
  isHost: boolean;
  sockets: Set<string>;
  lastSeenAt: number;
};

type SocketAck<T = void> = { ok?: boolean; error?: string } & (T extends void ? {} : T);

type JoinPayload = {
  roomCode?: string;
  guestId?: string;
  displayName?: string;
  asHost?: boolean;
};

/* ────────────────────────── Configuration ────────────────────────── */

const PORT = Number(process.env.PORT ?? 4001);
const ROOM_TTL_MS = 12 * 60 * 60 * 1000;
const STALE_PRESENCE_MS = 30_000;
const CODE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const SHARED_SECRET = (process.env.SOCKET_PROVIDER_SECRET ?? "").trim();
const CORS_ORIGINS = (process.env.CORS_ORIGIN ?? "http://127.0.0.1:3000,http://localhost:3000")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

/* ─────────────────────── In-memory state ─────────────────────── */

const rooms = new Map<string, Room>();
const queueOrder = new Map<string, Map<string, number>>();
const presence = new Map<string, Map<string, PresenceEntry>>();
const socketIndex = new Map<string, { roomCode: string; guestId: string; isHost: boolean }>();
// Per-room cooldown for playback:next. Defends against duplicate emits from the
// host (e.g. SDK + watchdog both firing onTrackEnd, or a double-click race) which
// would otherwise pop two items off the queue for a single user-intent skip.
const lastNextAt = new Map<string, number>();
const NEXT_COOLDOWN_MS = 1500;
const SKIP_VOTE_DURATION_MS = 10_000;
const skipVoteTimers = new Map<string, NodeJS.Timeout>();

/* ──────────────────────────── Helpers ──────────────────────────── */

const now = () => Date.now();

const normalizeCode = (value: unknown): string =>
  typeof value === "string" ? value.trim().toUpperCase() : "";

const trimString = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value.trim() || fallback : fallback;

function emptyPlayback(): PlaybackState {
  return {
    isPlaying: false,
    startedAtTimestamp: 0,
    startedAtPosition: 0,
    pausedAtPosition: 0,
    duration: 0,
    track: null,
  };
}

function getRoom(code: unknown): Room | undefined {
  return rooms.get(normalizeCode(code));
}

function touchRoom(room: Room): void {
  room.lastActivity = now();
}

function getQueueOrder(code: string): Map<string, number> {
  let order = queueOrder.get(code);
  if (!order) {
    order = new Map<string, number>();
    queueOrder.set(code, order);
  }
  return order;
}

function getPresence(code: string): Map<string, PresenceEntry> {
  let map = presence.get(code);
  if (!map) {
    map = new Map<string, PresenceEntry>();
    presence.set(code, map);
  }
  return map;
}

function generateCode(): string {
  let code = "";
  do {
    code = "";
    for (let i = 0; i < 6; i += 1) {
      code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    }
  } while (rooms.has(code));
  return code;
}

function createRoom(input: { hostId: string; accessToken: string; refreshToken: string }): Room {
  const roomCode = generateCode();
  const room: Room = {
    roomCode,
    hostId: input.hostId,
    accessToken: input.accessToken,
    refreshToken: input.refreshToken,
    deviceId: "",
    access: "open",
    queue: [],
    currentTrack: null,
    playback: emptyPlayback(),
    guests: {},
    pendingGuests: {},
    skipVote: null,
    createdAt: now(),
    lastActivity: now(),
  };
  rooms.set(roomCode, room);
  queueOrder.set(roomCode, new Map<string, number>());
  presence.set(roomCode, new Map<string, PresenceEntry>());
  return room;
}

function deleteRoom(code: string): void {
  const normalized = normalizeCode(code);
  rooms.delete(normalized);
  queueOrder.delete(normalized);
  presence.delete(normalized);
  lastNextAt.delete(normalized);
  const timer = skipVoteTimers.get(normalized);
  if (timer) {
    clearTimeout(timer);
    skipVoteTimers.delete(normalized);
  }
}

function sortQueue(room: Room): void {
  const order = getQueueOrder(room.roomCode);
  room.queue.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    const aAt = order.get(a.track.id) ?? Number.MAX_SAFE_INTEGER;
    const bAt = order.get(b.track.id) ?? Number.MAX_SAFE_INTEGER;
    return aAt - bAt;
  });
}

function isTrackInUse(room: Room, trackId: string): boolean {
  if (room.currentTrack?.id === trackId) return true;
  return room.queue.some((item) => item.track.id === trackId);
}

function canInteract(room: Room, guestId: string): boolean {
  return guestId === room.hostId || Boolean(room.guests[guestId]);
}

function isValidTrack(track: unknown): track is Track {
  if (!track || typeof track !== "object") return false;
  const t = track as Partial<Track>;
  return (
    typeof t.id === "string" &&
    typeof t.uri === "string" &&
    typeof t.title === "string" &&
    typeof t.artist === "string" &&
    typeof t.albumArt === "string" &&
    typeof t.durationMs === "number" &&
    t.id.length > 0 &&
    t.uri.length > 0
  );
}

function getLiveGuests(room: Room): Record<string, string> {
  const roomPresence = presence.get(room.roomCode);
  if (!roomPresence) return {};
  const live: Record<string, string> = {};
  for (const [guestId, displayName] of Object.entries(room.guests)) {
    if (guestId === room.hostId) continue;
    const entry = roomPresence.get(guestId);
    if (entry?.sockets.size) live[guestId] = displayName;
  }
  return live;
}

function buildPublicState(room: Room): PublicRoomState {
  return {
    roomCode: room.roomCode,
    hostId: room.hostId,
    access: room.access,
    queue: room.queue,
    currentTrack: room.currentTrack,
    playback: room.playback,
    guests: getLiveGuests(room),
    pendingGuests: room.pendingGuests,
    guestCount: Object.keys(getLiveGuests(room)).length,
    skipVote: room.skipVote,
  };
}

function broadcastRoom(io: Server, room: Room): void {
  io.to(room.roomCode).emit("room:state", buildPublicState(room));
}

/* ────────────────────────── Mutations ────────────────────────── */

function requestGuestAccess(room: Room, guestId: string, displayName: string): "approved" | "pending" {
  if (guestId === room.hostId) return "approved";
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

function moderateGuest(
  room: Room,
  intent: "approve-guest" | "reject-guest" | "kick-guest",
  guestId: string,
): void {
  if (intent === "approve-guest") {
    const name = room.pendingGuests[guestId];
    if (!name) return;
    room.guests[guestId] = name;
    delete room.pendingGuests[guestId];
  } else if (intent === "reject-guest") {
    delete room.pendingGuests[guestId];
  } else if (intent === "kick-guest") {
    delete room.pendingGuests[guestId];
    delete room.guests[guestId];
  }
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

function setCurrentTrack(room: Room, track: Track | null): void {
  if (room.currentTrack?.id !== track?.id) {
    cancelSkipVote(room);
  }
  room.currentTrack = track;
  if (!track) {
    room.playback = emptyPlayback();
  } else {
    room.playback = { ...emptyPlayback(), track, duration: track.durationMs };
  }
  touchRoom(room);
}

function selectNextTrack(room: Room): QueueItem | null {
  if (!room.queue.length) return null;
  return room.queue.find((item) => item.score >= 0) ?? room.queue[0] ?? null;
}

function claimNextTrack(room: Room): Track | null {
  const nextItem = selectNextTrack(room);
  if (!nextItem) {
    setCurrentTrack(room, null);
    return null;
  }
  room.queue = room.queue.filter((item) => item.track.id !== nextItem.track.id);
  getQueueOrder(room.roomCode).delete(nextItem.track.id);
  setCurrentTrack(room, nextItem.track);
  return nextItem.track;
}

function addTracks(room: Room, guestId: string, tracks: Track[]): number {
  let added = 0;
  for (const raw of tracks) {
    if (!isValidTrack(raw)) continue;
    if (isTrackInUse(room, raw.id)) continue;
    const queueItem: QueueItem = {
      track: { ...raw, addedBy: guestId },
      upvotes: 1,
      downvotes: 0,
      score: 1,
      voters: { [guestId]: "up" },
    };
    room.queue.push(queueItem);
    getQueueOrder(room.roomCode).set(queueItem.track.id, now());
    added += 1;
  }
  if (added > 0) {
    sortQueue(room);
    touchRoom(room);
  }
  return added;
}

function castVote(room: Room, guestId: string, trackId: string, vote: Vote): void {
  const item = room.queue.find((entry) => entry.track.id === trackId);
  if (!item) return;
  const current = item.voters[guestId];
  if (current === vote) {
    if (vote === "up") item.upvotes = Math.max(0, item.upvotes - 1);
    else item.downvotes = Math.max(0, item.downvotes - 1);
    delete item.voters[guestId];
  } else if (current === "up" && vote === "down") {
    item.upvotes = Math.max(0, item.upvotes - 1);
    item.downvotes += 1;
    item.voters[guestId] = "down";
  } else if (current === "down" && vote === "up") {
    item.downvotes = Math.max(0, item.downvotes - 1);
    item.upvotes += 1;
    item.voters[guestId] = "up";
  } else {
    if (vote === "up") item.upvotes += 1;
    else item.downvotes += 1;
    item.voters[guestId] = vote;
  }
  item.score = item.upvotes - item.downvotes;
  sortQueue(room);
  touchRoom(room);
}

function removeTracks(room: Room, trackIds: string[]): void {
  const set = new Set(trackIds);
  room.queue = room.queue.filter((item) => !set.has(item.track.id));
  const order = getQueueOrder(room.roomCode);
  for (const id of trackIds) order.delete(id);
  touchRoom(room);
}

function genVoteId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function cancelSkipVote(room: Room): void {
  const timer = skipVoteTimers.get(room.roomCode);
  if (timer) {
    clearTimeout(timer);
    skipVoteTimers.delete(room.roomCode);
  }
  room.skipVote = null;
}

function startSkipVote(
  room: Room,
  initiatorId: string,
  initiatorName: string,
): SkipVote | { error: string } {
  if (!canInteract(room, initiatorId)) return { error: "Not approved" };
  if (room.skipVote) return { error: "A skip vote is already active" };
  if (!room.currentTrack) return { error: "No song to skip" };
  const startedAt = now();
  const vote: SkipVote = {
    id: genVoteId(),
    trackId: room.currentTrack.id,
    trackTitle: room.currentTrack.title,
    initiatorId,
    initiatorName,
    startedAt,
    endsAt: startedAt + SKIP_VOTE_DURATION_MS,
    votes: { [initiatorId]: "yes" },
    yesCount: 1,
    noCount: 0,
  };
  room.skipVote = vote;
  touchRoom(room);
  return vote;
}

function castSkipVote(
  room: Room,
  guestId: string,
  choice: "yes" | "no",
): { ok: true } | { error: string } {
  if (!canInteract(room, guestId)) return { error: "Not approved" };
  const vote = room.skipVote;
  if (!vote) return { error: "No active skip vote" };
  const prev = vote.votes[guestId];
  if (prev === choice) {
    delete vote.votes[guestId];
    if (choice === "yes") vote.yesCount = Math.max(0, vote.yesCount - 1);
    else vote.noCount = Math.max(0, vote.noCount - 1);
  } else if (prev) {
    vote.votes[guestId] = choice;
    if (prev === "yes") {
      vote.yesCount = Math.max(0, vote.yesCount - 1);
      vote.noCount += 1;
    } else {
      vote.noCount = Math.max(0, vote.noCount - 1);
      vote.yesCount += 1;
    }
  } else {
    vote.votes[guestId] = choice;
    if (choice === "yes") vote.yesCount += 1;
    else vote.noCount += 1;
  }
  touchRoom(room);
  return { ok: true };
}

function resolveSkipVote(room: Room): void {
  const timer = skipVoteTimers.get(room.roomCode);
  if (timer) {
    clearTimeout(timer);
    skipVoteTimers.delete(room.roomCode);
  }
  const vote = room.skipVote;
  if (!vote) return;
  const passed = vote.yesCount > vote.noCount;
  room.skipVote = null;
  if (passed) {
    claimNextTrack(room);
  }
  touchRoom(room);
}

function normalizePlayback(raw: unknown): PlaybackState | null {
  if (!raw || typeof raw !== "object") return null;
  const input = raw as Partial<PlaybackState>;
  const track = input.track && isValidTrack(input.track) ? input.track : null;
  const startedAtTimestamp = Number(input.startedAtTimestamp ?? now());
  const startedAtPosition = Number(input.startedAtPosition ?? 0);
  const pausedAtPosition = Number(input.pausedAtPosition ?? startedAtPosition);
  const duration = Number(input.duration ?? track?.durationMs ?? 0);
  return {
    isPlaying: Boolean(input.isPlaying && track),
    startedAtTimestamp: Number.isFinite(startedAtTimestamp) ? startedAtTimestamp : now(),
    startedAtPosition: Number.isFinite(startedAtPosition) ? Math.max(0, startedAtPosition) : 0,
    pausedAtPosition: Number.isFinite(pausedAtPosition) ? Math.max(0, pausedAtPosition) : 0,
    duration: Number.isFinite(duration) ? Math.max(0, duration) : 0,
    track,
  };
}

/* ──────────────────────── HTTP application ──────────────────────── */

const app = express();
app.use(express.json({ limit: "1mb" }));

if (!SHARED_SECRET) {
  console.warn(
    "[roomi-backend] SOCKET_PROVIDER_SECRET is empty — internal HTTP endpoints are UNAUTHENTICATED. Set the env var before deploying.",
  );
}

function requireSecret(req: Request, res: Response, next: NextFunction): void {
  // Dev convenience: when no secret is configured on the backend, accept any
  // request. When one IS configured, the matching header is mandatory.
  if (SHARED_SECRET) {
    const provided = req.header("x-roomi-secret");
    if (provided !== SHARED_SECRET) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
  }
  next();
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, rooms: rooms.size });
});

// Frontend calls this server-to-server after Spotify OAuth completes.
app.post("/api/rooms", requireSecret, (req, res) => {
  const hostId = trimString(req.body?.hostId);
  const accessToken = trimString(req.body?.accessToken);
  const refreshToken = trimString(req.body?.refreshToken);
  if (!hostId || !accessToken || !refreshToken) {
    res.status(400).json({ error: "hostId, accessToken, refreshToken required" });
    return;
  }
  const room = createRoom({ hostId, accessToken, refreshToken });
  res.json({ roomCode: room.roomCode });
});

app.delete("/api/rooms/:roomCode", requireSecret, (req, res) => {
  const room = getRoom(req.params.roomCode);
  if (room) {
    io.to(room.roomCode).emit("room:closed");
    deleteRoom(room.roomCode);
  }
  res.json({ ok: true });
});

// Search proxy reads the room's access token via this protected endpoint
// instead of receiving secret tokens on the client.
app.get("/internal/rooms/:roomCode/access-token", requireSecret, (req, res) => {
  const room = getRoom(req.params.roomCode);
  if (!room) {
    res.status(404).json({ error: "Room not found" });
    return;
  }
  res.json({ accessToken: room.accessToken, refreshToken: room.refreshToken });
});

app.post("/internal/rooms/:roomCode/access-token", requireSecret, (req, res) => {
  const room = getRoom(req.params.roomCode);
  if (!room) {
    res.status(404).json({ error: "Room not found" });
    return;
  }
  const accessToken = trimString(req.body?.accessToken);
  if (!accessToken) {
    res.status(400).json({ error: "accessToken required" });
    return;
  }
  room.accessToken = accessToken;
  touchRoom(room);
  res.json({ ok: true });
});

/* ─────────────────────── Socket.io server ─────────────────────── */

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: CORS_ORIGINS, methods: ["GET", "POST"] },
});

function attachSocket(socket: Socket, room: Room, guestId: string, displayName: string, isHost: boolean): void {
  socket.data.roomCode = room.roomCode;
  socket.data.guestId = guestId;
  socket.data.displayName = displayName;
  socket.data.isHost = isHost;
  socket.join(room.roomCode);
  socketIndex.set(socket.id, { roomCode: room.roomCode, guestId, isHost });

  const map = getPresence(room.roomCode);
  const entry = map.get(guestId) ?? {
    displayName,
    isHost,
    sockets: new Set<string>(),
    lastSeenAt: now(),
  };
  entry.displayName = displayName;
  entry.isHost = isHost;
  entry.sockets.add(socket.id);
  entry.lastSeenAt = now();
  map.set(guestId, entry);
}

function detachSocket(socket: Socket): void {
  const meta = socketIndex.get(socket.id);
  if (!meta) return;
  socketIndex.delete(socket.id);
  const map = presence.get(meta.roomCode);
  if (map) {
    const entry = map.get(meta.guestId);
    if (entry) {
      entry.sockets.delete(socket.id);
      entry.lastSeenAt = now();
      if (!entry.sockets.size) map.delete(meta.guestId);
    }
  }
  const room = getRoom(meta.roomCode);
  if (room) broadcastRoom(io, room);
}

/** Wrap a handler so unexpected exceptions never crash the process. */
function safe<T>(handler: () => T, ack?: (response: SocketAck) => void): T | undefined {
  try {
    return handler();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal error";
    ack?.({ error: message });
    return undefined;
  }
}

io.on("connection", (socket) => {
  socket.on("room:join", (payload: JoinPayload, ack?: (response: SocketAck<{ status?: "approved" | "pending"; state?: PublicRoomState }>) => void) => {
    safe(() => {
      const room = getRoom(payload?.roomCode);
      const guestId = trimString(payload?.guestId);
      const displayName = trimString(payload?.displayName, "Guest");
      if (!room) return ack?.({ error: "Room not found" });
      if (!guestId) return ack?.({ error: "guestId required" });
      const claimedHost = Boolean(payload?.asHost);
      const isHost = guestId === room.hostId;
      if (claimedHost && !isHost) return ack?.({ error: "Not the room host" });

      const status = requestGuestAccess(room, guestId, isHost ? "Host" : displayName);
      attachSocket(socket, room, guestId, isHost ? "Host" : displayName, isHost);

      socket.emit("room:join-status", { status });
      ack?.({ ok: true, status, state: buildPublicState(room) });
      broadcastRoom(io, room);
    }, ack);
  });

  socket.on("room:ping", (_payload: unknown, ack?: (response: SocketAck) => void) => {
    const meta = socketIndex.get(socket.id);
    if (meta) {
      const map = presence.get(meta.roomCode);
      const entry = map?.get(meta.guestId);
      if (entry) entry.lastSeenAt = now();
      const room = getRoom(meta.roomCode);
      if (room) touchRoom(room);
    }
    ack?.({ ok: true });
  });

  socket.on("room:sync", (_payload: unknown, ack?: (response: SocketAck<{ state?: PublicRoomState }>) => void) => {
    const meta = socketIndex.get(socket.id);
    const room = meta ? getRoom(meta.roomCode) : undefined;
    if (!room) return ack?.({ error: "Room not found" });
    ack?.({ ok: true, state: buildPublicState(room) });
  });

  /* ── Host-only events ── */

  const requireHost = (ack?: (response: SocketAck) => void): Room | null => {
    const meta = socketIndex.get(socket.id);
    if (!meta) {
      ack?.({ error: "Not in a room" });
      return null;
    }
    const room = getRoom(meta.roomCode);
    if (!room) {
      ack?.({ error: "Room not found" });
      return null;
    }
    if (!meta.isHost) {
      ack?.({ error: "Host only" });
      return null;
    }
    return room;
  };

  socket.on("room:set-access", (payload: { access?: "open" | "locked" }, ack?: (response: SocketAck) => void) => {
    safe(() => {
      const room = requireHost(ack);
      if (!room) return;
      if (payload?.access !== "open" && payload?.access !== "locked") {
        return ack?.({ error: "Invalid access" });
      }
      setRoomAccess(room, payload.access);
      broadcastRoom(io, room);
      ack?.({ ok: true });
    }, ack);
  });

  socket.on("room:moderate-guest", (
    payload: { guestId?: string; intent?: "approve-guest" | "reject-guest" | "kick-guest" },
    ack?: (response: SocketAck) => void,
  ) => {
    safe(() => {
      const room = requireHost(ack);
      if (!room) return;
      const guestId = trimString(payload?.guestId);
      const intent = payload?.intent;
      if (!guestId || (intent !== "approve-guest" && intent !== "reject-guest" && intent !== "kick-guest")) {
        return ack?.({ error: "Invalid moderation payload" });
      }
      moderateGuest(room, intent, guestId);
      broadcastRoom(io, room);
      ack?.({ ok: true });
    }, ack);
  });

  socket.on("room:set-device", (payload: { deviceId?: string }, ack?: (response: SocketAck) => void) => {
    safe(() => {
      const room = requireHost(ack);
      if (!room) return;
      const deviceId = trimString(payload?.deviceId);
      if (!deviceId) return ack?.({ error: "deviceId required" });
      room.deviceId = deviceId;
      touchRoom(room);
      ack?.({ ok: true });
    }, ack);
  });

  socket.on("room:set-token", (payload: { accessToken?: string }, ack?: (response: SocketAck) => void) => {
    safe(() => {
      const room = requireHost(ack);
      if (!room) return;
      const accessToken = trimString(payload?.accessToken);
      if (!accessToken) return ack?.({ error: "accessToken required" });
      room.accessToken = accessToken;
      touchRoom(room);
      ack?.({ ok: true });
    }, ack);
  });

  socket.on("room:end", (_payload: unknown, ack?: (response: SocketAck) => void) => {
    safe(() => {
      const room = requireHost(ack);
      if (!room) return;
      io.to(room.roomCode).emit("room:closed");
      deleteRoom(room.roomCode);
      ack?.({ ok: true });
    }, ack);
  });

  /* ── Queue events (open to guests + host) ── */

  socket.on("queue:add", (
    payload: { track?: Track },
    ack?: (response: SocketAck<{ autoPlayTrack?: Track | null; state?: PublicRoomState }>) => void,
  ) => {
    safe(() => {
      const meta = socketIndex.get(socket.id);
      const room = meta ? getRoom(meta.roomCode) : undefined;
      if (!room || !meta) return ack?.({ error: "Room not found" });
      if (!canInteract(room, meta.guestId)) return ack?.({ error: "Not approved" });
      if (!isValidTrack(payload?.track)) return ack?.({ error: "Invalid track" });
      const added = addTracks(room, meta.guestId, [payload.track]);
      const wasIdle = added > 0 && !room.currentTrack && !room.playback.track;
      const autoPlayTrack = wasIdle ? claimNextTrack(room) : null;
      broadcastRoom(io, room);
      ack?.({ ok: true, autoPlayTrack, state: buildPublicState(room) });
    }, ack);
  });

  socket.on("queue:add-batch", (
    payload: { tracks?: Track[] },
    ack?: (response: SocketAck<{ addedCount?: number; autoPlayTrack?: Track | null; state?: PublicRoomState }>) => void,
  ) => {
    safe(() => {
      const meta = socketIndex.get(socket.id);
      const room = meta ? getRoom(meta.roomCode) : undefined;
      if (!room || !meta) return ack?.({ error: "Room not found" });
      if (!canInteract(room, meta.guestId)) return ack?.({ error: "Not approved" });
      const tracks = Array.isArray(payload?.tracks) ? payload.tracks : [];
      const added = addTracks(room, meta.guestId, tracks);
      const wasIdle = added > 0 && !room.currentTrack && !room.playback.track;
      const autoPlayTrack = wasIdle ? claimNextTrack(room) : null;
      broadcastRoom(io, room);
      ack?.({ ok: true, addedCount: added, autoPlayTrack, state: buildPublicState(room) });
    }, ack);
  });

  socket.on("queue:vote", (
    payload: { trackId?: string; vote?: Vote },
    ack?: (response: SocketAck<{ state?: PublicRoomState }>) => void,
  ) => {
    safe(() => {
      const meta = socketIndex.get(socket.id);
      const room = meta ? getRoom(meta.roomCode) : undefined;
      if (!room || !meta) return ack?.({ error: "Room not found" });
      if (!canInteract(room, meta.guestId)) return ack?.({ error: "Not approved" });
      const trackId = trimString(payload?.trackId);
      const vote = payload?.vote;
      if (!trackId || (vote !== "up" && vote !== "down")) {
        return ack?.({ error: "Invalid vote" });
      }
      castVote(room, meta.guestId, trackId, vote);
      broadcastRoom(io, room);
      ack?.({ ok: true, state: buildPublicState(room) });
    }, ack);
  });

  socket.on("queue:remove", (payload: { trackIds?: string[] }, ack?: (response: SocketAck) => void) => {
    safe(() => {
      const room = requireHost(ack);
      if (!room) return;
      const trackIds = Array.isArray(payload?.trackIds) ? payload.trackIds.map(String) : [];
      removeTracks(room, trackIds);
      broadcastRoom(io, room);
      ack?.({ ok: true });
    }, ack);
  });

  /* ── Playback events ── */

  socket.on("playback:next", (
    _payload: unknown,
    ack?: (response: SocketAck<{ currentTrack?: Track | null; playback?: PlaybackState }>) => void,
  ) => {
    safe(() => {
      const room = requireHost(ack);
      if (!room) return;
      // Per-room cooldown: a single user-intent skip can race with the
      // SDK + watchdog both detecting end-of-track. Without this gate we'd
      // pop the next two items from the queue for one intent. Return the
      // current track unchanged on duplicate within the window.
      const last = lastNextAt.get(room.roomCode) ?? 0;
      if (Date.now() - last < NEXT_COOLDOWN_MS) {
        ack?.({ ok: true, currentTrack: room.currentTrack, playback: room.playback });
        return;
      }
      lastNextAt.set(room.roomCode, Date.now());
      const track = claimNextTrack(room);
      broadcastRoom(io, room);
      ack?.({ ok: true, currentTrack: track, playback: room.playback });
    }, ack);
  });

  socket.on("playback:state", (
    payload: { playback?: PlaybackState },
    ack?: (response: SocketAck) => void,
  ) => {
    safe(() => {
      const room = requireHost(ack);
      if (!room) return;
      const playback = normalizePlayback(payload?.playback);
      if (!playback) return ack?.({ error: "Invalid playback state" });
      if (room.currentTrack?.id !== playback.track?.id) {
        cancelSkipVote(room);
      }
      room.playback = playback;
      room.currentTrack = playback.track;
      touchRoom(room);
      io.to(room.roomCode).emit("playback:state", playback);
      // Also broadcast room state so late-joiners see the latest track/queue.
      broadcastRoom(io, room);
      ack?.({ ok: true });
    }, ack);
  });

  /* ── Skip-vote events (guests + host) ── */

  socket.on("skip-vote:start", (
    _payload: unknown,
    ack?: (response: SocketAck<{ skipVote?: SkipVote }>) => void,
  ) => {
    safe(() => {
      const meta = socketIndex.get(socket.id);
      const room = meta ? getRoom(meta.roomCode) : undefined;
      if (!room || !meta) return ack?.({ error: "Room not found" });
      const displayName = (socket.data.displayName as string | undefined) ?? "Guest";
      const result = startSkipVote(room, meta.guestId, displayName);
      if ("error" in result) return ack?.({ error: result.error });
      const vote = result;
      skipVoteTimers.set(
        room.roomCode,
        setTimeout(() => {
          const current = rooms.get(room.roomCode);
          if (!current || current.skipVote?.id !== vote.id) return;
          resolveSkipVote(current);
          broadcastRoom(io, current);
        }, SKIP_VOTE_DURATION_MS),
      );
      broadcastRoom(io, room);
      ack?.({ ok: true, skipVote: vote });
    }, ack);
  });

  socket.on("skip-vote:cast", (
    payload: { vote?: "yes" | "no" },
    ack?: (response: SocketAck) => void,
  ) => {
    safe(() => {
      const meta = socketIndex.get(socket.id);
      const room = meta ? getRoom(meta.roomCode) : undefined;
      if (!room || !meta) return ack?.({ error: "Room not found" });
      const choice = payload?.vote;
      if (choice !== "yes" && choice !== "no") return ack?.({ error: "Invalid vote" });
      const result = castSkipVote(room, meta.guestId, choice);
      if ("error" in result) return ack?.({ error: result.error });
      broadcastRoom(io, room);
      ack?.({ ok: true });
    }, ack);
  });

  socket.on("disconnect", () => {
    detachSocket(socket);
  });
});

/* ──────────────────── Periodic housekeeping ──────────────────── */

setInterval(() => {
  const cutoff = now() - ROOM_TTL_MS;
  for (const [code, room] of rooms.entries()) {
    if (room.lastActivity < cutoff) {
      io.to(code).emit("room:closed");
      deleteRoom(code);
    }
  }
}, 30 * 60 * 1000);

setInterval(() => {
  const cutoff = now() - STALE_PRESENCE_MS;
  for (const [code, map] of presence.entries()) {
    let dirty = false;
    for (const [guestId, entry] of map.entries()) {
      if (entry.lastSeenAt < cutoff && entry.sockets.size === 0) {
        map.delete(guestId);
        dirty = true;
      }
    }
    if (dirty) {
      const room = getRoom(code);
      if (room) broadcastRoom(io, room);
    }
  }
}, 15_000);

/* ─────────────────────────── Bootstrap ─────────────────────────── */

httpServer.listen(PORT, () => {
  console.log(`[roomi-backend] listening on http://127.0.0.1:${PORT}`);
});
