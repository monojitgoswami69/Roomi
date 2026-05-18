"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronUp,
  Copy,
  DoorClosed,
  ListMusic,
  Lock,
  LockOpen,
  LogOut,
  Music,
  FastForward,
  Pause,
  Play,
  Plus,
  QrCode,
  Rewind,
  SkipBack,
  SkipForward,
  UserCheck,
  UserRoundX,
  Users,
  X,
} from "lucide-react";
import { io, type Socket } from "socket.io-client";
import qrcode from "qrcode";
import { useRouter } from "next/navigation";
import Player from "@/components/Player";
import Queue from "@/components/Queue";
import SearchModal from "@/components/SearchModal";
import type { PlaybackState, Track } from "@/lib/roomStore";

function CustomQRCode({ value }: { value: string }) {
  const qrData = useMemo(() => {
    try {
      return qrcode.create(value, { errorCorrectionLevel: "M" });
    } catch {
      return null;
    }
  }, [value]);

  if (!qrData) return <QrCode className="h-10 w-10 text-slate-400" />;

  const modulesSize = qrData.modules.size;
  const paths = [];

  for (let row = 0; row < modulesSize; row++) {
    for (let col = 0; col < modulesSize; col++) {
      if (qrData.modules.data[row * modulesSize + col]) {
        const isFinderPattern =
          (row < 7 && col < 7) ||
          (col > modulesSize - 8 && row < 7) ||
          (row > modulesSize - 8 && col < 7);

        if (isFinderPattern) {
          continue; // Will draw beautiful rounded finders manually
        } else {
          paths.push(
            <circle
              key={`${row}-${col}`}
              cx={col + 0.5}
              cy={row + 0.5}
              r={0.4}
              fill="#FFFFFF"
            />
          );
        }
      }
    }
  }
  
  // Render the 3 rounded finder patterns
  const finderPositions = [
    { x: 0, y: 0 },
    { x: modulesSize - 7, y: 0 },
    { x: 0, y: modulesSize - 7 },
  ];

  finderPositions.forEach((pos, idx) => {
    paths.push(
      <g key={`finder-${idx}`}>
        <rect
          x={pos.x + 0.5}
          y={pos.y + 0.5}
          width={6}
          height={6}
          rx={1.5}
          fill="none"
          stroke="#FFFFFF"
          strokeWidth={1}
        />
        <rect
          x={pos.x + 2}
          y={pos.y + 2}
          width={3}
          height={3}
          rx={0.75}
          fill="#FFFFFF"
        />
      </g>
    );
  });

  return (
    <svg
      className="h-[136px] w-[136px]"
      viewBox={`0 0 ${modulesSize} ${modulesSize}`}
    >
      {paths}
    </svg>
  );
}

type UIQueueItem = {
  track: Track;
  upvotes: number;
  downvotes: number;
  score: number;
  myVote?: "up" | "down" | null;
  voteCount?: number;
  voters?: Record<string, "up" | "down">;
};

type RoomUpdatedPayload = {
  queue: UIQueueItem[];
  currentTrack: Track | null;
  playback?: PlaybackState;
  guests: Record<string, string>;
  pendingGuests: Record<string, string>;
  guestCount: number;
  access: "open" | "locked";
};

type RoomStatePayload = RoomUpdatedPayload & {
  roomCode?: string;
  hostId?: string;
};

type SocketAckPayload = {
  ok?: boolean;
  error?: string;
  state?: RoomUpdatedPayload;
};

declare global {
  interface Window {
    roomiDeviceId?: string;
  }
}

