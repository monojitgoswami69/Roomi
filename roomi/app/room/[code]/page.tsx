"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronUp, Copy, ListMusic, Lock, LockOpen, LogOut, Music, Plus, QrCode, Users } from "lucide-react";
import { io, type Socket } from "socket.io-client";
import qrcode from "qrcode";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Queue from "@/components/Queue";
import SearchModal from "@/components/SearchModal";
import type { Track } from "@/lib/roomStore";

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
  guests: Record<string, string>;
  pendingGuests: Record<string, string>;
  guestCount: number;
  access: "open" | "locked";
};

const socketUrl = process.env.NEXT_PUBLIC_SOCKET_URL;

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

  for (let row = 0; row < modulesSize; row += 1) {
    for (let col = 0; col < modulesSize; col += 1) {
      if (!qrData.modules.data[row * modulesSize + col]) continue;

      const isFinderPattern =
        (row < 7 && col < 7) ||
        (col > modulesSize - 8 && row < 7) ||
        (row > modulesSize - 8 && col < 7);

      if (isFinderPattern) continue;

      paths.push(
        <circle
          key={`${row}-${col}`}
          cx={col + 0.5}
          cy={row + 0.5}
          r={0.4}
          fill="#FFFFFF"
        />,
      );
    }
  }

  [
    { x: 0, y: 0 },
    { x: modulesSize - 7, y: 0 },
    { x: 0, y: modulesSize - 7 },
  ].forEach((pos, idx) => {
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
      </g>,
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

function GuestRoomInner() {
  const router = useRouter();
  const params = useParams<{ code: string }>();
  const searchParams = useSearchParams();

  const roomCode = useMemo(() => params.code.toUpperCase(), [params.code]);
  const displayName = useMemo(() => searchParams.get("name")?.trim() || "Guest", [searchParams]);
  const [origin] = useState(() => (typeof window !== "undefined" ? window.location.origin : ""));
  const joinUrl = useMemo(
    () => (roomCode && origin ? `${origin}/room/${roomCode}` : ""),
    [origin, roomCode],
  );

  const [guestId] = useState(() => {
    if (typeof window === "undefined") return "";
    const existing = localStorage.getItem("roomi_guest_id");
    if (existing) return existing;
    const id = crypto.randomUUID();
    localStorage.setItem("roomi_guest_id", id);
    return id;
  });
  const [queue, setQueue] = useState<UIQueueItem[]>([]);
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
  const [guestCount, setGuestCount] = useState(0);
  const [roomAccess, setRoomAccess] = useState<"open" | "locked">("open");
  const [joinState, setJoinState] = useState<"joining" | "approved" | "pending" | "removed">("joining");
  const [error, setError] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [showDrawer, setShowDrawer] = useState(false);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [progressMs, setProgressMs] = useState(0);
  const trackStartRef = useRef<number>(0);
  const prevTrackIdRef = useRef<string | null>(null);

  const refreshRoomState = useCallback(async () => {
    try {
      const response = await fetch(`/api/room/${roomCode}?viewerId=${encodeURIComponent(guestId)}`, { cache: "no-store" });
      if (!response.ok) return;
      const payload = await response.json();
      setQueue(payload.queue ?? []);
      setCurrentTrack(payload.currentTrack ?? null);
      setGuestCount(payload.guestCount ?? 0);
      setRoomAccess(payload.access ?? "open");
    } catch {
      // socket remains primary
    }
  }, [guestId, roomCode]);

  const copyCode = async () => {
    await navigator.clipboard.writeText(roomCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  useEffect(() => {
    if (!guestId || !roomCode) return;
    let socket: Socket | null = null;
    let cancelled = false;

    const initializeRoom = async () => {
      const response = await fetch(`/api/room/${roomCode}?viewerId=${encodeURIComponent(guestId)}`);
      if (!response.ok) { router.replace("/?error=room-not-found"); return; }
      const data = await response.json();
      if (cancelled) return;
      setQueue(data.queue ?? []);
      setCurrentTrack(data.currentTrack ?? null);
      setGuestCount(data.guestCount ?? 0);
      setRoomAccess(data.access ?? "open");
      setLoading(false);

      socket = io(socketUrl || undefined, {
        transports: ["websocket"],
      });
      socket.on("connect", () => {
        socket?.emit("join-room", { roomCode, guestId, displayName });
        void refreshRoomState();
      });
      socket.on("room-join-status", (payload: { status?: "approved" | "pending" }) => {
        setJoinState(payload?.status === "pending" ? "pending" : "approved");
      });
      socket.on("room-updated", (payload: RoomUpdatedPayload) => {
        setQueue(payload.queue ?? []);
        setCurrentTrack(payload.currentTrack ?? null);
        setGuestCount(payload.guestCount ?? 0);
        setRoomAccess(payload.access ?? "open");
        setJoinState((current) => {
          if (payload.guests?.[guestId]) return "approved";
          if (payload.pendingGuests?.[guestId]) return "pending";
          if (current === "approved" || current === "pending") return "removed";
          if ((payload.access ?? "open") === "locked") return "pending";
          return current;
        });
      });
    };

    initializeRoom().catch(() => { if (!cancelled) { setError("Could not load room"); setLoading(false); } });
    return () => {
      cancelled = true;
      socket?.disconnect();
    };
  }, [displayName, guestId, refreshRoomState, roomCode, router]);

  // Estimate playback progress based on elapsed time since track started
  useEffect(() => {
    if (!currentTrack) {
      prevTrackIdRef.current = null;
      return;
    }
    // Reset timer when track changes
    if (currentTrack.id !== prevTrackIdRef.current) {
      prevTrackIdRef.current = currentTrack.id;
      trackStartRef.current = Date.now();
      setProgressMs(0);
    }
    const interval = setInterval(() => {
      const elapsed = Date.now() - trackStartRef.current;
      setProgressMs(Math.min(elapsed, currentTrack.durationMs));
    }, 250);
    return () => clearInterval(interval);
  }, [currentTrack]);

  const visibleProgressMs = currentTrack ? progressMs : 0;

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
            <div className="relative flex h-[15rem] w-[15rem] items-center justify-center lg:h-[26rem] lg:w-[26rem]">
              <div
                className="record-spin absolute z-10 h-[15rem] w-[15rem] rounded-full shadow-[0_40px_100px_rgba(0,0,0,0.8)] lg:h-[26rem] lg:w-[26rem]"
                style={{
                  animationPlayState: currentTrack ? "running" : "paused",
                  background:
                    "conic-gradient(from 45deg, #1a1a1a, #2a2a2a, #1a1a1a, #333, #1a1a1a, #2a2a2a, #1a1a1a, #333, #1a1a1a), radial-gradient(circle, transparent 20%, #1a1a1a 21%, #0d0d0d 22%, #1a1a1a 24%, #0d0d0d 26%, #222 28%, #0d0d0d 32%, #1a1a1a 36%, #0d0d0d 40%, #1a1a1a 45%, #0d0d0d 50%, #222 55%, #0d0d0d 60%, #1a1a1a 68%, #0d0d0d 76%, #1a1a1a 84%, #0d0d0d 92%, #1a1a1a 100%)",
                  backgroundBlendMode: "overlay",
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
                  WebkitMaskImage: "radial-gradient(circle, black 50%, rgba(0,0,0,0.4) 70%, transparent 95%)",
                }}
              >
                {currentTrack?.albumArt ? (
                  <img
                    src={currentTrack.albumArt}
                    alt={currentTrack.title}
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
                {currentTrack?.title || "Waiting for songs..."}
              </h2>
              <p className="mt-1.5 text-[15px] text-slate-400 lg:text-base line-clamp-1 truncate">
                {currentTrack?.artist || "Queue something and the deck will come alive."}
              </p>
            </div>

            <div className="mt-8 w-full max-w-2xl px-4">
              {(() => {
                const durationMs = currentTrack?.durationMs ?? 1;
                const ratio = currentTrack ? Math.max(0, Math.min(1, visibleProgressMs / durationMs)) : 0;
                const fmt = (ms: number) => {
                  const s = Math.floor(ms / 1000);
                  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
                };
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
                      <span className="font-mono">{fmt(visibleProgressMs)}</span>
                      <span className="font-mono">{currentTrack ? fmt(currentTrack.durationMs) : "0:00"}</span>
                    </div>
                  </>
                );
              })()}
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
            fixed inset-x-0 bottom-0 z-50 max-h-[85vh] overflow-hidden rounded-t-3xl border-t border-white/10 bg-slate-950/98 shadow-[0_-20px_60px_rgba(0,0,0,0.6)] backdrop-blur-2xl transition-transform duration-300 ease-out
            lg:static lg:z-auto lg:max-h-none lg:rounded-none lg:border-t-0 lg:bg-transparent lg:shadow-none lg:backdrop-blur-none lg:transition-none
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
          <div className="overflow-y-auto p-2 lg:p-4 lg:pl-8 lg:h-full" style={{ maxHeight: 'calc(85vh - 2rem)' }}>
          <div className="flex min-h-full flex-col">
            <div className="lg:sticky lg:top-0 z-20 border-b border-white/10 py-4 lg:py-5">
              <div className="grid min-h-[148px] gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(220px,0.92fr)_140px] xl:grid-cols-[minmax(0,1fr)_minmax(240px,0.9fr)_148px]">
                <div className="flex h-full flex-col justify-start">
                  <div className="min-h-[76px]">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-sky-200/55">
                      Room ID
                    </p>
                    <div className="mt-3 flex min-w-0 items-center gap-2.5">
                      <h2 className="font-mono text-4xl font-bold tracking-[0.22em] text-sky-300">
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

                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-2 text-xs font-semibold text-slate-200 transition"
                      aria-label="Connected guests"
                    >
                      <Users className="h-3.5 w-3.5" />
                      {guestCount} connected
                    </button>
                    <button
                      type="button"
                      onClick={() => router.push("/")}
                      className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-rose-400/20 bg-rose-500/10 px-2 text-xs font-semibold text-rose-200 transition hover:bg-rose-500/20"
                      aria-label="Leave room"
                    >
                      <LogOut className="h-4 w-4" />
                      Leave
                    </button>
                  </div>
                </div>

                <div className="flex h-full flex-col justify-start">
                  <div className="min-h-[76px]">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-sky-200/55">
                      Room status
                    </p>
                    <p className="mt-2 max-w-[16rem] text-[13px] leading-6 text-slate-400">
                      Choose whether guests join freely or need host approval.
                    </p>
                  </div>

                  <div className="mt-4 inline-flex h-9 w-fit items-center rounded-md border border-white/10 bg-slate-950/40 p-1">
                    <button
                      type="button"
                      disabled
                      className={`inline-flex h-7 items-center gap-1.5 rounded px-3 text-xs font-semibold transition ${
                        roomAccess === "open"
                          ? "bg-sky-400 text-slate-950"
                          : "text-slate-300"
                      }`}
                      aria-label="Open room"
                    >
                      <LockOpen className="h-3.5 w-3.5" />
                      Open
                    </button>
                    <button
                      type="button"
                      disabled
                      className={`inline-flex h-7 items-center gap-1.5 rounded px-3 text-xs font-semibold transition ${
                        roomAccess === "locked"
                          ? "bg-amber-300 text-slate-950"
                          : "text-slate-300"
                      }`}
                      aria-label="Locked room"
                    >
                      <Lock className="h-3.5 w-3.5" />
                      Locked
                    </button>
                  </div>
                </div>

                <div className="hidden lg:flex h-full items-start justify-end p-0">
                  {joinUrl ? <CustomQRCode value={joinUrl} /> : <QrCode className="h-10 w-10 text-slate-400" />}
                </div>
              </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col py-5 lg:py-6">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-sky-200/55">
                    Queue
                  </p>
                  <h3 className="mt-2 text-xl font-semibold tracking-tight text-slate-50">
                    Up next
                  </h3>
                </div>
                <div className="text-sm font-medium text-slate-400">{queue.length} songs</div>
              </div>

              <button
                type="button"
                onClick={() => setShowSearch(true)}
                disabled={joinState !== "approved"}
                className="mb-4 inline-flex h-14 items-center justify-center gap-2 rounded-[22px] bg-emerald-500 px-4 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Plus className="h-5 w-5" />
                Add songs
              </button>

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

              <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                {queue.length === 0 && !currentTrack ? (
                  <div className="flex min-h-[14rem] flex-col items-center justify-center px-4 text-center">
                    <ListMusic className="h-7 w-7 text-slate-600" />
                    <p className="mt-3 text-sm font-semibold text-slate-200">No songs queued</p>
                    <p className="mt-1 text-xs text-slate-500">Open the popup and build the next wave.</p>
                  </div>
                ) : (
                  <Queue items={queue} guestId={guestId} roomCode={roomCode} currentTrack={currentTrack} />
                )}
              </div>
            </div>
          </div>
          </div>
        </section>
      </main>

      <SearchModal
        open={showSearch}
        onClose={() => setShowSearch(false)}
        roomCode={roomCode}
        guestId={guestId}
        queuedTrackIds={queue.map((i) => i.track.id)}
        currentTrackId={currentTrack?.id ?? null}
      />
    </div>
  );
}

/** Suspense boundary required for useSearchParams() in Next.js */
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
