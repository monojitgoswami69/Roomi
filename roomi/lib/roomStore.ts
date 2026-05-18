export interface Track {
  id: string;
  uri: string;
  title: string;
  artist: string;
  albumArt: string;
  durationMs: number;
  addedBy: string;
}

export interface QueueItem {
  track: Track;
  upvotes: number;
  downvotes: number;
  score: number;
  voters: Record<string, "up" | "down">;
}

export type PublicQueueItem = QueueItem & {
  myVote: "up" | "down" | null;
  voteCount: number;
};

export type PlaybackState = {
  isPlaying: boolean;
  startedAtTimestamp: number;
  startedAtPosition: number;
  pausedAtPosition: number;
  duration: number;
  track: Track | null;
};

export interface Room {
  code: string;
  hostId: string;
  accessToken: string;
  refreshToken: string;
  deviceId: string;
  access: "open" | "locked";
  queue: QueueItem[];
  currentTrack: Track | null;
  playback?: PlaybackState;
  guests: Record<string, string>;
  pendingGuests: Record<string, string>;
  createdAt: number;
  lastActivity: number;
}

export type PublicRoomState = {
  queue: PublicQueueItem[];
  currentTrack: Track | null;
  playback?: PlaybackState;
  guests: Record<string, string>;
  pendingGuests: Record<string, string>;
  guestCount: number;
  access: "open" | "locked";
};

type SocketServerLike = {
  to: (roomCode: string) => {
    emit: (event: "room-updated", payload: PublicRoomState) => void;
  };
};

declare global {
  var roomiSocketServer: SocketServerLike | undefined;
  var roomiRooms: Map<string, Room> | undefined;
  var roomiQueueAddedAt: Map<string, Map<string, number>> | undefined;
}

const CODE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const rooms = globalThis.roomiRooms ?? new Map<string, Room>();
const queueAddedAt = globalThis.roomiQueueAddedAt ?? new Map<string, Map<string, number>>();
globalThis.roomiRooms = rooms;
globalThis.roomiQueueAddedAt = queueAddedAt;

/** Rooms expire after 12 hours of inactivity */
const ROOM_TTL_MS = 12 * 60 * 60 * 1000;

let socketServer: SocketServerLike | null = null;

function getQueueOrder(code: string): Map<string, number> {
  if (!queueAddedAt.has(code)) {
    queueAddedAt.set(code, new Map<string, number>());
  }

  return queueAddedAt.get(code)!;
}

/** Strip voter map before sending to clients. Include the requesting user's own vote. */
function toPublicQueueItem(item: QueueItem, viewerId?: string): PublicQueueItem {
  return {
    track: item.track,
    upvotes: item.upvotes,
    downvotes: item.downvotes,
    score: item.score,
    voters: item.voters,
    myVote: viewerId ? (item.voters[viewerId] ?? null) : null,
    voteCount: item.upvotes - item.downvotes,
  };
}

function buildPublicRoomState(room: Room, viewerId?: string): PublicRoomState {
  return {
    queue: room.queue.map((item) => toPublicQueueItem(item, viewerId)),
    currentTrack: room.currentTrack,
    playback: room.playback,
    guests: room.guests,
    pendingGuests: room.pendingGuests,
    guestCount: Object.keys(room.guests).length,
    access: room.access,
  };
}

function touchRoom(room: Room): void {
  room.lastActivity = Date.now();
}

/** Periodically clean up expired rooms */
function cleanupExpiredRooms(): void {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (now - room.lastActivity > ROOM_TTL_MS) {
      rooms.delete(code);
      queueAddedAt.delete(code);
    }
  }
}

// Run cleanup every 30 minutes
setInterval(cleanupExpiredRooms, 30 * 60 * 1000);

export function generateCode(): string {
  let code = "";

  do {
    code = "";
    for (let index = 0; index < 6; index += 1) {
      code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    }
  } while (rooms.has(code));

  return code;
}

export function createRoom(hostId: string, accessToken: string, refreshToken: string): Room {
  const code = generateCode();
  const now = Date.now();
  const room: Room = {
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
    createdAt: now,
    lastActivity: now,
  };

  rooms.set(code, room);
  queueAddedAt.set(code, new Map<string, number>());
  return room;
}

export function deleteRoom(code: string): void {
  rooms.delete(code.toUpperCase());
  queueAddedAt.delete(code.toUpperCase());
}

export function getRoom(code: string): Room | undefined {
  return rooms.get(code.toUpperCase());
}

export function addToQueue(code: string, item: QueueItem): void {
  const room = getRoom(code);

  if (!room) {
    return;
  }

  room.queue.push(item);
  const queueOrderMap = getQueueOrder(room.code);
  queueOrderMap.set(item.track.id, Date.now());
  touchRoom(room);
}

export function isTrackInUse(code: string, trackId: string): boolean {
  const room = getRoom(code);
  if (!room) return false;

  if (room.currentTrack?.id === trackId) return true;
  return room.queue.some((item) => item.track.id === trackId);
}

