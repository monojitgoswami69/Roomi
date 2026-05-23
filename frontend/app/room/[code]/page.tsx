"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronUp,
  Copy,
  ListMusic,
  Lock,
  LockOpen,
  LogOut,
  Music,
  Plus,
  QrCode,
  Settings,
  Users,
  X,
} from "lucide-react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Queue from "@/components/Queue";
import RoomQRCode from "@/components/RoomQRCode";
import SearchModal from "@/components/SearchModal";
import VinylDisc from "@/components/VinylDisc";
import { createRoomiSocket, type RoomiSocket } from "@/lib/socket";
import type { PlaybackState, QueueItem, RoomState, Track } from "@/lib/types";

function newGuestId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `guest-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function formatDuration(ms: number) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
}

function GuestRoomInner() {
  const router = useRouter();
  const params = useParams<{ code: string }>();
  const searchParams = useSearchParams();

  const roomCode = useMemo(() => params.code.toUpperCase(), [params.code]);
  const displayName = useMemo(
    () => searchParams.get("name")?.trim() || "Guest",
    [searchParams],
  );
  const [origin] = useState(() => (typeof window !== "undefined" ? window.location.origin : ""));
  const joinUrl = useMemo(
    () => (roomCode && origin ? `${origin}/room/${roomCode}` : ""),
    [origin, roomCode],
  );

  const [guestId] = useState(newGuestId);
  const socketRef = useRef<RoomiSocket | null>(null);

  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
  const [guestCount, setGuestCount] = useState(0);
  const [roomAccess, setRoomAccess] = useState<"open" | "locked">("open");
  const [joinState, setJoinState] = useState<"joining" | "approved" | "pending" | "removed">("joining");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [showSearch, setShowSearch] = useState(false);
  const [showDrawer, setShowDrawer] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [glowTheme, setGlowTheme] = useState<"cyberpunk" | "aurora" | "midnight" | "amber">("cyberpunk");
  const [copied, setCopied] = useState(false);
  const [progressMs, setProgressMs] = useState(0);
  const [playback, setPlayback] = useState<PlaybackState | null>(null);
  const [socketStatus, setSocketStatus] = useState<
    "connecting" | "connected" | "reconnecting" | "offline"
  >("connecting");

  const applyRoomState = useCallback((state: RoomState | undefined | null) => {
    if (!state) return;
    setQueue(state.queue);
    const queueEmpty = state.queue.length === 0;
    const hasAny = Boolean(state.currentTrack || state.playback.track);
    if (queueEmpty && !hasAny) {
      setCurrentTrack(null);
      setPlayback(null);
      setProgressMs(0);
    } else {
      setCurrentTrack(state.currentTrack);
      if (state.playback.track) {
        setPlayback(state.playback);
      } else if (!state.currentTrack) {
        setPlayback(null);
        setProgressMs(0);
      }
    }
    setGuestCount(state.guestCount);
    setRoomAccess(state.access);
    setJoinState((current) => {
      if (state.guests?.[guestId]) return "approved";
      if (state.pendingGuests?.[guestId]) return "pending";
      if (current === "approved" || current === "pending") return "removed";
      if (state.access === "locked") return "pending";
      return current;
    });
  }, [guestId]);

  /* ───────────── Socket connection ───────────── */

  useEffect(() => {
    if (!guestId || !roomCode) return;
    const socket = createRoomiSocket();
    socketRef.current = socket;
    let pingId: number | null = null;
    let cancelled = false;

    socket.on("connect", () => {
      if (cancelled) return;
      setSocketStatus("connected");
      socket.emit("room:join", { roomCode, guestId, displayName }, (ack: { error?: string; state?: RoomState; status?: "approved" | "pending" }) => {
        if (ack?.error === "Room not found") {
          setError("Room not found.");
          setLoading(false);
          return;
        }
        if (ack?.error) setError(ack.error);
        if (ack?.state) applyRoomState(ack.state);
        if (ack?.status) setJoinState(ack.status);
        setLoading(false);
      });
    });
    socket.io.on("reconnect_attempt", () => setSocketStatus("reconnecting"));
    socket.io.on("reconnect", () => {
      setSocketStatus("connected");
      socket.emit("room:sync", {}, (ack: { state?: RoomState }) => {
        if (ack?.state) applyRoomState(ack.state);
      });
    });
    socket.io.on("reconnect_error", () => setSocketStatus("reconnecting"));
    socket.on("disconnect", () => setSocketStatus("offline"));
    socket.on("connect_error", () => setSocketStatus("offline"));

    socket.on("room:state", (state: RoomState) => applyRoomState(state));
    socket.on("playback:state", (next: PlaybackState) => {
      setPlayback(next);
      setCurrentTrack(next.track);
    });
    socket.on("room:closed", () => {
      router.push("/");
    });

    pingId = window.setInterval(() => {
      socket.emit("room:ping", {});
    }, 15_000);

    return () => {
      cancelled = true;
      if (pingId !== null) window.clearInterval(pingId);
      socket.disconnect();
      socketRef.current = null;
    };
  }, [applyRoomState, displayName, guestId, roomCode, router]);

  /* ───────────── Local progress ticker ───────────── */

  useEffect(() => {
    if (!playback?.track) return;
    const update = () => {
      const next = playback.isPlaying
        ? playback.startedAtPosition + (Date.now() - playback.startedAtTimestamp)
        : playback.pausedAtPosition;
      setProgressMs(Math.max(0, Math.min(playback.duration, next)));
    };
    update();
    const id = window.setInterval(update, 500);
    return () => window.clearInterval(id);
  }, [playback]);

  const copyCode = async () => {
    await navigator.clipboard.writeText(roomCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const visibleProgressMs = currentTrack ? progressMs : 0;
  const isPlaying = Boolean(playback?.isPlaying && currentTrack);

  if (loading) {
    return (
      <div className="roomi-bg min-h-screen flex items-center justify-center text-white">
        <div className="flex flex-col items-center gap-4">
          <div className="h-8 w-8 rounded-full border-2 border-zinc-700 border-t-green-500 animate-spin" />
          <p className="text-sm text-zinc-500">Joining room...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="roomi-bg h-screen overflow-hidden text-slate-100">
      <main className="mx-auto flex h-full max-w-[1600px] flex-col px-4 py-0 sm:px-6 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(420px,1fr)] lg:px-8 lg:py-0">
        <section className="min-h-0 flex flex-1 flex-col justify-center overflow-y-auto px-0 pb-16 pt-0 lg:px-4 lg:pb-0 lg:pt-0 lg:border-r lg:border-white/10 lg:pr-8">
          <div className="flex w-full flex-col items-center justify-center">
            <VinylDisc track={currentTrack} isPlaying={isPlaying} theme={glowTheme} />

            <div className="mt-6 text-center w-full max-w-2xl px-4">
              <h2 className="mx-auto text-[2rem] font-semibold tracking-tight text-slate-50 lg:text-[2.35rem] line-clamp-1 truncate">
                {currentTrack?.title || "Waiting for songs..."}
              </h2>
              <p className="mt-1.5 text-[15px] text-slate-400 lg:text-base line-clamp-1 truncate">
                {currentTrack?.artist || "Queue something and the deck will come alive."}
              </p>
            </div>

            <div className="mt-8 w-full max-w-2xl px-4">
              {(() => {
                const dur = currentTrack?.durationMs ?? 1;
                const ratio = currentTrack ? Math.max(0, Math.min(1, visibleProgressMs / dur)) : 0;
                return (
                  <>
                    <div className="relative flex h-9 items-center">
                      <div className="relative h-2.5 w-full rounded-full bg-slate-500/20">
                        {currentTrack ? (
                          <>
                            <div
                              className="absolute inset-y-0 left-0 rounded-full shadow-[0_0_22px_rgba(96,165,250,0.45)]"
                              style={{
                                width: `${ratio * 100}%`,
                                background: "linear-gradient(90deg, #38BDF8 0%, #60A5FA 100%)",
                              }}
                            />
                            <div
                              className="absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full border border-sky-100/45 bg-sky-300 shadow-[0_0_0_9px_rgba(56,189,248,0.18)]"
                              style={{ left: `calc(${ratio * 100}% - 8px)` }}
                            />
                          </>
                        ) : null}
                      </div>
                    </div>
                    <div className="mt-2.5 flex items-center justify-between text-[12px] font-semibold text-slate-400/95">
                      <span className="font-mono">{formatDuration(visibleProgressMs)}</span>
                      <span className="font-mono">
                        {currentTrack ? formatDuration(currentTrack.durationMs) : "0:00"}
                      </span>
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
        </section>

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

        {showDrawer ? (
          <div
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm lg:hidden"
            onClick={() => setShowDrawer(false)}
          />
        ) : null}

        <section
          className={`fixed inset-x-0 bottom-0 z-50 flex h-[min(92dvh,calc(100dvh-0.75rem))] min-h-0 flex-col overflow-hidden rounded-t-3xl border-t border-white/10 bg-slate-950/98 shadow-[0_-20px_60px_rgba(0,0,0,0.6)] backdrop-blur-2xl transition-transform duration-300 ease-out lg:static lg:z-auto lg:h-full lg:max-h-none lg:rounded-none lg:border-t-0 lg:bg-transparent lg:shadow-none lg:backdrop-blur-none lg:transition-none ${showDrawer ? "translate-y-0" : "translate-y-full lg:translate-y-0"}`}
        >
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
                <div className="grid gap-4 grid-cols-[1fr_auto] items-start">
                  <div className="flex h-full min-w-0 flex-col justify-start">
                    <div>
                      <div className="flex items-center justify-between">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-sky-200/55">Room ID</p>
                        <button
                          type="button"
                          onClick={() => setShowSettings(true)}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-slate-400 hover:text-white transition"
                          aria-label="Room Settings"
                        >
                          <Settings className="h-4 w-4" />
                        </button>
                      </div>
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
                        className="inline-flex h-9 w-full min-w-0 items-center justify-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-2 text-xs font-semibold text-slate-200 transition"
                        aria-label="Connected guests"
                      >
                        <Users className="h-3.5 w-3.5" />
                        <span className="truncate">{guestCount} connected</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => router.push("/")}
                        className="inline-flex h-9 w-full min-w-0 items-center justify-center gap-1.5 rounded-md border border-rose-400/20 bg-rose-500/10 px-2 text-xs font-semibold text-rose-200 transition hover:bg-rose-500/20"
                        aria-label="Leave room"
                      >
                        <LogOut className="h-4 w-4" />
                        <span className="truncate">Leave</span>
                      </button>
                    </div>
                  </div>

                  <div className="flex h-full items-start justify-end p-0">
                    <div className="flex shrink-0 scale-[0.72] origin-top-right min-[420px]:scale-[0.78] sm:scale-[0.84] lg:scale-100">
                      {joinUrl ? <RoomQRCode value={joinUrl} /> : <QrCode className="h-10 w-10 text-slate-400" />}
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex min-h-0 flex-1 flex-col py-5 lg:overflow-hidden lg:py-0">
                <div className="z-20 mb-4 flex shrink-0 flex-wrap items-center justify-between gap-3 lg:mt-0 lg:pt-4">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-sky-200/55">Queue</p>
                    <h3 className="mt-2 text-xl font-semibold tracking-tight text-slate-50">Up next</h3>
                  </div>
                  <div className="flex items-center gap-2 text-sm font-medium text-slate-400">
                    <span>{queue.length} songs</span>
                    <span
                      className={`h-2 w-2 rounded-full ${
                        socketStatus === "connected"
                          ? "bg-emerald-400"
                          : socketStatus === "reconnecting" || socketStatus === "connecting"
                            ? "bg-amber-300"
                            : "bg-rose-400"
                      }`}
                    />
                  </div>
                </div>

                <div className="z-20 mb-4 shrink-0 bg-transparent py-1 lg:py-3">
                  <button
                    type="button"
                    onClick={() => setShowSearch(true)}
                    disabled={joinState !== "approved"}
                    className="inline-flex h-14 w-full items-center justify-center gap-2 rounded-[22px] bg-emerald-500 px-4 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50 lg:w-auto"
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

                {joinState === "pending" ? (
                  <div className="mb-4 rounded-[22px] border border-amber-400/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                    Waiting for host approval
                  </div>
                ) : null}

                {joinState === "removed" ? (
                  <div className="mb-4 rounded-[22px] border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
                    You no longer have access to this room.
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
                      socket={socketRef.current}
                      guestId={guestId}
                      currentTrack={currentTrack}
                      canVote={joinState === "approved"}
                    />
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      {showSettings ? (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md overflow-hidden rounded-[24px] border border-white/10 bg-[linear-gradient(145deg,rgba(7,18,46,0.96),rgba(3,8,22,0.98))] shadow-[0_30px_90px_rgba(0,0,0,0.65)] p-6 animate-scale-in">
            <div className="flex items-center justify-between border-b border-white/10 pb-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-sky-200/65">Room Info & Prefs</p>
                <h3 className="mt-1 text-lg font-bold text-slate-50">Room Settings</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowSettings(false)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-slate-400 hover:text-white transition"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-5 space-y-6">
              {/* Room Status view */}
              <section className="space-y-2">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Room Status</h4>
                <div className="flex items-center gap-2.5 rounded-xl border border-white/[0.04] bg-white/[0.02] p-3 text-sm">
                  <div className={`h-2.5 w-2.5 rounded-full ${roomAccess === "open" ? "bg-emerald-400" : "bg-amber-400"}`} />
                  <span className="font-semibold text-slate-200 capitalize">{roomAccess} Joining</span>
                  <span className="text-xs text-slate-500">•</span>
                  <span className="text-xs text-slate-400">
                    {roomAccess === "open" ? "Anyone can join freely" : "Host approval required"}
                  </span>
                </div>
              </section>

              {/* Vinyl Theme selection (Personal visual preference!) */}
              <section className="space-y-3">
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Vinyl Glow Backlight</h4>
                  <p className="mt-1 text-xs text-slate-500">Select your personal neon theme for the spinning deck.</p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {(["cyberpunk", "aurora", "midnight", "amber"] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setGlowTheme(t)}
                      className={`inline-flex items-center justify-center rounded-xl border px-3 py-2 text-xs font-semibold capitalize transition ${
                        glowTheme === t
                          ? "border-sky-400 bg-sky-400/10 text-sky-200 shadow-md"
                          : "border-white/5 bg-white/[0.03] text-slate-300 hover:bg-white/8"
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </section>
            </div>
          </div>
        </div>
      ) : null}

      <SearchModal
        open={showSearch}
        onClose={() => setShowSearch(false)}
        roomCode={roomCode}
        socket={socketRef.current}
        queuedTrackIds={queue.map((q) => q.track.id)}
        currentTrackId={currentTrack?.id ?? null}
      />
    </div>
  );
}

export default function GuestRoomPage() {
  return (
    <Suspense
      fallback={
        <div
          className="min-h-screen text-white flex items-center justify-center"
          style={{
            backgroundColor: "#000005",
            backgroundImage: `
              radial-gradient(circle at 20% 0%, rgba(15, 23, 42, 0.8) 0%, transparent 50%),
              radial-gradient(circle at 80% 100%, rgba(15, 23, 42, 0.6) 0%, transparent 50%)
            `,
          }}
        >
          <div className="h-8 w-8 rounded-full border-2 border-zinc-700 border-t-green-500 animate-spin" />
        </div>
      }
    >
      <GuestRoomInner />
    </Suspense>
  );
}
