"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronUp,
  Copy,
  DoorClosed,
  FastForward,
  ListMusic,
  Lock,
  LockOpen,
  LogOut,
  Music,
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
import { useRouter } from "next/navigation";
import Player, {
  type PlayerControls,
  type PlayerStatus,
  type SDKTrack,
} from "@/components/Player";
import Queue from "@/components/Queue";
import RoomQRCode from "@/components/RoomQRCode";
import SearchModal from "@/components/SearchModal";
import { createRoomiSocket, type RoomiSocket } from "@/lib/socket";
import type {
  PlaybackState,
  QueueItem,
  RoomState,
  Track,
} from "@/lib/types";

/* ──────────────────────────── Helpers ──────────────────────────── */

const formatDuration = (ms: number) => {
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}:${s.toString().padStart(2, "0")}`;
};

const progressGradient = "linear-gradient(90deg, #38BDF8 0%, #60A5FA 100%)";

function makePlaybackState(track: Track | null, positionMs: number, isPlaying: boolean): PlaybackState {
  const clamped = Math.max(0, Math.min(track?.durationMs ?? 0, positionMs));
  return {
    isPlaying: Boolean(track && isPlaying),
    startedAtTimestamp: Date.now(),
    startedAtPosition: clamped,
    pausedAtPosition: clamped,
    duration: track?.durationMs ?? 0,
    track,
  };
}

/* ──────────────────────────── Page ──────────────────────────── */

export default function HostPage() {
  const router = useRouter();

  /* Refs we read inside async/SDK callbacks */
  const socketRef = useRef<RoomiSocket | null>(null);
  const playerRef = useRef<PlayerControls | null>(null);
  const expectedUriRef = useRef("");
  const expectedTrackRef = useRef<Track | null>(null);
  const lastPlayCommandUriRef = useRef("");
  const skipGuardRef = useRef(false);
  const hostActionRef = useRef(false);
  const publishedSignatureRef = useRef("");
  const progressMsRef = useRef(0);
  const isDraggingRef = useRef(false);
  const currentTrackRef = useRef<Track | null>(null);
  const queueRef = useRef<QueueItem[]>([]);

  /* State */
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [status, setStatus] = useState<PlayerStatus>("Waiting for songs...");
  const [accessToken, setAccessToken] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [hostId, setHostId] = useState("");
  const [deviceId, setDeviceId] = useState("");
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [guests, setGuests] = useState<Record<string, string>>({});
  const [pendingGuests, setPendingGuests] = useState<Record<string, string>>({});
  const [roomAccess, setRoomAccessState] = useState<"open" | "locked">("open");
  const [playbackState, setPlaybackState] = useState<PlaybackState | null>(null);
  const [progressMs, setProgressMs] = useState(0);
  const [showSearch, setShowSearch] = useState(false);
  const [showGuests, setShowGuests] = useState(false);
  const [showDrawer, setShowDrawer] = useState(false);
  const [copied, setCopied] = useState(false);
  const [origin] = useState(() => (typeof window !== "undefined" ? window.location.origin : ""));
  const [accessUpdating, setAccessUpdating] = useState(false);
  const [approvingGuestId, setApprovingGuestId] = useState<string | null>(null);
  const [socketStatus, setSocketStatus] = useState<
    "connecting" | "connected" | "reconnecting" | "offline"
  >("connecting");

  useEffect(() => { currentTrackRef.current = currentTrack; }, [currentTrack]);
  useEffect(() => { queueRef.current = queue; }, [queue]);

  const displayTrack = currentTrack;
  const durationMs = displayTrack?.durationMs ?? 1;
  const guestCount = useMemo(() => Object.keys(guests).length, [guests]);
  const joinUrl = useMemo(
    () => (roomCode && origin ? `${origin}/room/${roomCode}` : ""),
    [origin, roomCode],
  );
  const isPlaying = status === "Playing";
  const playedRatio = Math.max(0, Math.min(1, durationMs > 0 ? progressMs / durationMs : 0));
  const hasTrack = !!displayTrack;

  /* ───────────── Playback publish (deduped) ───────────── */

  const publishPlaybackState = useCallback((playback: PlaybackState) => {
    const socket = socketRef.current;
    if (!socket) return;
    const signature = JSON.stringify({
      id: playback.track?.id ?? "",
      isPlaying: playback.isPlaying,
      startedAt: Math.floor(playback.startedAtPosition / 500) * 500,
      pausedAt: Math.floor(playback.pausedAtPosition / 500) * 500,
    });
    if (signature === publishedSignatureRef.current) return;
    publishedSignatureRef.current = signature;
    socket.emit("playback:state", { playback });
  }, []);

  const applyPlaybackState = useCallback(
    (playback: PlaybackState, shouldPublish = true) => {
      setPlaybackState(playback);
      setCurrentTrack(playback.track);
      setStatus(playback.isPlaying ? "Playing" : playback.track ? "Paused" : "Waiting for songs...");
      const position = playback.isPlaying ? playback.startedAtPosition : playback.pausedAtPosition;
      const clamped = Math.max(0, Math.min(playback.duration, position));
      progressMsRef.current = clamped;
      setProgressMs(clamped);
      if (shouldPublish) publishPlaybackState(playback);
    },
    [publishPlaybackState],
  );

  /* ───────────── Apply room state (from socket) ───────────── */

  const applyRoomState = useCallback((state: RoomState | undefined | null) => {
    if (!state) return;
    const queueIsEmpty = state.queue.length === 0;
    const hasTrack = Boolean(state.currentTrack || state.playback.track);
    const isIdle = queueIsEmpty && !hasTrack;
    const expectedUri = expectedUriRef.current;
    const payloadUri = state.playback.track?.uri ?? state.currentTrack?.uri ?? "";

    setQueue(state.queue);

    if (isIdle && !expectedUri) {
      setCurrentTrack(null);
      setPlaybackState(null);
      progressMsRef.current = 0;
      setProgressMs(0);
    } else {
      if (!expectedUri || payloadUri === expectedUri) {
        setCurrentTrack(state.currentTrack);
      }
      if (state.playback.track && (!expectedUri || state.playback.track.uri === expectedUri)) {
        applyPlaybackState(state.playback, false);
      } else if (!state.currentTrack && !expectedUri) {
        setPlaybackState(null);
        progressMsRef.current = 0;
        setProgressMs(0);
      }
    }

    setGuests(state.guests);
    setPendingGuests(state.pendingGuests);
    setRoomAccessState(state.access);
  }, [applyPlaybackState]);

  /* ───────────── Wait for confirmed SDK playback ───────────── */

  const wait = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

  const waitForConfirmedPlayback = useCallback(
    async (track: Track, fallbackPositionMs: number) => {
      for (let attempt = 0; attempt < 18; attempt += 1) {
        const snap = await playerRef.current?.getCurrentState().catch(() => null);
        const sdkTrack = snap?.track_window?.current_track ?? null;
        if (sdkTrack?.uri === track.uri) {
          const confirmed = makePlaybackState(
            track,
            snap?.position ?? fallbackPositionMs,
            !snap?.paused,
          );
          expectedUriRef.current = "";
          expectedTrackRef.current = null;
          applyPlaybackState(confirmed, true);
          return true;
        }
        await wait(150);
      }
      return false;
    },
    [applyPlaybackState],
  );

  /* ───────────── Start a track (idempotent for same URI) ───────────── */

  const startTrack = useCallback(
    async (track: Track | null, positionMs = 0) => {
      if (!track) {
        expectedUriRef.current = "";
        expectedTrackRef.current = null;
        lastPlayCommandUriRef.current = "";
        // Suppress the "unexpected SDK track" handler during the clear: the
        // SDK keeps the previous track URI in track_window even after pause+
        // seek(0), and we don't want that residual state to be misread as a
        // ghost track that needs restarting (which would recurse infinitely).
        hostActionRef.current = true;
        await playerRef.current?.clearPlayback().catch(() => undefined);
        applyPlaybackState(makePlaybackState(null, 0, false), true);
        window.setTimeout(() => { hostActionRef.current = false; }, 2000);
        return;
      }
      // In-flight guard: if a previous call for this URI is already underway,
      // skip. Both refs are set synchronously, so any concurrent re-entry
      // (room:state + autoPlayTrack ack racing, for example) bails out here.
      if (
        lastPlayCommandUriRef.current === track.uri &&
        expectedUriRef.current === track.uri
      ) {
        return;
      }
      expectedUriRef.current = track.uri;
      expectedTrackRef.current = track;
      lastPlayCommandUriRef.current = track.uri;
      hostActionRef.current = true;
      setError("");
      applyPlaybackState(makePlaybackState(track, positionMs, false), true);

      try {
        if (!playerRef.current) throw new Error("Spotify player is not ready yet");
        await playerRef.current.clearPlayback();
        await playerRef.current.playUri(track.uri, positionMs);
        let confirmed = await waitForConfirmedPlayback(track, positionMs);
        if (!confirmed) {
          await playerRef.current.playUri(track.uri, positionMs);
          confirmed = await waitForConfirmedPlayback(track, positionMs);
        }
        if (!confirmed) throw new Error("Spotify did not switch to the selected track");
      } catch (err) {
        expectedUriRef.current = "";
        expectedTrackRef.current = null;
        applyPlaybackState(makePlaybackState(track, positionMs, false), true);
        setError(err instanceof Error ? err.message : "Could not start Spotify playback");
      } finally {
        window.setTimeout(() => { hostActionRef.current = false; }, 500);
      }
    },
    [applyPlaybackState, waitForConfirmedPlayback],
  );

  /* ───────────── Advance to next track ───────────── */

  const fetchNextTrack = useCallback(() => {
    const socket = socketRef.current;
    if (!socket || skipGuardRef.current) return;
    skipGuardRef.current = true;
    window.setTimeout(() => { skipGuardRef.current = false; }, 1500);
    socket.emit("playback:next", {}, (ack: { error?: string; currentTrack?: Track | null }) => {
      if (ack?.error) {
        setError(ack.error);
        return;
      }
      void startTrack(ack?.currentTrack ?? null, 0);
    });
  }, [startTrack]);

  /* ───────────── Toggle play/pause ───────────── */

  const togglePlayPause = useCallback(async () => {
    if (!hasTrack) return;
    try {
      if (!playerRef.current) throw new Error("Spotify player is not ready yet");
      const track = currentTrackRef.current;
      if (!track) return;
      const position = progressMsRef.current;
      if (isPlaying) {
        await playerRef.current.pause();
        applyPlaybackState(makePlaybackState(track, position, false), true);
      } else {
        try {
          await playerRef.current.resume();
          applyPlaybackState(makePlaybackState(track, position, true), true);
        } catch {
          // SDK couldn't resume (e.g. device transferred away) — full reload.
          await startTrack(track, position);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not toggle playback");
    }
  }, [applyPlaybackState, hasTrack, isPlaying, startTrack]);

  /* ───────────── Seek ───────────── */

  const seekTo = async (positionMs: number) => {
    const next = Math.max(0, Math.min(durationMs, positionMs));
    progressMsRef.current = next;
    setProgressMs(next);
    try {
      if (!playerRef.current) throw new Error("Spotify player is not ready yet");
      const track = currentTrackRef.current;
      if (!track) return;
      await playerRef.current.seek(next);
      applyPlaybackState(makePlaybackState(track, next, isPlaying), true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not seek playback");
    }
  };
  const shiftBy = (deltaMs: number) => seekTo(progressMsRef.current + deltaMs);
  const handleProgressPointerDown = () => { isDraggingRef.current = true; };
  const handleProgressChange = (value: string) => {
    isDraggingRef.current = true;
    if (!displayTrack || durationMs <= 0) return;
    const next = Number(value);
    progressMsRef.current = next;
    setProgressMs(next);
  };
  const handleProgressPointerUp = async (
    e: React.PointerEvent<HTMLInputElement> | React.MouseEvent<HTMLInputElement> | React.TouchEvent<HTMLInputElement>,
  ) => {
    isDraggingRef.current = false;
    if (!displayTrack || durationMs <= 0) return;
    await seekTo(Number(e.currentTarget.value));
  };

  /* ───────────── Bootstrap auth + create-or-reuse room context ───────────── */

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const meRes = await fetch("/api/auth/me");
        const me = await meRes.json();
        if (cancelled) return;
        if (!me?.connected || !me?.hostId) {
          setError("Session expired. Please reconnect Spotify.");
          setLoading(false);
          return;
        }
        if (!me?.hasActiveRoom || !me?.roomCode) {
          setError("No active room. Create one from the home page.");
          setLoading(false);
          return;
        }
        const tokenRes = await fetch("/api/auth/token");
        if (!tokenRes.ok) {
          setError("Could not load Spotify token");
          setLoading(false);
          return;
        }
        const tokenPayload = await tokenRes.json();
        if (cancelled) return;
        setAccessToken(tokenPayload.access_token ?? "");
        setRoomCode(String(me.roomCode));
        setHostId(String(me.hostId));
      } catch {
        if (!cancelled) setError("Failed to initialize host room");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  /* ───────────── Refresh Spotify token every 45 minutes ───────────── */

  useEffect(() => {
    if (!roomCode) return;
    const id = window.setInterval(async () => {
      try {
        const res = await fetch("/api/auth/token");
        if (!res.ok) return;
        const payload = await res.json();
        if (payload?.access_token) {
          setAccessToken(payload.access_token);
          socketRef.current?.emit("room:set-token", { accessToken: payload.access_token });
        }
      } catch { /* best-effort */ }
    }, 45 * 60 * 1000);
    return () => window.clearInterval(id);
  }, [roomCode]);

  /* ───────────── Socket connection ───────────── */

  useEffect(() => {
    if (!roomCode || !hostId) return;
    const socket = createRoomiSocket();
    socketRef.current = socket;

    socket.on("connect", () => {
      setSocketStatus("connected");
      socket.emit("room:join", { roomCode, guestId: hostId, displayName: "Host", asHost: true }, (ack: { state?: RoomState; error?: string }) => {
        if (ack?.state) applyRoomState(ack.state);
        if (ack?.error) setError(ack.error);
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
    socket.on("playback:state", (playback: PlaybackState) => {
      // Host echoes its own publishes via this event too — dedupe via expected URI.
      const expected = expectedUriRef.current;
      if (expected && playback.track?.uri !== expected) return;
      applyPlaybackState(playback, false);
    });
    socket.on("room:closed", () => {
      router.push("/");
    });

    const pingId = window.setInterval(() => {
      socket.emit("room:ping", {});
    }, 15_000);

    return () => {
      window.clearInterval(pingId);
      socket.disconnect();
      socketRef.current = null;
    };
  }, [applyPlaybackState, applyRoomState, hostId, roomCode, router]);

  /* ───────────── Local progress ticker ───────────── */

  useEffect(() => {
    if (!playbackState?.track) {
      progressMsRef.current = 0;
      return;
    }
    const update = () => {
      if (isDraggingRef.current) return;
      const next = playbackState.isPlaying
        ? playbackState.startedAtPosition + (Date.now() - playbackState.startedAtTimestamp)
        : playbackState.pausedAtPosition;
      const clamped = Math.max(0, Math.min(playbackState.duration, next));
      progressMsRef.current = clamped;
      setProgressMs(clamped);
    };
    update();
    const id = window.setInterval(update, 500);
    return () => window.clearInterval(id);
  }, [playbackState]);

  /* ───────────── Spotify Player ready ───────────── */

  const handlePlayerReady = useCallback(
    async (newDeviceId: string) => {
      setDeviceId(newDeviceId);
      socketRef.current?.emit("room:set-device", { deviceId: newDeviceId });
      setError("");
      await playerRef.current?.setVolume(1).catch(() => undefined);
    },
    [],
  );

  /* ───────────── Auto-claim next + auto-start current ───────────── */

  // If there's a queue but no current track, ask the backend for next.
  useEffect(() => {
    if (!roomCode || !deviceId || currentTrack || queue.length === 0 || loading) return;
    const id = window.setTimeout(() => fetchNextTrack(), 0);
    return () => window.clearTimeout(id);
  }, [currentTrack, deviceId, fetchNextTrack, loading, queue.length, roomCode]);

  // If there's a current track we haven't told the SDK about yet, start it.
  useEffect(() => {
    if (!roomCode || !deviceId || !currentTrack || loading) return;
    if (expectedUriRef.current === currentTrack.uri) return;
    if (lastPlayCommandUriRef.current === currentTrack.uri) return;
    const id = window.setTimeout(() => void startTrack(currentTrack, 0), 0);
    return () => window.clearTimeout(id);
  }, [currentTrack, deviceId, loading, roomCode, startTrack]);

  // If queue empties out completely, make sure SDK isn't ghost-playing.
  useEffect(() => {
    if (!deviceId || loading || currentTrack || queue.length > 0) return;
    expectedUriRef.current = "";
    expectedTrackRef.current = null;
    const id = window.setTimeout(() => {
      void playerRef.current?.clearPlayback().catch(() => undefined);
      applyPlaybackState(makePlaybackState(null, 0, false), true);
    }, 0);
    return () => window.clearTimeout(id);
  }, [applyPlaybackState, currentTrack, deviceId, loading, queue.length]);

  /* ───────────── SDK signal handlers ───────────── */

  const lastGhostClearAtRef = useRef(0);
  const handleUnexpectedSpotifyTrack = useCallback((sdkTrackUri: string) => {
    if (!sdkTrackUri) return;
    const expected = expectedUriRef.current;
    const ourTrack = currentTrackRef.current;
    if (expected === sdkTrackUri || ourTrack?.uri === sdkTrackUri) return;
    if (expected || hostActionRef.current) return;
    // Spotify Connect can resurface a phantom internal queue. Roomi is the
    // authoritative queue, so stop the ghost and advance to our next track.
    // Rate-limit ghost-clears so that residual track_window state after a
    // clearPlayback (the SDK keeps the old URI) can't trigger a recursive
    // loop of startTrack(null) → clearPlayback → state change → repeat.
    if (Date.now() - lastGhostClearAtRef.current < 3000) return;
    lastGhostClearAtRef.current = Date.now();
    void playerRef.current?.pause().catch(() => undefined);
    if (queueRef.current.length > 0) {
      fetchNextTrack();
    } else {
      void startTrack(null);
    }
  }, [fetchNextTrack, startTrack]);

  const handleSdkStatusChange = useCallback((next: PlayerStatus) => {
    if (!hostActionRef.current && !expectedUriRef.current) setStatus(next);
  }, []);

  const handleSdkTrackChange = useCallback((sdkTrack: SDKTrack | null) => {
    if (!sdkTrack) return;
    handleUnexpectedSpotifyTrack(sdkTrack.uri);
    const expected = expectedUriRef.current;
    if (expected && sdkTrack.uri !== expected) return;
    if (!expected && currentTrackRef.current?.uri !== sdkTrack.uri) return;
    setCurrentTrack((cur) => {
      if (cur?.id === sdkTrack.id) return cur;
      return {
        id: sdkTrack.id,
        uri: sdkTrack.uri,
        title: sdkTrack.title,
        artist: sdkTrack.artist,
        albumArt: sdkTrack.albumArt,
        durationMs: sdkTrack.durationMs,
        addedBy: cur?.addedBy ?? hostId,
      };
    });
  }, [handleUnexpectedSpotifyTrack, hostId]);

  const handleSdkPlaybackState = useCallback((snapshot: Parameters<NonNullable<Parameters<typeof Player>[0]["onPlaybackState"]>>[0]) => {
    if (!snapshot) {
      if (!currentTrackRef.current) {
        applyPlaybackState(makePlaybackState(null, 0, false), true);
      }
      return;
    }
    const sdkTrack = snapshot.track_window?.current_track ?? null;
    const expected = expectedUriRef.current;
    if (sdkTrack?.uri) handleUnexpectedSpotifyTrack(sdkTrack.uri);
    if (expected && sdkTrack?.uri !== expected) return;
    if (!expected && sdkTrack?.uri !== currentTrackRef.current?.uri) return;

    const track: Track | null = sdkTrack
      ? expectedTrackRef.current?.uri === sdkTrack.uri
        ? expectedTrackRef.current
        : currentTrackRef.current?.id === sdkTrack.id
          ? currentTrackRef.current
          : {
              id: sdkTrack.id,
              uri: sdkTrack.uri,
              title: sdkTrack.name,
              artist: sdkTrack.artists.map((a) => a.name).join(", "),
              albumArt: sdkTrack.album.images[0]?.url ?? "",
              durationMs: sdkTrack.duration_ms,
              addedBy: currentTrackRef.current?.addedBy ?? hostId,
            }
      : null;
    if (expected && track?.uri === expected) {
      expectedUriRef.current = "";
      expectedTrackRef.current = null;
    }
    const next = makePlaybackState(track, snapshot.position ?? 0, !snapshot.paused);
    applyPlaybackState(next, true);
  }, [applyPlaybackState, handleUnexpectedSpotifyTrack, hostId]);

  /* ───────────── Moderation + access ───────────── */

  const setRoomAccess = (access: "open" | "locked") => {
    setAccessUpdating(true);
    setError("");
    socketRef.current?.emit("room:set-access", { access }, (ack: { error?: string }) => {
      setAccessUpdating(false);
      if (ack?.error) setError(ack.error);
    });
  };

  const handleGuestModeration = (
    guestId: string,
    intent: "approve-guest" | "reject-guest" | "kick-guest",
  ) => {
    setApprovingGuestId(guestId);
    socketRef.current?.emit("room:moderate-guest", { guestId, intent }, () => {
      setApprovingGuestId(null);
    });
  };

  const copyCode = async () => {
    if (!roomCode) return;
    await navigator.clipboard.writeText(roomCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const endSession = async () => {
    try {
      socketRef.current?.emit("room:end", {});
      await fetch("/api/room/end", { method: "POST" });
    } finally {
      router.push("/");
    }
  };

  const visibleGuests = useMemo(
    () =>
      Object.entries(guests)
        .filter(([gid]) => gid !== hostId)
        .map(([id, name]) => ({ id, name })),
    [guests, hostId],
  );
  const visiblePendingGuests = useMemo(
    () => Object.entries(pendingGuests).map(([id, name]) => ({ id, name })),
    [pendingGuests],
  );

  if (loading) {
    return (
      <div className="roomi-bg min-h-screen flex items-center justify-center">
        <div className="h-10 w-10 rounded-full border-2 border-slate-700 border-t-sky-400 animate-spin" />
      </div>
    );
  }

  /* ──────────────────────────── Render ──────────────────────────── */

  return (
    <div className="roomi-bg h-screen overflow-hidden text-slate-100">
      <div className="hidden">
        <Player
          ref={playerRef}
          accessToken={accessToken}
          onReady={handlePlayerReady}
          onTrackEnd={() => fetchNextTrack()}
          onStatusChange={handleSdkStatusChange}
          onTrackChange={handleSdkTrackChange}
          onPlaybackState={handleSdkPlaybackState}
          onError={setError}
        />
      </div>

      <main className="mx-auto flex h-full max-w-[1600px] flex-col px-4 py-0 sm:px-6 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(420px,1fr)] lg:px-8 lg:py-0">
        <section className="min-h-0 flex flex-1 flex-col justify-center overflow-y-auto px-0 pb-16 pt-0 lg:px-4 lg:pb-0 lg:pt-0 lg:border-r lg:border-white/10 lg:pr-8">
          <div className="flex w-full flex-col items-center justify-center">
            <div className="relative flex h-[15rem] w-[15rem] items-center justify-center lg:h-[26rem] lg:w-[26rem]">
              <div
                className="record-spin absolute z-10 h-[15rem] w-[15rem] rounded-full shadow-[0_40px_100px_rgba(0,0,0,0.8)] lg:h-[26rem] lg:w-[26rem]"
                style={{
                  animationPlayState: isPlaying ? "running" : "paused",
                  background:
                    "conic-gradient(from 45deg, #1a1a1a, #2a2a2a, #1a1a1a, #333, #1a1a1a, #2a2a2a, #1a1a1a, #333, #1a1a1a), radial-gradient(circle, transparent 20%, #1a1a1a 21%, #0d0d0d 22%, #1a1a1a 24%, #0d0d0d 26%, #222 28%, #0d0d0d 32%, #1a1a1a 36%, #0d0d0d 40%, #1a1a1a 45%, #0d0d0d 50%, #222 55%, #0d0d0d 60%, #1a1a1a 68%, #0d0d0d 76%, #1a1a1a 84%, #0d0d0d 92%, #1a1a1a 100%)",
                  backgroundBlendMode: "overlay",
                }}
              >
                <div
                  className="absolute inset-0 rounded-full"
                  style={{
                    background:
                      "conic-gradient(from 120deg, transparent 0%, rgba(255,255,255,0.04) 10%, transparent 20%, rgba(255,255,255,0.06) 45%, transparent 55%, rgba(255,255,255,0.03) 70%, transparent 80%)",
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
              <div
                className={`group relative flex h-9 items-center ${hasTrack ? "cursor-pointer" : "cursor-default opacity-40"}`}
              >
                <div className="relative h-2.5 w-full rounded-full bg-slate-500/20 pointer-events-none">
                  {hasTrack ? (
                    <>
                      <div
                        className="absolute inset-y-0 left-0 rounded-full shadow-[0_0_22px_rgba(96,165,250,0.45)] transition-none ease-linear"
                        style={{ width: `${playedRatio * 100}%`, background: progressGradient }}
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
                <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)_auto] lg:grid-cols-[minmax(0,1fr)_minmax(180px,0.9fr)_clamp(112px,9vw,148px)] xl:grid-cols-[minmax(0,1fr)_minmax(220px,0.9fr)_148px]">
                  <div className="flex h-full min-w-0 flex-col justify-start">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-sky-200/55">Room ID</p>
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
                        onClick={() => void endSession()}
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
                      <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-sky-200/55">Room status</p>
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
                          roomAccess === "open" ? "bg-sky-400 text-slate-950" : "text-slate-300 hover:bg-white/8"
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
                          roomAccess === "locked" ? "bg-amber-300 text-slate-950" : "text-slate-300 hover:bg-white/8"
                        }`}
                      >
                        <Lock className="h-3.5 w-3.5" />
                        Locked
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
                <div className="z-10 mb-4 flex shrink-0 flex-wrap items-center justify-between gap-3 lg:mt-0 lg:pt-4">
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
                      socket={socketRef.current}
                      guestId={hostId}
                      currentTrack={currentTrack}
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
                  <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-sky-200/65">Room Guests</p>
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
                  <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-amber-200/70">Waitlist</h3>
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
                  <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-sky-200/70">Connected</h3>
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
        socket={socketRef.current}
        queuedTrackIds={queue.map((q) => q.track.id)}
        currentTrackId={currentTrack?.id ?? null}
      />
    </div>
  );
}
