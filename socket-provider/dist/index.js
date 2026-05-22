"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const http_1 = require("http");
const socket_io_1 = require("socket.io");
const PORT = Number(process.env.PORT ?? 4001);
const ROOM_TTL_MS = 12 * 60 * 60 * 1000;
const STALE_SOCKET_MS = 30000;
const CODE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const corsOrigins = (process.env.CORS_ORIGIN ?? "http://127.0.0.1:3000,http://localhost:3000")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
const rooms = new Map();
const queueAddedAt = new Map();
const presence = new Map();
const socketConnections = new Map();
function now() {
    return Date.now();
}
function normalizeRoomCode(value) {
    return typeof value === "string" ? value.trim().toUpperCase() : "";
}
function trimString(value, fallback = "") {
    return typeof value === "string" ? value.trim() || fallback : fallback;
}
function getRoom(code) {
    return rooms.get(normalizeRoomCode(code));
}
function touchRoom(room) {
    room.lastActivity = now();
}
function getQueueOrder(code) {
    const normalized = normalizeRoomCode(code);
    if (!queueAddedAt.has(normalized)) {
        queueAddedAt.set(normalized, new Map());
    }
    return queueAddedAt.get(normalized);
}
function getPresenceMap(code) {
    const normalized = normalizeRoomCode(code);
    if (!presence.has(normalized)) {
        presence.set(normalized, new Map());
    }
    return presence.get(normalized);
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
function createRoom(input) {
    const roomCode = generateCode();
    const playback = {
        isPlaying: false,
        startedAtTimestamp: 0,
        startedAtPosition: 0,
        pausedAtPosition: 0,
        duration: 0,
        track: null,
    };
    const room = {
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
    queueAddedAt.set(roomCode, new Map());
    presence.set(roomCode, new Map());
    return room;
}
function deleteRoom(code) {
    const normalized = normalizeRoomCode(code);
    rooms.delete(normalized);
    queueAddedAt.delete(normalized);
    presence.delete(normalized);
}
function sortQueue(room) {
    const order = getQueueOrder(room.roomCode);
    room.queue.sort((a, b) => {
        if (a.score !== b.score)
            return b.score - a.score;
        const aAddedAt = order.get(a.track.id) ?? Number.MAX_SAFE_INTEGER;
        const bAddedAt = order.get(b.track.id) ?? Number.MAX_SAFE_INTEGER;
        return aAddedAt - bAddedAt;
    });
}
function toPublicQueueItem(item, viewerId) {
    return {
        ...item,
        myVote: viewerId ? item.voters[viewerId] ?? null : null,
        voteCount: item.upvotes - item.downvotes,
    };
}
function getLiveGuestCount(room) {
    return Object.keys(getLiveGuests(room)).length;
}
function getLiveGuests(room) {
    const roomPresence = presence.get(room.roomCode);
    if (!roomPresence)
        return {};
    const liveGuests = {};
    for (const [guestId, displayName] of Object.entries(room.guests)) {
        if (guestId === room.hostId)
            continue;
        const entry = roomPresence.get(guestId);
        if (entry?.sockets.size) {
            liveGuests[guestId] = displayName;
        }
    }
    return liveGuests;
}
function buildPublicRoomState(room, viewerId) {
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
function emitRoomUpdated(io, roomCode) {
    const room = getRoom(roomCode);
    if (!room)
        return;
    for (const socket of io.sockets.sockets.values()) {
        if (socket.data.roomCode !== room.roomCode)
            continue;
        socket.emit("room-updated", buildPublicRoomState(room, socket.data.guestId));
    }
}
function emitPlaybackState(io, room, event, payload) {
    io.to(room.roomCode).emit(event, payload);
}
function canInteractInRoom(room, guestId) {
    return guestId === room.hostId || Boolean(room.guests[guestId]);
}
function requestGuestAccess(room, guestId, displayName) {
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
function approvePendingGuest(room, guestId) {
    const displayName = room.pendingGuests[guestId];
    if (!displayName)
        return;
    room.guests[guestId] = displayName;
    delete room.pendingGuests[guestId];
    touchRoom(room);
}
function rejectPendingGuest(room, guestId) {
    delete room.pendingGuests[guestId];
    touchRoom(room);
}
function removeGuest(room, guestId) {
    delete room.guests[guestId];
    touchRoom(room);
}
function setRoomAccess(room, access) {
    room.access = access;
    if (access === "open") {
        for (const [guestId, displayName] of Object.entries(room.pendingGuests)) {
            room.guests[guestId] = displayName;
        }
        room.pendingGuests = {};
    }
    touchRoom(room);
}
function addToQueue(room, item) {
    room.queue.push(item);
    getQueueOrder(room.roomCode).set(item.track.id, now());
    sortQueue(room);
    touchRoom(room);
}
function roomIsIdle(room) {
    return !room.currentTrack && !room.playback.track && !room.playback.isPlaying;
}
function isTrackInUse(room, trackId) {
    if (room.currentTrack?.id === trackId)
        return true;
    return room.queue.some((item) => item.track.id === trackId);
}
function vote(room, trackId, guestId, voteValue) {
    const item = room.queue.find((entry) => entry.track.id === trackId);
    if (!item)
        return;
    const currentVote = item.voters[guestId];
    if (currentVote === voteValue) {
        if (voteValue === "up")
            item.upvotes = Math.max(0, item.upvotes - 1);
        else
            item.downvotes = Math.max(0, item.downvotes - 1);
        delete item.voters[guestId];
    }
    else if (currentVote === "up" && voteValue === "down") {
        item.upvotes = Math.max(0, item.upvotes - 1);
        item.downvotes += 1;
        item.voters[guestId] = "down";
    }
    else if (currentVote === "down" && voteValue === "up") {
        item.downvotes = Math.max(0, item.downvotes - 1);
        item.upvotes += 1;
        item.voters[guestId] = "up";
    }
    else {
        if (voteValue === "up")
            item.upvotes += 1;
        else
            item.downvotes += 1;
        item.voters[guestId] = voteValue;
    }
    item.score = item.upvotes - item.downvotes;
    sortQueue(room);
    touchRoom(room);
}
function removeTracks(room, trackIds) {
    const removeSet = new Set(trackIds);
    room.queue = room.queue.filter((item) => !removeSet.has(item.track.id));
    const order = getQueueOrder(room.roomCode);
    for (const trackId of trackIds) {
        order.delete(trackId);
    }
    touchRoom(room);
}
function setCurrentTrack(room, track) {
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
function setDeviceId(room, deviceId) {
    room.deviceId = deviceId;
    touchRoom(room);
}
function setRoomAccessToken(room, accessToken) {
    room.accessToken = accessToken;
    touchRoom(room);
}
function cleanupExpiredRooms() {
    const current = now();
    for (const [roomCode, room] of rooms.entries()) {
        if (current - room.lastActivity > ROOM_TTL_MS) {
            deleteRoom(roomCode);
        }
    }
}
function selectNextTrack(room) {
    if (!room.queue.length)
        return null;
    return room.queue.find((item) => item.score >= 0) ?? room.queue[0] ?? null;
}
function claimNextTrack(roomCode) {
    const room = getRoom(roomCode);
    if (!room)
        throw new Error("Room not found");
    const nextItem = selectNextTrack(room);
    if (!nextItem) {
        setCurrentTrack(room, null);
        room.playback = {
            isPlaying: false,
            startedAtTimestamp: 0,
            startedAtPosition: 0,
            pausedAtPosition: 0,
            duration: 0,
            track: null,
        };
        return null;
    }
    room.queue = room.queue.filter((item) => item.track.id !== nextItem.track.id);
    getQueueOrder(room.roomCode).delete(nextItem.track.id);
    setCurrentTrack(room, nextItem.track);
    room.playback = {
        isPlaying: false,
        startedAtTimestamp: 0,
        startedAtPosition: 0,
        pausedAtPosition: 0,
        duration: nextItem.track.durationMs,
        track: nextItem.track,
    };
    return nextItem.track;
}
function claimTrackByUri(roomCode, uri) {
    const room = getRoom(roomCode);
    if (!room)
        throw new Error("Room not found");
    const current = room.currentTrack?.uri === uri ? room.currentTrack : null;
    const queued = room.queue.find((item) => item.track.uri === uri);
    const track = current ?? queued?.track ?? null;
    if (!track)
        throw new Error("Track is not in this room");
    if (queued) {
        room.queue = room.queue.filter((item) => item.track.id !== queued.track.id);
        getQueueOrder(room.roomCode).delete(queued.track.id);
    }
    setCurrentTrack(room, track);
    room.playback = {
        isPlaying: false,
        startedAtTimestamp: 0,
        startedAtPosition: 0,
        pausedAtPosition: 0,
        duration: track.durationMs,
        track,
    };
    return track;
}
function normalizePlaybackState(payload) {
    const input = payload;
    if (!input || typeof input !== "object")
        return null;
    const track = input.track ?? null;
    if (track &&
        (!track.id || !track.uri || !track.title || typeof track.durationMs !== "number")) {
        return null;
    }
    const duration = Number(input.duration ?? track?.durationMs ?? 0);
    const startedAtPosition = Number(input.startedAtPosition ?? 0);
    const pausedAtPosition = Number(input.pausedAtPosition ?? startedAtPosition);
    const startedAtTimestamp = Number(input.startedAtTimestamp ?? now());
    return {
        isPlaying: Boolean(input.isPlaying && track),
        startedAtTimestamp: Number.isFinite(startedAtTimestamp) ? startedAtTimestamp : now(),
        startedAtPosition: Number.isFinite(startedAtPosition) ? Math.max(0, startedAtPosition) : 0,
        pausedAtPosition: Number.isFinite(pausedAtPosition) ? Math.max(0, pausedAtPosition) : 0,
        duration: Number.isFinite(duration) ? Math.max(0, duration) : 0,
        track,
    };
}
function publishHostPlaybackState(io, room, payload) {
    const playback = normalizePlaybackState(payload);
    if (!playback)
        throw new Error("Invalid playback state");
    room.playback = playback;
    room.currentTrack = playback.track;
    room.lastActivity = now();
    emitPlaybackState(io, room, "playback:state", playback);
    emitRoomUpdated(io, room.roomCode);
    return playback;
}
function syncRoomSocket(socket, room, guestId) {
    socket.data.roomCode = room.roomCode;
    socket.data.guestId = guestId;
    socket.data.displayName = room.hostId === guestId ? "Host" : room.guests[guestId] ?? "Guest";
    socket.data.isHost = guestId === room.hostId;
    socket.join(room.roomCode);
    socketConnections.set(socket.id, { roomCode: room.roomCode, guestId, isHost: socket.data.isHost });
}
function registerPresence(room, socket, guestId, displayName, isHost) {
    const roomPresence = getPresenceMap(room.roomCode);
    const entry = roomPresence.get(guestId) ?? {
        displayName,
        isHost,
        sockets: new Set(),
        connectedAt: now(),
        lastSeenAt: now(),
    };
    entry.displayName = displayName;
    entry.isHost = isHost;
    entry.sockets.add(socket.id);
    entry.lastSeenAt = now();
    roomPresence.set(guestId, entry);
}
function unregisterPresence(roomCode, socketId, guestId) {
    const roomPresence = presence.get(roomCode);
    if (!roomPresence || !guestId)
        return;
    const entry = roomPresence.get(guestId);
    if (!entry)
        return;
    entry.sockets.delete(socketId);
    entry.lastSeenAt = now();
    if (!entry.sockets.size) {
        roomPresence.delete(guestId);
    }
}
function updatePresenceHeartbeat(roomCode, guestId) {
    const roomPresence = presence.get(roomCode);
    const entry = roomPresence?.get(guestId);
    if (!entry)
        return;
    entry.lastSeenAt = now();
}
const app = (0, express_1.default)();
app.use(express_1.default.json({ limit: "1mb" }));
const httpServer = (0, http_1.createServer)(app);
const io = new socket_io_1.Server(httpServer, {
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
    if (!isHost)
        removeGuest(room, guestId);
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
    if (intent === "approve-guest")
        approvePendingGuest(room, guestId);
    else if (intent === "reject-guest")
        rejectPendingGuest(room, guestId);
    else if (intent === "kick-guest") {
        rejectPendingGuest(room, guestId);
        removeGuest(room, guestId);
    }
    else {
        res.status(400).json({ error: "Invalid intent" });
        return;
    }
    emitRoomUpdated(io, room.roomCode);
    res.json({ ok: true });
});
app.post("/api/rooms/:roomCode/queue", (req, res) => {
    const room = getRoom(req.params.roomCode);
    const guestId = trimString(req.body?.guestId);
    const track = req.body?.track;
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
    const queueItem = {
        track: { ...track, addedBy: guestId },
        upvotes: 1,
        downvotes: 0,
        score: 1,
        voters: { [guestId]: "up" },
    };
    addToQueue(room, queueItem);
    const autoPlayTrack = roomIsIdle(room) ? claimNextTrack(room.roomCode) : null;
    emitRoomUpdated(io, room.roomCode);
    res.json({ ok: true, autoPlayTrack, state: buildPublicRoomState(room, guestId) });
});
app.post("/api/rooms/:roomCode/queue/batch", (req, res) => {
    const room = getRoom(req.params.roomCode);
    const guestId = trimString(req.body?.guestId);
    const tracks = Array.isArray(req.body?.tracks) ? req.body.tracks : [];
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
        const queueItem = {
            track: { ...track, addedBy: guestId },
            upvotes: 1,
            downvotes: 0,
            score: 1,
            voters: { [guestId]: "up" },
        };
        addToQueue(room, queueItem);
        addedCount += 1;
    }
    const autoPlayTrack = addedCount > 0 && roomIsIdle(room) ? claimNextTrack(room.roomCode) : null;
    if (addedCount > 0) {
        emitRoomUpdated(io, room.roomCode);
    }
    res.json({ ok: true, addedCount, autoPlayTrack, state: buildPublicRoomState(room, guestId) });
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
    setCurrentTrack(room, req.body?.track ?? null);
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
        const track = claimNextTrack(room.roomCode);
        emitRoomUpdated(io, room.roomCode);
        res.json({ currentTrack: track, playback: room.playback, queue: room.queue });
    }
    catch (error) {
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
        if (!room.playback.track) {
            throw new Error("No active track");
        }
        const track = room.playback.track;
        const clamped = Math.max(0, Math.min(track.durationMs, positionMs));
        const playback = {
            isPlaying: room.playback.isPlaying,
            startedAtTimestamp: room.playback.isPlaying ? now() : room.playback.startedAtTimestamp,
            startedAtPosition: clamped,
            pausedAtPosition: clamped,
            duration: track.durationMs,
            track,
        };
        room.playback = playback;
        room.currentTrack = track;
        emitPlaybackState(io, room, "playback:state", playback);
        emitRoomUpdated(io, room.roomCode);
        res.json({ playback });
    }
    catch (error) {
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
        const track = claimTrackByUri(room.roomCode, uri);
        emitRoomUpdated(io, room.roomCode);
        res.json({ currentTrack: track, playback: room.playback, queue: room.queue });
    }
    catch (error) {
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
        if (!room.playback.track) {
            throw new Error("No active track");
        }
        const positionMs = room.playback.isPlaying
            ? Math.max(0, room.playback.startedAtPosition + (now() - room.playback.startedAtTimestamp))
            : room.playback.pausedAtPosition;
        const playback = {
            isPlaying: !room.playback.isPlaying,
            startedAtTimestamp: now(),
            startedAtPosition: positionMs,
            pausedAtPosition: positionMs,
            duration: room.playback.track.durationMs,
            track: room.playback.track,
        };
        room.playback = playback;
        room.currentTrack = room.playback.track;
        emitPlaybackState(io, room, "playback:state", playback);
        emitRoomUpdated(io, room.roomCode);
        res.json({ currentTrack: room.currentTrack, playback });
    }
    catch (error) {
        res.status(500).json({ error: error instanceof Error ? error.message : "Failed to toggle playback" });
    }
});
app.post("/api/rooms/:roomCode/playback/state", (req, res) => {
    const room = getRoom(req.params.roomCode);
    if (!room) {
        res.status(404).json({ error: "Room not found" });
        return;
    }
    try {
        const playback = publishHostPlaybackState(io, room, req.body?.playback);
        res.json({ playback });
    }
    catch (error) {
        res.status(400).json({ error: error instanceof Error ? error.message : "Invalid playback state" });
    }
});
io.on("connection", (socket) => {
    socket.on("join-room", (payload, ack) => {
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
    socket.on("sync-room", (_payload, ack) => {
        const room = socket.data.roomCode ? getRoom(socket.data.roomCode) : undefined;
        const guestId = socket.data.guestId;
        if (!room || !guestId) {
            ack?.({ error: "Room not found" });
            return;
        }
        ack?.({ ok: true, state: buildPublicRoomState(room, guestId) });
    });
    socket.on("room-ping", (_payload, ack) => {
        const roomCode = socket.data.roomCode;
        const guestId = socket.data.guestId;
        if (roomCode && guestId) {
            updatePresenceHeartbeat(roomCode, guestId);
            const room = getRoom(roomCode);
            if (room)
                touchRoom(room);
        }
        ack?.({ ok: true });
    });
    socket.on("disconnect", () => {
        const meta = socketConnections.get(socket.id);
        socketConnections.delete(socket.id);
        if (!meta)
            return;
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
                if (room)
                    emitRoomUpdated(io, room.roomCode);
            }
        }
    }
}, 15000);
httpServer.listen(PORT, () => {
    console.log(`Socket provider listening on http://127.0.0.1:${PORT}`);
});