export function vote(code: string, trackId: string, guestId: string, voteValue: "up" | "down"): QueueItem[] {
  const room = getRoom(code);

  if (!room) {
    return [];
  }

  const item = room.queue.find((entry) => entry.track.id === trackId);
  if (!item) {
    return room.queue;
  }

  const currentVote = item.voters[guestId];

  if (currentVote === voteValue) {
    if (voteValue === "up") {
      item.upvotes = Math.max(0, item.upvotes - 1);
    } else {
      item.downvotes = Math.max(0, item.downvotes - 1);
    }
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
    if (voteValue === "up") {
      item.upvotes += 1;
    } else {
      item.downvotes += 1;
    }
    item.voters[guestId] = voteValue;
  }

  item.score = item.upvotes - item.downvotes;
  touchRoom(room);
  return room.queue;
}

export function removeFromQueue(code: string, trackId: string): void {
  const room = getRoom(code);

  if (!room) {
    return;
  }

  room.queue = room.queue.filter((item) => item.track.id !== trackId);
  const queueOrderMap = getQueueOrder(room.code);
  queueOrderMap.delete(trackId);
}

export function setCurrentTrack(code: string, track: Track | null): void {
  const room = getRoom(code);

  if (!room) {
    return;
  }

  room.currentTrack = track;
  touchRoom(room);
}

export function setDeviceId(code: string, deviceId: string): void {
  const room = getRoom(code);

  if (!room) {
    return;
  }

  room.deviceId = deviceId;
}

export function setRoomAccessToken(code: string, accessToken: string): void {
  const room = getRoom(code);

  if (!room) {
    return;
  }

  room.accessToken = accessToken;
}

export function addGuest(code: string, guestId: string, displayName: string): void {
  const room = getRoom(code);

  if (!room) {
    return;
  }

  room.guests[guestId] = displayName;
  delete room.pendingGuests[guestId];
  touchRoom(room);
}

export function requestGuestAccess(
  code: string,
  guestId: string,
  displayName: string,
): "approved" | "pending" | "missing" {
  const room = getRoom(code);

  if (!room) {
    return "missing";
  }

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

export function approvePendingGuest(code: string, guestId: string): void {
  const room = getRoom(code);

  if (!room) {
    return;
  }

  const displayName = room.pendingGuests[guestId];
  if (!displayName) {
    return;
  }

  room.guests[guestId] = displayName;
  delete room.pendingGuests[guestId];
  touchRoom(room);
}

export function rejectPendingGuest(code: string, guestId: string): void {
  const room = getRoom(code);

  if (!room) {
    return;
  }

  delete room.pendingGuests[guestId];
  touchRoom(room);
}

export function setRoomAccess(code: string, access: "open" | "locked"): void {
  const room = getRoom(code);

  if (!room) {
    return;
  }

  room.access = access;
  if (access === "open") {
    for (const [guestId, displayName] of Object.entries(room.pendingGuests)) {
      room.guests[guestId] = displayName;
    }
    room.pendingGuests = {};
  }
  touchRoom(room);
}

export function removeGuest(code: string, guestId: string): void {
  const room = getRoom(code);

  if (!room) {
    return;
  }

  delete room.guests[guestId];
  touchRoom(room);
}

export function canInteractInRoom(code: string, guestId: string): boolean {
  const room = getRoom(code);

  if (!room) {
    return false;
  }

  return guestId === room.hostId || Boolean(room.guests[guestId]);
}

export function setSocketServer(io: SocketServerLike): void {
  socketServer = io;
  globalThis.roomiSocketServer = io;
}

export function emitRoomUpdated(code: string): void {
  const room = getRoom(code);
  const io = socketServer ?? globalThis.roomiSocketServer;
  if (!room) {
    return;
  }

  const state = buildPublicRoomState(room);
  const socketProviderUrl = process.env.SOCKET_PROVIDER_URL?.replace(/\/$/, "");
  if (socketProviderUrl) {
    fetch(`${socketProviderUrl}/internal/rooms/${room.code}/updated`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.SOCKET_PROVIDER_SECRET
          ? { "x-roomi-socket-secret": process.env.SOCKET_PROVIDER_SECRET }
          : {}),
      },
      body: JSON.stringify({ state }),
    }).catch(() => {
      // Real-time delivery is best-effort; clients can still refresh room state.
    });
  }

  if (!io) {
    return;
  }

  // Broadcast without viewer-specific vote info (clients track their own votes)
  io.to(room.code).emit("room-updated", state);
}

export function emitRoomUpdatedToViewer(code: string, viewerId: string): void {
  const room = getRoom(code);
  const io = socketServer ?? globalThis.roomiSocketServer;
  if (!room || !io) return;
  io.to(room.code).emit("room-updated", buildPublicRoomState(room, viewerId));
}

export function getPublicRoomState(code: string, viewerId?: string): PublicRoomState | null {
  const room = getRoom(code);

  if (!room) {
    return null;
  }

  return buildPublicRoomState(room, viewerId);
}

/** Get a user's vote for a specific track */
export function getUserVote(code: string, trackId: string, guestId: string): "up" | "down" | null {
  const room = getRoom(code);
  if (!room) return null;

  const item = room.queue.find((entry) => entry.track.id === trackId);
  if (!item) return null;

  return item.voters[guestId] ?? null;
}

export { rooms };
