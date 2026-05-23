"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Crown,
  DoorClosed,
  FastForward,
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
import SkipVoteToast from "@/components/SkipVoteToast";
import KickVoteToast from "@/components/KickVoteToast";
import VinylDisc from "@/components/VinylDisc";
import { createRoomiSocket, type RoomiSocket } from "@/lib/socket";
import type { KickVote, PlaybackState, QueueItem, RoomState, SkipVote, Track } from "@/lib/types";

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
  const [isHeaderCollapsed, setIsHeaderCollapsed] = useState(false);
  const [glowTheme, setGlowTheme] = useState<"cyberpunk" | "aurora" | "midnight" | "amber">("cyberpunk");
  const [copied, setCopied] = useState(false);
  const [progressMs, setProgressMs] = useState(0);
  const [playback, setPlayback] = useState<PlaybackState | null>(null);
  const [skipVote, setSkipVote] = useState<SkipVote | null>(null);
  const [kickVote, setKickVote] = useState<KickVote | null>(null);
  const [cohosts, setCohosts] = useState<string[]>([]);
  const [hostId, setHostId] = useState("");
  const [guestsMap, setGuestsMap] = useState<Record<string, string>>({});
  const [showGuestsDropdown, setShowGuestsDropdown] = useState(false);
  const [kickStartingId, setKickStartingId] = useState<string | null>(null);
  const [removalReason, setRemovalReason] = useState<"kicked" | "rejected" | null>(null);
  const prevJoinStateRef = useRef<"joining" | "approved" | "pending" | "removed">("joining");
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
    setSkipVote(state.skipVote ?? null);
    setKickVote(state.kickVote ?? null);
    setCohosts(state.cohosts ?? []);
    setHostId(state.hostId);
    setGuestsMap(state.guests ?? {});
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
          router.replace("/?error=room-not-found");
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

  /* ───────────── Eject on kick: show toast then redirect ───────────── */

  useEffect(() => {
    if (joinState === "approved" || joinState === "pending") {
      prevJoinStateRef.current = joinState;
      return;
    }
    if (joinState === "removed" && !removalReason) {
      const reason: "kicked" | "rejected" =
        prevJoinStateRef.current === "approved" ? "kicked" : "rejected";
      setRemovalReason(reason);
    }
  }, [joinState, removalReason]);

  useEffect(() => {
    if (removalReason !== "kicked") return;
    const id = window.setTimeout(() => router.replace("/?kicked=1"), 1500);
    return () => window.clearTimeout(id);
  }, [removalReason, router]);

  const copyCode = async () => {
    await navigator.clipboard.writeText(roomCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const startSkipVote = useCallback(() => {
    const socket = socketRef.current;
    if (!socket || !currentTrack || skipVote || joinState !== "approved") return;
    socket.emit(
      "skip-vote:start",
      {},
      (ack: { error?: string }) => {
        if (ack?.error) setError(ack.error);
      },
    );
  }, [currentTrack, joinState, skipVote]);

  const castSkipVote = useCallback((choice: "yes" | "no") => {
    const socket = socketRef.current;
    if (!socket || !skipVote) return;
    socket.emit(
      "skip-vote:cast",
      { vote: choice },
      (ack: { error?: string }) => {
        if (ack?.error) setError(ack.error);
      },
    );
  }, [skipVote]);

  const castKickVote = useCallback((choice: "yes" | "no") => {
    const socket = socketRef.current;
    if (!socket || !kickVote) return;
    socket.emit(
      "kick-vote:cast",
      { vote: choice },
      (ack: { error?: string }) => {
        if (ack?.error) setError(ack.error);
      },
    );
  }, [kickVote]);

  const startKickVote = useCallback((targetId: string) => {
    const socket = socketRef.current;
    if (!socket) return;
    setKickStartingId(targetId);
    socket.emit(
      "kick-vote:start",
      { targetId },
      (ack: { error?: string }) => {
        setKickStartingId(null);
        if (ack?.error) setError(ack.error);
      },
    );
  }, []);

  const isCohost = useMemo(() => cohosts.includes(guestId), [cohosts, guestId]);
  const visibleGuests = useMemo(
    () =>
      Object.entries(guestsMap)
        .filter(([gid]) => gid !== hostId)
        .map(([id, name]) => ({ id, name, isCohost: cohosts.includes(id) })),
    [cohosts, guestsMap, hostId],
  );

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
              <h2 className="mx-auto text-[clamp(1.4rem,4.5vw,2rem)] lg:text-[2.35rem] font-semibold tracking-tight text-slate-50 line-clamp-1 truncate">
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

            {currentTrack && joinState === "approved" && !skipVote ? (
              <div className="mt-6 w-full max-w-2xl px-4 flex justify-center">
                <button
                  type="button"
                  onClick={startSkipVote}
                  className="inline-flex items-center gap-2.5 rounded-xl border border-white/10 bg-white/[0.04] px-6 py-3 text-sm font-bold text-slate-100 transition hover:bg-white/[0.08] hover:border-sky-400/30 hover:scale-[1.02] active:scale-95 shadow-[0_4px_16px_rgba(0,0,0,0.25)]"
                >
                  <FastForward className="h-4 w-4 text-sky-300" />
                  Vote to skip
                </button>
              </div>
            ) : null}
          </div>
        </section>

        <button
          type="button"
          onClick={() => setShowDrawer(true)}
          className="fixed bottom-0 left-4 right-4 z-40 flex h-14 items-center justify-center gap-2 rounded-t-2xl border-t border-x border-white/10 bg-slate-900/95 px-6 backdrop-blur-xl lg:hidden shadow-[0_-8px_24px_rgba(0,0,0,0.4)] active:scale-[0.99] transition-all"
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
              <div className={`z-20 shrink-0 border-b border-white/10 relative transition-all duration-500 ease-in-out ${
                isHeaderCollapsed ? "pb-2.5 pt-2.5" : "pb-3 pt-2.5"
              }`}>
                {/* Top Row: Compact Room ID (Visible and relative in document flow when collapsed, hidden absolute when expanded) */}
                <div className={`flex items-center gap-2.5 transition-all duration-500 ease-in-out ${
                  isHeaderCollapsed ? "opacity-100 translate-x-0 relative" : "opacity-0 -translate-x-4 pointer-events-none absolute"
                }`}>
                  <span className="text-[10px] font-bold uppercase tracking-[0.25em] text-sky-200/50">Room ID</span>
                  <span className="font-mono text-sm font-bold tracking-wider text-sky-300">{roomCode}</span>
                  <button
                    type="button"
                    onClick={copyCode}
                    className="inline-flex h-6 w-6 items-center justify-center text-slate-400 hover:text-sky-300 transition-colors focus:outline-none"
                    aria-label="Copy room code"
                  >
                    {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                  </button>
                </div>

                {/* Floating Settings & Guest Controls (Always absolute at the top-right to prevent taking up vertical height in flow) */}
                <div className="absolute top-2.5 right-0 z-40 flex items-center gap-2">
                    {/* Connected Guests Button — moderation panel for co-hosts, read-only otherwise */}
                    <div className="relative">
                      <button
                        type="button"
                        disabled={!isCohost}
                        onClick={() => {
                          if (!isCohost) return;
                          setShowGuestsDropdown(!showGuestsDropdown);
                          setShowSettings(false);
                        }}
                        className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-bold transition-all duration-300 focus:outline-none ${
                          isCohost
                            ? showGuestsDropdown
                              ? "text-sky-300 bg-white/5 scale-105"
                              : "text-slate-400 hover:text-slate-200 hover:scale-105"
                            : "text-slate-400 cursor-default"
                        }`}
                        aria-label="Connected Guests"
                      >
                        {isCohost ? <Crown className="h-4 w-4 text-amber-400" /> : <Users className="h-4 w-4" />}
                        <span className="font-mono text-[11px]">{guestCount}</span>
                      </button>

                      {showGuestsDropdown && isCohost && (
                        <>
                          <div
                            className="fixed inset-0 z-40 bg-transparent cursor-default"
                            onClick={() => setShowGuestsDropdown(false)}
                          />
                          <div className="absolute right-[-40px] md:right-0 top-full mt-2 z-50 w-[min(calc(100vw-2rem),24rem)] max-h-[60vh] overflow-y-auto rounded-[24px] border border-white/10 bg-[#040816]/95 p-5 shadow-[0_25px_60px_-15px_rgba(0,0,0,0.85)] backdrop-blur-2xl animate-scale-in no-scrollbar space-y-4">
                            <section className="space-y-2.5">
                              <div className="flex items-center gap-2">
                                <Crown className="h-3 w-3 text-amber-400" />
                                <h4 className="text-[10px] font-bold uppercase tracking-[0.15em] text-amber-300/80 select-none">
                                  Co-Host Tools
                                </h4>
                              </div>
                              <p className="text-[10px] leading-relaxed text-slate-500 select-none">
                                Start a kick vote against a guest. A majority of approved members must agree within 10 seconds.
                              </p>
                            </section>

                            <hr className="border-t border-white/5 select-none" />

                            <section className="space-y-2.5">
                              <h4 className="text-[10px] font-bold uppercase tracking-[0.15em] text-sky-300/80 select-none">
                                Connected ({visibleGuests.length})
                              </h4>
                              {visibleGuests.length === 0 ? (
                                <p className="text-[10px] text-slate-500/80 px-1 py-1 select-none">No other guests are connected.</p>
                              ) : (
                                <div className="space-y-2 divide-y divide-white/5 max-h-[35vh] overflow-y-auto no-scrollbar">
                                  {visibleGuests.map((guest) => {
                                    const kickActive = Boolean(kickVote);
                                    const isSelf = guest.id === guestId;
                                    return (
                                      <div key={guest.id} className="flex items-center justify-between py-2 px-1 animate-scale-in select-none">
                                        <div className="flex items-center gap-1.5 min-w-0 pr-2">
                                          <span className="text-xs font-semibold text-slate-200 truncate">{guest.name}</span>
                                          {guest.isCohost ? (
                                            <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider text-amber-300">
                                              <Crown className="h-2.5 w-2.5" />
                                              Co-Host
                                            </span>
                                          ) : null}
                                          {isSelf ? (
                                            <span className="inline-flex shrink-0 items-center rounded-full bg-sky-500/15 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider text-sky-300">
                                              You
                                            </span>
                                          ) : null}
                                        </div>
                                        {!isSelf ? (
                                          <button
                                            type="button"
                                            disabled={kickActive || kickStartingId === guest.id}
                                            onClick={() => startKickVote(guest.id)}
                                            className="inline-flex h-6 items-center gap-1 rounded-md bg-rose-500/10 hover:bg-rose-500/20 disabled:opacity-50 disabled:cursor-not-allowed px-2 text-[9px] font-bold uppercase tracking-wider text-rose-300 transition"
                                            title={kickActive ? "A kick vote is already active" : "Start a kick vote"}
                                          >
                                            <DoorClosed className="h-2.5 w-2.5" />
                                            Kick
                                          </button>
                                        ) : null}
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </section>
                          </div>
                        </>
                      )}
                    </div>

                    {/* Settings Dropdown Button and Popup */}
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setShowSettings(!showSettings)}
                        className="inline-flex h-8 w-8 items-center justify-center text-slate-400 hover:text-sky-300 transition-colors focus:outline-none hover:scale-105"
                        aria-label="Room Settings"
                      >
                        <Settings 
                          className={`h-4.5 w-4.5 transition-transform duration-500 ease-out ${
                            showSettings ? "rotate-90 text-sky-300 scale-110" : "rotate-0 text-slate-400"
                          }`} 
                        />
                      </button>

                      {showSettings && (
                        <>
                          <div
                            className="fixed inset-0 z-45 bg-transparent cursor-default"
                            onClick={() => setShowSettings(false)}
                          />
                          <div className="absolute right-0 top-full mt-2 z-50 w-[min(calc(100vw-2rem),24rem)] max-h-[60vh] overflow-y-auto rounded-[24px] border border-white/10 bg-[#040816]/95 p-5 shadow-[0_25px_60px_-15px_rgba(0,0,0,0.85)] backdrop-blur-2xl animate-scale-in no-scrollbar">
                            {/* Dropdown Scrollable Settings */}
                            <div className="space-y-4">
                              {/* Room Info */}
                              <section className="space-y-2.5">
                                <h4 className="text-[10px] font-bold uppercase tracking-[0.15em] text-sky-300/80">Room Info</h4>
                                <div className="flex flex-col gap-2 rounded-xl border border-white/[0.04] bg-slate-950/50 p-3.5 text-xs text-slate-300 select-none">
                                  <div className="flex items-center justify-between">
                                    <span className="text-slate-400">Status</span>
                                    <span className={`px-2 py-0.5 rounded font-bold capitalize ${roomAccess === "open" ? "bg-emerald-500/10 text-emerald-400" : "bg-amber-500/10 text-amber-400"}`}>
                                      {roomAccess} Joining
                                    </span>
                                  </div>
                                  <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
                                    {roomAccess === "open" 
                                      ? "Anyone can join and add songs immediately." 
                                      : "Host approval is required to join this session."}
                                  </p>
                                </div>
                              </section>

                              <hr className="border-t border-white/5 my-1" />

                              {/* Vinyl Theme selection (Personal visual preference!) */}
                              <section className="space-y-3">
                                <div>
                                  <h4 className="text-[10px] font-bold uppercase tracking-[0.15em] text-sky-300/80">Vinyl Glow Theme</h4>
                                  <p className="mt-0.5 text-[10px] text-slate-500">Select your personal neon theme for the spinning deck.</p>
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                  {(["cyberpunk", "aurora", "midnight", "amber"] as const).map((t) => (
                                    <button
                                      key={t}
                                      type="button"
                                      onClick={() => setGlowTheme(t)}
                                      className={`inline-flex items-center justify-center rounded-xl border px-3 py-2 text-xs font-semibold capitalize transition ${
                                        glowTheme === t
                                          ? "border-sky-400 bg-sky-400/10 text-sky-200 shadow-md scale-[1.01]"
                                          : "border-white/5 bg-white/[0.03] text-slate-300 hover:bg-white/8 hover:scale-[1.01]"
                                      }`}
                                    >
                                      {t}
                                    </button>
                                  ))}
                                </div>
                              </section>
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                </div>

                {/* Collapsible Content Area (Centred room ID + QR Code) with smooth slide and fade transitions */}
                <div 
                  className="grid transition-all duration-500 ease-in-out overflow-hidden"
                  style={{ gridTemplateRows: isHeaderCollapsed ? "0fr" : "1fr" }}
                >
                  <div className="min-h-0">
                    <div className={`transition-all duration-500 ease-in-out transform origin-top ${
                      isHeaderCollapsed ? "opacity-0 -translate-y-4 scale-95 pointer-events-none" : "opacity-100 translate-y-0 scale-100"
                    }`}>
                      {/* Centered Group: Room ID and QR Code */}
                      <div className="flex flex-col sm:flex-row items-center justify-center gap-10 py-1.5 w-full">
                        {/* Room ID and Leave Session button */}
                        <div className="flex flex-col items-center sm:items-start text-center sm:text-left justify-center">
                          <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-sky-200/50">Room ID</p>
                          <div className="mt-1 flex items-end gap-0.5">
                            <h2 className="font-mono text-5xl sm:text-6xl font-black tracking-[0.2em] text-sky-300">
                              {roomCode}
                            </h2>
                            <button
                              type="button"
                              onClick={copyCode}
                              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-slate-400 hover:text-sky-300 hover:bg-white/[0.05] transition-all focus:outline-none active:scale-90 -ml-[0.24em] mb-1.5"
                              aria-label="Copy room code"
                            >
                              {copied ? <Check className="h-5.5 w-5.5 text-emerald-400" /> : <Copy className="h-5.5 w-5.5" />}
                            </button>
                          </div>
                          {/* Leave Session Button directly underneath */}
                          <div className="mt-3.5">
                            <button
                              type="button"
                              onClick={() => router.push("/")}
                              className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-rose-500/20 bg-rose-500/10 px-3.5 text-[10px] font-bold uppercase tracking-[0.08em] text-rose-300 transition hover:bg-rose-500/20 active:scale-95"
                            >
                              <LogOut className="h-3 w-3" />
                              <span>Leave room</span>
                            </button>
                          </div>
                        </div>

                        {/* QR Code Graphic (Naked directly on the page background) */}
                        <div className="flex items-center justify-center h-28 w-28 select-none transition duration-300 hover:scale-105 shrink-0">
                          {joinUrl ? <RoomQRCode value={joinUrl} /> : <QrCode className="h-10 w-10 text-slate-400 animate-pulse" />}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Floating Expand/Collapse Chevron Pill centered on the bottom border */}
                <button
                  type="button"
                  onClick={() => {
                    setIsHeaderCollapsed(!isHeaderCollapsed);
                    setShowSettings(false);
                  }}
                  className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 z-10 inline-flex h-6 w-12 items-center justify-center rounded-full border border-white/10 bg-[#040816] text-slate-400 hover:text-sky-300 transition-all duration-300 focus:outline-none hover:scale-110 active:scale-95 shadow-[0_4px_12px_rgba(0,0,0,0.5)] hover:border-sky-500/30"
                  aria-label={isHeaderCollapsed ? "Expand header" : "Collapse header"}
                >
                  <ChevronDown 
                    className={`h-4.5 w-4.5 text-slate-400 transition-transform duration-500 ease-in-out ${
                      isHeaderCollapsed ? "rotate-0 animate-pulse text-sky-400" : "rotate-180"
                    }`} 
                  />
                </button>
              </div>

              <div className="flex min-h-0 flex-1 flex-col pt-3 lg:overflow-hidden lg:pt-0">
                <div className="z-20 mb-4 py-2 flex shrink-0 items-center justify-between gap-3 lg:mt-0 lg:pt-4">
                  <div className="flex items-baseline gap-3">
                    <h3 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-50">Up next</h3>
                    <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-400">
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
                  <button
                    type="button"
                    onClick={() => setShowSearch(true)}
                    disabled={joinState !== "approved"}
                    className="inline-flex h-11 items-center gap-2 rounded-xl bg-emerald-500 pl-4 pr-5 text-sm font-bold text-slate-950 transition hover:bg-emerald-400 hover:scale-[1.02] active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 shrink-0 shadow-md shadow-emerald-500/10"
                  >
                    <Plus className="h-4.5 w-4.5" />
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
                    {removalReason === "kicked"
                      ? "You have been kicked. Returning home..."
                      : "You no longer have access to this room."}
                  </div>
                ) : null}

                <div className="min-h-[12rem] flex-1 pb-8 pr-1 lg:h-full lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain">
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



      {skipVote ? (
        <SkipVoteToast vote={skipVote} currentGuestId={guestId} onCast={castSkipVote} />
      ) : null}

      {kickVote ? (
        <KickVoteToast vote={kickVote} currentGuestId={guestId} onCast={castKickVote} />
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