function formatDuration(ms: number): string {
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function progressFillGradient() {
  return "linear-gradient(90deg, #38BDF8 0%, #60A5FA 100%)";
}

const socketUrl = process.env.NEXT_PUBLIC_SOCKET_URL;

export default function HostPage() {
  const router = useRouter();
  const socketRef = useRef<Socket | null>(null);
  const skipGuardRef = useRef(false);
  const recordRef = useRef<HTMLDivElement | null>(null);
  const progressMsRef = useRef(0);
  const lastSeekAtRef = useRef(0);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [status, setStatus] = useState<"Playing" | "Paused" | "Waiting for songs...">(
    "Waiting for songs...",
  );
  const [accessToken, setAccessToken] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [hostId, setHostId] = useState("");
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
  const [queue, setQueue] = useState<UIQueueItem[]>([]);
  const [guests, setGuests] = useState<Record<string, string>>({});
  const [pendingGuests, setPendingGuests] = useState<Record<string, string>>({});
  const [roomAccess, setRoomAccessState] = useState<"open" | "locked">("open");
  const [showSearch, setShowSearch] = useState(false);
  const [copied, setCopied] = useState(false);
  const [origin] = useState(() => (typeof window !== "undefined" ? window.location.origin : ""));
  const [progressMs, setProgressMs] = useState(0);
  const [playbackState, setPlaybackState] = useState<PlaybackState | null>(null);
  const isDraggingRef = useRef(false);

  const [showGuests, setShowGuests] = useState(false);
  const [showDrawer, setShowDrawer] = useState(false);
  const [accessUpdating, setAccessUpdating] = useState(false);
  const [approvingGuestId, setApprovingGuestId] = useState<string | null>(null);
  const [socketStatus, setSocketStatus] = useState<"connecting" | "connected" | "reconnecting" | "offline">("connecting");

  const displayTrack = currentTrack;
  const durationMs = displayTrack?.durationMs ?? 1;
  const guestCount = useMemo(() => Object.keys(guests).length, [guests]);
  const joinUrl = useMemo(
    () => (roomCode && origin ? `${origin}/room/${roomCode}` : ""),
    [origin, roomCode],
  );
  const isPlaying = status === "Playing";
  const progress = durationMs > 0 ? progressMs / durationMs : 0;
  const playedRatio = Math.max(0, Math.min(1, progress));
  const hasTrack = !!displayTrack;

  const visibleGuests = useMemo(
    () =>
      Object.entries(guests).filter(([guestId]) => guestId !== hostId).map(([id, name]) => ({
        id,
        name,
      })),
    [guests, hostId],
  );

  const visiblePendingGuests = useMemo(
    () => Object.entries(pendingGuests).map(([id, name]) => ({ id, name })),
    [pendingGuests],
  );

  const applyRoomState = useCallback((payload: RoomUpdatedPayload | RoomStatePayload | null | undefined) => {
    if (!payload) return;
    setQueue(payload.queue ?? []);
    setCurrentTrack(payload.currentTrack ?? null);
    if (payload.playback) {
      setPlaybackState(payload.playback);
      setStatus(payload.playback.isPlaying ? "Playing" : payload.playback.track ? "Paused" : "Waiting for songs...");
    } else if (!payload.currentTrack) {
      setPlaybackState(null);
      progressMsRef.current = 0;
      setProgressMs(0);
    }
    setGuests(payload.guests ?? {});
    setPendingGuests(payload.pendingGuests ?? {});
    setRoomAccessState(payload.access ?? "open");
  }, []);

  const fetchNextTrack = useCallback(async () => {
    if (!roomCode || skipGuardRef.current) return;
    skipGuardRef.current = true;
    setTimeout(() => {
      skipGuardRef.current = false;
    }, 1500);

    const response = await fetch("/api/player/next", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roomCode }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(payload?.error ?? "Could not skip track");
      return;
    }
    setCurrentTrack(payload?.currentTrack ?? null);
    setPlaybackState(payload?.playback ?? null);
  }, [roomCode]);

  const togglePlayPause = useCallback(async () => {
    if (!hasTrack) return;
    const response = await fetch("/api/player/toggle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roomCode }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(payload?.error ?? "Could not toggle playback");
    }
  }, [hasTrack, roomCode]);

  useEffect(() => {
    if (!playbackState?.track) {
      progressMsRef.current = 0;
      return;
    }

    const updateProgress = () => {
      if (isDraggingRef.current) return;
      const next = playbackState.isPlaying
        ? playbackState.startedAtPosition + (Date.now() - playbackState.startedAtTimestamp)
        : playbackState.pausedAtPosition;
      const clamped = Math.max(0, Math.min(playbackState.duration, next));
      progressMsRef.current = clamped;
      setProgressMs(clamped);
    };

    updateProgress();
    const interval = window.setInterval(updateProgress, 500);
    return () => window.clearInterval(interval);
  }, [playbackState]);

  useEffect(() => {
    if (recordRef.current) {
      recordRef.current.style.animationPlayState = isPlaying ? "running" : "paused";
    }
  }, [isPlaying]);

  useEffect(() => {
    let cancelled = false;

    const bootstrapHost = async () => {
      setLoading(true);
      setError("");
      try {
        const tokenResponse = await fetch("/api/auth/token");
        if (!tokenResponse.ok) {
          setError(tokenResponse.status === 403 ? "Session expired. Please reconnect Spotify." : "Could not load host session.");
          setLoading(false);
          return;
        }
        const tokenPayload = await tokenResponse.json();
        if (cancelled) return;
        setAccessToken(tokenPayload.access_token ?? "");

        const roomResponse = await fetch(`/api/room/info?viewerId=${encodeURIComponent("host")}`);
        if (!roomResponse.ok) {
          setError("Realtime service is recovering your room...");
          const recreateResponse = await fetch("/api/room/create", { method: "POST" });
          if (!recreateResponse.ok) {
            setError("Room not found. Create a new room from the home page.");
            setLoading(false);
            return;
          }
          const retryRoomResponse = await fetch(`/api/room/info?viewerId=${encodeURIComponent("host")}`);
          if (!retryRoomResponse.ok) {
            setError("Room not found. Create a new room from the home page.");
            setLoading(false);
            return;
          }
          const retryRoomPayload = await retryRoomResponse.json();
          if (cancelled) return;
          setError("");
          setRoomCode(retryRoomPayload.roomCode ?? "");
          setHostId(retryRoomPayload.hostId ?? "");
          applyRoomState(retryRoomPayload);
          return;
        }
        const roomPayload = await roomResponse.json();
        if (cancelled) return;

        setRoomCode(roomPayload.roomCode ?? "");
        setHostId(roomPayload.hostId ?? "");
        applyRoomState(roomPayload);
      } catch {
        if (!cancelled) setError("Failed to initialize host room");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    bootstrapHost().catch(() => {
      setError("Failed to initialize host room");
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [applyRoomState, router]);

  // Refresh the Spotify access token every 45 minutes (tokens expire in 60 min)
  useEffect(() => {
    if (!roomCode) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch("/api/auth/token");
        if (res.ok) {
          const payload = await res.json();
          if (payload.access_token) setAccessToken(payload.access_token);
        }
      } catch { /* best effort */ }
    }, 45 * 60 * 1000);
    return () => clearInterval(interval);
  }, [roomCode]);

  const refreshRoomState = useCallback(async () => {
    if (!roomCode) return;
    try {
      const response = await fetch(`/api/room/info?viewerId=${encodeURIComponent("host")}`, { cache: "no-store" });
      if (response.status === 404) {
        setError("Realtime service is recovering your room...");
        const recreateResponse = await fetch("/api/room/create", { method: "POST" });
        if (!recreateResponse.ok) return;
        const retryRoomResponse = await fetch(`/api/room/info?viewerId=${encodeURIComponent("host")}`, { cache: "no-store" });
        if (!retryRoomResponse.ok) return;
        const retryRoomPayload = await retryRoomResponse.json();
        setError("");
        applyRoomState(retryRoomPayload);
        setRoomCode(retryRoomPayload.roomCode ?? roomCode);
        setHostId(retryRoomPayload.hostId ?? hostId);
        return;
      }
      if (!response.ok) return;
      const payload = await response.json();
      applyRoomState(payload);
    } catch {
      // keep socket as the primary transport
    }
  }, [applyRoomState, hostId, roomCode]);

  useEffect(() => {
    if (!roomCode || !hostId) return;
    const socket = io(socketUrl || undefined, {
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 250,
      reconnectionDelayMax: 2000,
      timeout: 10000,
    });
    socketRef.current = socket;
    socket.on("connect", () => {
      setSocketStatus("connected");
      socket.emit("join-room", { roomCode, guestId: hostId, displayName: "Host" }, (ack: SocketAckPayload) => {
        if (ack?.state) applyRoomState(ack.state);
        if (ack?.error) setError(ack.error);
      });
      socket.emit("sync-room", {}, (ack: SocketAckPayload) => {
        if (ack?.state) applyRoomState(ack.state);
      });
    });
    socket.io.on("reconnect_attempt", () => setSocketStatus("reconnecting"));
    socket.io.on("reconnect", () => {
      setSocketStatus("connected");
      void refreshRoomState();
    });
    socket.io.on("reconnect_error", () => setSocketStatus("reconnecting"));
    socket.on("disconnect", () => setSocketStatus("offline"));
    socket.on("connect_error", () => setSocketStatus("offline"));
    socket.on("room-error", (payload: { error?: string }) => {
      setError(payload?.error ?? "Socket room error");
      void refreshRoomState();
    });
    socket.on("socket-stale", () => {
      socket.emit("sync-room", {}, (ack: SocketAckPayload) => {
        if (ack?.state) applyRoomState(ack.state);
      });
      void refreshRoomState();
    });
    socket.on("room-updated", (payload: RoomUpdatedPayload) => {
      applyRoomState(payload);
    });
    socket.on("playback:state", (payload: PlaybackState) => {
      setPlaybackState(payload);
      setCurrentTrack(payload.track);
      setStatus(payload.isPlaying ? "Playing" : payload.track ? "Paused" : "Waiting for songs...");
    });
    socket.on("playback:started", (payload: PlaybackState) => {
      setPlaybackState(payload);
      setCurrentTrack(payload.track);
      setStatus("Playing");
    });
    socket.on("playback:error", (payload: { error?: string }) => {
      setError(payload?.error ?? "Playback error");
    });
    const pingInterval = window.setInterval(() => {
      socket.emit("room-ping", {}, (ack: { ok?: boolean }) => {
        if (!ack?.ok) void refreshRoomState();
      });
    }, 15000);
    return () => {
      window.clearInterval(pingInterval);
      socket.disconnect();
      socketRef.current = null;
    };
  }, [applyRoomState, roomCode, hostId, refreshRoomState]);

  const handlePlayerReady = useCallback(
    async (deviceId: string) => {
      window.roomiDeviceId = deviceId;
      const response = await fetch("/api/room/setDevice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomCode, deviceId }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        setError(payload?.error ?? "Could not set device");
      }
    },
    [roomCode],
  );

  const seekTo = async (positionMs: number) => {
    const nextPosition = Math.max(0, Math.min(durationMs, positionMs));
    lastSeekAtRef.current = Date.now();
    progressMsRef.current = nextPosition;
    setProgressMs(nextPosition);
    const response = await fetch("/api/player/seek", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roomCode, positionMs: nextPosition }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      setError(payload?.error ?? "Could not seek playback");
    }
  };

  const shiftBy = async (deltaMs: number) => {
    await seekTo(progressMsRef.current + deltaMs);
  };

  const handleProgressPointerDown = () => {
    isDraggingRef.current = true;
  };
  
  const handleProgressChange = (value: string) => {
    isDraggingRef.current = true;
    if (!displayTrack || durationMs <= 0) return;
    const next = Number(value);
    progressMsRef.current = next;
    setProgressMs(next);
  };

  const handleProgressPointerUp = async (e: React.PointerEvent<HTMLInputElement> | React.MouseEvent<HTMLInputElement> | React.TouchEvent<HTMLInputElement>) => {
    isDraggingRef.current = false;
    if (!displayTrack || durationMs <= 0) return;
    const commitValue = Number(e.currentTarget.value);
    await seekTo(commitValue);
  };

  const setRoomAccess = async (access: "open" | "locked") => {
    setAccessUpdating(true);
    setError("");
    try {
      const response = await fetch("/api/room/access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent: "set-access", access }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setError(payload?.error ?? "Could not update room access");
      }
    } catch {
      setError("Could not update room access");
    } finally {
      setAccessUpdating(false);
    }
  };

  const handleGuestModeration = async (
    guestId: string,
    intent: "approve-guest" | "reject-guest" | "kick-guest",
  ) => {
    setApprovingGuestId(guestId);
    try {
      await fetch("/api/room/access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent, guestId }),
      });
    } finally {
      setApprovingGuestId(null);
    }
  };

  const copyCode = async () => {
    if (!roomCode) return;
    await navigator.clipboard.writeText(roomCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const endSession = async () => {
    try {
      await fetch("/api/room/end", { method: "POST" });
    } finally {
      router.push("/");
    }
  };

  if (loading) {
    return (
      <div className="roomi-bg min-h-screen flex items-center justify-center">
        <div className="h-10 w-10 rounded-full border-2 border-slate-700 border-t-sky-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="roomi-bg h-screen overflow-hidden text-slate-100">
      <div className="hidden">
        <Player accessToken={accessToken} onReady={handlePlayerReady} onTrackEnd={() => {}} onStatusChange={() => {}} onTrackChange={() => {}} onError={setError} />
      </div>

      <main className="mx-auto flex h-full max-w-[1600px] flex-col px-4 py-0 sm:px-6 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(420px,1fr)] lg:px-8 lg:py-0">
        <section className="min-h-0 flex flex-1 flex-col justify-center overflow-y-auto px-0 pb-16 pt-0 lg:px-4 lg:pb-0 lg:pt-0 lg:border-r lg:border-white/10 lg:pr-8">
          <div className="flex w-full flex-col items-center justify-center">

            <div className="relative flex h-[15rem] w-[15rem] items-center justify-center lg:h-[26rem] lg:w-[26rem]">
              <div
                ref={recordRef}
                className="record-spin absolute z-10 h-[15rem] w-[15rem] rounded-full shadow-[0_40px_100px_rgba(0,0,0,0.8)] lg:h-[26rem] lg:w-[26rem]"
                style={{
                  background:
                    "conic-gradient(from 45deg, #1a1a1a, #2a2a2a, #1a1a1a, #333, #1a1a1a, #2a2a2a, #1a1a1a, #333, #1a1a1a), radial-gradient(circle, transparent 20%, #1a1a1a 21%, #0d0d0d 22%, #1a1a1a 24%, #0d0d0d 26%, #222 28%, #0d0d0d 32%, #1a1a1a 36%, #0d0d0d 40%, #1a1a1a 45%, #0d0d0d 50%, #222 55%, #0d0d0d 60%, #1a1a1a 68%, #0d0d0d 76%, #1a1a1a 84%, #0d0d0d 92%, #1a1a1a 100%)",
                  backgroundBlendMode: "overlay"
                }}
              >
                {/* Shimmer highlight overlay */}
                <div
                  className="absolute inset-0 rounded-full"
                  style={{
                    background: "conic-gradient(from 120deg, transparent 0%, rgba(255,255,255,0.04) 10%, transparent 20%, rgba(255,255,255,0.06) 45%, transparent 55%, rgba(255,255,255,0.03) 70%, transparent 80%)",
                    mixBlendMode: "screen",
                  }}
                />
              </div>

              <div 
                className="absolute z-20 h-[5.8rem] w-[5.8rem] overflow-hidden rounded-full lg:h-[10.2rem] lg:w-[10.2rem]"
                style={{
                   maskImage: "radial-gradient(circle, black 50%, rgba(0,0,0,0.4) 70%, transparent 95%)",
                   WebkitMaskImage: "radial-gradient(circle, black 50%, rgba(0,0,0,0.4) 70%, transparent 95%)"
                }}
              >
                {displayTrack?.albumArt ? (
                  <img
                    src={displayTrack.albumArt}
                    alt={displayTrack.title}
                    className="h-full w-full object-cover opacity-90"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-zinc-900">
                    <Music className="h-10 w-10 text-white/50" />
                  </div>
                )}
              </div>

            </div>

            <div className="mt-6 text-center w-full max-w-2xl px-4">
              <h2 className="mx-auto text-[2rem] font-semibold tracking-tight text-slate-50 lg:text-[2.35rem] line-clamp-1 truncate">
                {displayTrack?.title || "Waiting for songs..."}
              </h2>
              <p className="mt-1.5 text-[15px] text-slate-400 lg:text-base line-clamp-1 truncate">
                {displayTrack?.artist || "Queue something and the deck will come alive."}
              </p>
            </div>

          <div className="mt-8 w-full max-w-2xl px-4">
            {/* Progress bar — only interactive when a track is loaded */}
            <div
              className={`group relative flex h-9 items-center ${hasTrack ? "cursor-pointer" : "cursor-default opacity-40"}`}
            >
              <div className="relative h-2.5 w-full rounded-full bg-slate-500/20 pointer-events-none">
                {hasTrack ? (
                  <>
                    <div
                      className="absolute inset-y-0 left-0 rounded-full shadow-[0_0_22px_rgba(96,165,250,0.45)] transition-none ease-linear"
                      style={{
                        width: `${playedRatio * 100}%`,
                        background: progressFillGradient(),
                      }}
                    />
                    <div
                      className="absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full border border-sky-100/45 bg-sky-300 shadow-[0_0_0_9px_rgba(56,189,248,0.18)] transition-none ease-linear group-hover:scale-125 group-hover:shadow-[0_0_0_12px_rgba(56,189,248,0.25)]"
                      style={{ left: `calc(${playedRatio * 100}% - 8px)` }}
                    />
                  </>
                ) : null}
              </div>
              {hasTrack ? (
                <input
                  type="range"
                  min={0}
                  max={Math.max(1, durationMs)}
                  step={1}
                  value={Math.min(progressMs, durationMs)}
                  onPointerDown={handleProgressPointerDown}
                  onPointerUp={handleProgressPointerUp}
                  onTouchStart={handleProgressPointerDown}
                  onTouchEnd={handleProgressPointerUp}
                  onChange={(e) => handleProgressChange(e.target.value)}
                  className="progress-slider absolute inset-x-0 top-1/2 h-8 -translate-y-1/2 cursor-pointer z-10"
                  style={{ opacity: 0 }}
                  aria-label="Track position"
                />
              ) : null}
            </div>

            <div className="mt-2.5 flex items-center justify-between text-[12px] font-semibold text-slate-400/95">
              <span className="font-mono">{hasTrack ? formatDuration(progressMs) : "0:00"}</span>
              <span className="font-mono">{hasTrack ? formatDuration(durationMs) : "0:00"}</span>
            </div>

            {/* Transport controls — disabled when idle */}
            <div className="mt-5 flex items-center justify-center">
              <div className="inline-flex items-center gap-2 lg:gap-2.5">
                <button
                  type="button"
                  disabled={!hasTrack}
                  onClick={() => shiftBy(-10000)}
                  className="deck-btn disabled:opacity-30 disabled:cursor-not-allowed"
                  aria-label="Back 10 seconds"
                >
                  <Rewind className="h-6 w-6 opacity-85" />
                </button>
                <button
                  type="button"
                  disabled={!hasTrack}
                  onClick={() => seekTo(0)}
                  className="deck-btn disabled:opacity-30 disabled:cursor-not-allowed"
                  aria-label="Restart track"
                >
                  <SkipBack className="h-5 w-5 opacity-85" />
                </button>
                <button
                  type="button"
                  disabled={!hasTrack}
                  onClick={togglePlayPause}
                  className="deck-btn-primary disabled:opacity-40 disabled:cursor-not-allowed"
                  aria-label={isPlaying ? "Pause" : "Play"}
                >
                  {isPlaying ? (
                    <Pause className="h-7 w-7 fill-current" />
                  ) : (
                    <Play className="ml-1 h-7 w-7 fill-current" />
                  )}
                </button>
                <button
                  type="button"
                  disabled={!hasTrack && queue.length === 0}
                  onClick={fetchNextTrack}
                  className="deck-btn disabled:opacity-30 disabled:cursor-not-allowed"
                  aria-label="Next track"
                >
                  <SkipForward className="h-5 w-5 opacity-85" />
                </button>
                <button
                  type="button"
                  disabled={!hasTrack}
                  onClick={() => shiftBy(10000)}
                  className="deck-btn disabled:opacity-30 disabled:cursor-not-allowed"
                  aria-label="Forward 10 seconds"
                >
                  <FastForward className="h-6 w-6 opacity-85" />
                </button>
              </div>
            </div>
          </div>
          </div>

        </section>

        {/* ── Mobile bottom tab ── */}
        <button
          type="button"
          onClick={() => setShowDrawer(true)}
          className="fixed bottom-0 left-0 right-0 z-40 flex items-center justify-center gap-2 rounded-t-2xl border-t border-white/10 bg-slate-900/95 px-4 py-3.5 backdrop-blur-xl lg:hidden"
          aria-label="Open queue"
        >
          <ChevronUp className="h-4 w-4 text-slate-400" />
          <span className="text-sm font-semibold text-slate-200">Queue</span>
          {queue.length > 0 ? (
            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-emerald-500 px-1.5 text-[11px] font-bold text-slate-950">
              {queue.length}
            </span>
          ) : null}
        </button>

        {/* ── Mobile drawer backdrop ── */}
        {showDrawer ? (
          <div
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm lg:hidden"
            onClick={() => setShowDrawer(false)}
          />
        ) : null}

        {/* ── Right column: desktop = inline, mobile = slide-up drawer ── */}
        <section
          className={`
            fixed inset-x-0 bottom-0 z-50 flex h-[min(92dvh,calc(100dvh-0.75rem))] min-h-0 flex-col overflow-hidden rounded-t-3xl border-t border-white/10 bg-slate-950/98 shadow-[0_-20px_60px_rgba(0,0,0,0.6)] backdrop-blur-2xl transition-transform duration-300 ease-out
            lg:static lg:z-auto lg:h-full lg:max-h-none lg:rounded-none lg:border-t-0 lg:bg-transparent lg:shadow-none lg:backdrop-blur-none lg:transition-none
            ${showDrawer ? "translate-y-0" : "translate-y-full lg:translate-y-0"}
          `}
        >
          {/* Drawer handle — mobile only */}
          <div className="flex items-center justify-center py-2 lg:hidden">
            <button
              type="button"
              onClick={() => setShowDrawer(false)}
              className="h-1.5 w-12 rounded-full bg-white/20"
              aria-label="Close drawer"
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3 pb-6 lg:h-full lg:overflow-hidden lg:p-4 lg:pl-8">
          <div className="flex min-h-full flex-col lg:h-full lg:overflow-hidden">
            <div className="z-20 shrink-0 border-b border-white/10 pb-4 pt-3 lg:border-white/8 lg:pb-5 lg:pt-5">
              <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)_auto] lg:grid-cols-[minmax(0,1fr)_minmax(180px,0.9fr)_clamp(112px,9vw,148px)] xl:grid-cols-[minmax(0,1fr)_minmax(220px,0.9fr)_148px]">
                <div className="flex h-full min-w-0 flex-col justify-start">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-sky-200/55">
                      Room ID
                    </p>
                    <div className="mt-3 flex min-w-0 flex-wrap items-center gap-2.5">
                      <h2 className="min-w-0 break-all font-mono text-[clamp(2rem,8vw,2.6rem)] font-bold tracking-[0.18em] text-sky-300 lg:text-[clamp(2rem,3vw,2.35rem)]">
                        {roomCode}
                      </h2>
                      <button
                        type="button"
                        onClick={copyCode}
                        className="inline-flex h-8 w-8 shrink-0 items-center justify-center text-slate-300 transition hover:text-sky-200"
                        aria-label="Copy room code"
                      >
                        {copied ? <Check className="h-5 w-5 text-emerald-300" /> : <Copy className="h-5 w-5" />}
                      </button>
                    </div>
                  </div>

                  <div className="mt-4 flex w-full max-w-[12rem] flex-col gap-2">
                    <button 
                      type="button"
                      onClick={() => setShowGuests(true)}
                      className="inline-flex h-9 w-full min-w-0 items-center justify-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-2 text-xs font-semibold text-slate-200 transition hover:bg-white/10"
                    >
                      <Users className="h-3.5 w-3.5" />
                      <span className="truncate">{guestCount} connected</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        void endSession();
                      }}
                      className="inline-flex h-9 w-full min-w-0 items-center justify-center gap-1.5 rounded-md border border-rose-400/20 bg-rose-500/10 px-2 text-xs font-semibold text-rose-200 transition hover:bg-rose-500/20"
                      aria-label="End session"
                    >
                      <LogOut className="h-4 w-4" />
                      <span className="truncate">End session</span>
                    </button>
                  </div>
                </div>

                <div className="flex h-full min-w-0 flex-col justify-start">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-sky-200/55">
                      Room status
                    </p>
                    <p className="mt-2 max-w-[18rem] text-[13px] leading-6 text-slate-400">
                      Choose whether guests join freely or need host approval.
                    </p>
                  </div>

                  <div className="mt-4 inline-flex h-9 w-fit max-w-full items-center rounded-md border border-white/10 bg-slate-950/40 p-1">
                    <button
                      type="button"
                      disabled={accessUpdating}
                      onClick={() => setRoomAccess("open")}
                      className={`inline-flex h-7 items-center gap-1.5 rounded px-3 text-xs font-semibold transition ${
                        roomAccess === "open"
                          ? "bg-sky-400 text-slate-950"
                          : "text-slate-300 hover:bg-white/8"
                      }`}
                    >
                      <LockOpen className="h-3.5 w-3.5" />
                      Open
                    </button>
                    <button
                      type="button"
                      disabled={accessUpdating}
                      onClick={() => setRoomAccess("locked")}
                      className={`inline-flex h-7 items-center gap-1.5 rounded px-3 text-xs font-semibold transition ${
                        roomAccess === "locked"
                          ? "bg-amber-300 text-slate-950"
                          : "text-slate-300 hover:bg-white/8"
                      }`}
                    >
                      <Lock className="h-3.5 w-3.5" />
                      Locked
                    </button>
                  </div>
                </div>

                <div className="flex h-full items-start justify-end p-0">
                  <div className="flex shrink-0 scale-[0.72] origin-top-right min-[420px]:scale-[0.78] sm:scale-[0.84] lg:scale-100">
                    {joinUrl ? <CustomQRCode value={joinUrl} /> : <QrCode className="h-10 w-10 text-slate-400" />}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col py-5 lg:overflow-hidden lg:py-0">
            <div className="z-10 mb-4 flex shrink-0 flex-wrap items-center justify-between gap-3 lg:mt-0 lg:pt-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-sky-200/55">
                  Queue
                </p>
                <h3 className="mt-2 text-xl font-semibold tracking-tight text-slate-50">
                  Up next
                </h3>
              </div>
              <div className="flex items-center gap-2 text-sm font-medium text-slate-400">
                <span>{queue.length} songs</span>
                <span className={`h-2 w-2 rounded-full ${
                  socketStatus === "connected"
                    ? "bg-emerald-400"
                    : socketStatus === "reconnecting" || socketStatus === "connecting"
                      ? "bg-amber-300"
                      : "bg-rose-400"
                }`} />
              </div>
            </div>

            <div className="z-10 mb-4 shrink-0 bg-transparent py-1 lg:py-3">
              <button
                type="button"
                onClick={() => setShowSearch(true)}
                className="inline-flex h-14 w-full items-center justify-center gap-2 rounded-[22px] bg-emerald-500 px-4 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 lg:w-auto"
              >
                <Plus className="h-5 w-5" />
                Add songs
              </button>
            </div>

            {error ? (
              <div className="mb-4 rounded-[22px] border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
                {error}
              </div>
            ) : null}

            <div className="min-h-[12rem] flex-1 overflow-y-auto overscroll-contain pb-8 pr-1 lg:h-full lg:min-h-0">
              {queue.length === 0 && !currentTrack ? (
                <div className="flex min-h-[14rem] flex-col items-center justify-center px-4 text-center">
                  <ListMusic className="h-7 w-7 text-slate-600" />
                  <p className="mt-3 text-sm font-semibold text-slate-200">No songs queued</p>
                  <p className="mt-1 text-xs text-slate-500">Open the popup and build the next wave.</p>
                </div>
              ) : (
                <Queue
                  items={queue}
                  guestId={hostId}
                  roomCode={roomCode}
                  currentTrack={currentTrack}
                  onStateChange={({ queue: nextQueue, currentTrack: nextCurrentTrack }) => {
                    setQueue(nextQueue);
                    setCurrentTrack(nextCurrentTrack);
                  }}
                />
              )}
            </div>
            </div>

          </div>
          </div>
        </section>
      </main>

      {showGuests ? (
        <div className="fixed inset-0 z-50 bg-black/55 backdrop-blur-sm">
          <div className="mx-auto flex h-full w-full max-w-4xl items-center px-4 py-6 sm:px-6">
            <div className="w-full overflow-hidden rounded-[28px] border border-white/10 bg-[linear-gradient(145deg,rgba(7,18,46,0.96),rgba(3,8,22,0.98))] shadow-[0_40px_110px_rgba(0,0,0,0.62)]">
              <div className="flex items-center justify-between border-b border-white/10 px-5 py-4 sm:px-6">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-sky-200/65">
                    Room Guests
                  </p>
                  <p className="mt-1 text-sm text-slate-300">
                    {visibleGuests.length} connected • {visiblePendingGuests.length} waiting
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowGuests(false)}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-slate-300 transition hover:bg-white/10"
                  aria-label="Close guests"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="grid max-h-[70vh] gap-0 overflow-hidden md:grid-cols-2">
                <section className="border-b border-white/10 p-5 md:border-b-0 md:border-r md:border-white/10 sm:p-6">
                  <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-amber-200/70">
                    Waitlist
                  </h3>
                  <div className="space-y-3 overflow-y-auto pr-1">
                    {visiblePendingGuests.length === 0 ? (
                      <p className="text-sm text-slate-500">No guests are waiting.</p>
                    ) : (
                      visiblePendingGuests.map((guest) => (
                        <div
                          key={guest.id}
                          className="rounded-2xl border border-amber-400/20 bg-amber-500/10 px-4 py-3"
                        >
                          <p className="truncate text-sm font-semibold text-slate-50">{guest.name}</p>
                          <div className="mt-3 flex gap-2">
                            <button
                              type="button"
                              disabled={approvingGuestId === guest.id}
                              onClick={() => handleGuestModeration(guest.id, "approve-guest")}
                              className="inline-flex items-center gap-1 rounded-lg bg-emerald-400 px-3 py-1.5 text-xs font-semibold text-slate-950 transition hover:bg-emerald-300 disabled:opacity-60"
                            >
                              <UserCheck className="h-3.5 w-3.5" />
                              Approve
                            </button>
                            <button
                              type="button"
                              disabled={approvingGuestId === guest.id}
                              onClick={() => handleGuestModeration(guest.id, "reject-guest")}
                              className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-slate-950/40 px-3 py-1.5 text-xs font-semibold text-slate-300 transition hover:bg-white/10 disabled:opacity-60"
                            >
                              <UserRoundX className="h-3.5 w-3.5" />
                              Reject
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </section>

                <section className="p-5 sm:p-6">
                  <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-sky-200/70">
                    Connected
                  </h3>
                  <div className="space-y-3 overflow-y-auto pr-1">
                    {visibleGuests.length === 0 ? (
                      <p className="text-sm text-slate-500">No active guests yet.</p>
                    ) : (
                      visibleGuests.map((guest) => (
                        <div
                          key={guest.id}
                          className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3"
                        >
                          <p className="truncate text-sm font-semibold text-slate-100">{guest.name}</p>
                          <button
                            type="button"
                            disabled={approvingGuestId === guest.id}
                            onClick={() => handleGuestModeration(guest.id, "kick-guest")}
                            className="inline-flex items-center gap-1 rounded-lg border border-rose-400/25 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-200 transition hover:bg-rose-500/20 disabled:opacity-60"
                          >
                            <DoorClosed className="h-3.5 w-3.5" />
                            Kick
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </section>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <SearchModal
        open={showSearch}
        onClose={() => setShowSearch(false)}
        roomCode={roomCode}
        guestId={hostId}
        queuedTrackIds={queue.map((item) => item.track.id)}
        currentTrackId={currentTrack?.id ?? null}
        onStateChange={({ queue: nextQueue, currentTrack: nextCurrentTrack }) => {
          setQueue(nextQueue);
          setCurrentTrack(nextCurrentTrack);
        }}
      />
    </div>
  );
}
