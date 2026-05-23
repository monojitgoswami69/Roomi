"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { LoaderCircle } from "lucide-react";

/* ─────────────────────────── Spotify SDK types ─────────────────────────── */

type SpotifyTrackInfo = {
  uri: string;
  id: string;
  name: string;
  duration_ms: number;
  artists: Array<{ name: string; uri: string }>;
  album: {
    name: string;
    uri: string;
    images: Array<{ url: string; height: number; width: number }>;
  };
};

type SpotifyPlaybackSnapshot = {
  paused: boolean;
  position: number;
  duration: number;
  track_window: { current_track: SpotifyTrackInfo | null };
};

type SpotifyDevicesResponse = {
  devices: Array<{ id: string | null; is_active: boolean; name: string; type: string }>;
};

type SpotifyPlayer = {
  connect: () => Promise<boolean>;
  disconnect: () => void;
  addListener: <TPayload = unknown>(
    eventName: string,
    callback: (payload: TPayload) => void,
  ) => void;
  activateElement?: () => Promise<void>;
  resume: () => Promise<void>;
  pause: () => Promise<void>;
  setVolume: (volume: number) => Promise<void>;
  seek: (position_ms: number) => Promise<void>;
  getCurrentState: () => Promise<SpotifyPlaybackSnapshot | null>;
};

type SpotifyNamespace = {
  Player: new (options: {
    name: string;
    getOAuthToken: (cb: (token: string) => void) => void;
    volume?: number;
  }) => SpotifyPlayer;
};

declare global {
  interface Window {
    Spotify?: SpotifyNamespace;
    onSpotifyWebPlaybackSDKReady?: () => void;
  }
}

/* ──────────────────────────── Public types ──────────────────────────── */

export type PlayerStatus = "Playing" | "Paused" | "Waiting for songs...";

export type SDKTrack = {
  id: string;
  uri: string;
  title: string;
  artist: string;
  albumArt: string;
  durationMs: number;
};

export type PlayerControls = {
  /** Resume the currently loaded track from where it was paused. */
  resume: () => Promise<void>;
  /** Load and start playing a specific track URI (optionally at a position). */
  playUri: (uri: string, positionMs?: number) => Promise<void>;
  /** Pause the SDK without unloading the track. */
  pause: () => Promise<void>;
  /** Pause + seek to 0 to clear visible playback before loading the next track. */
  clearPlayback: () => Promise<void>;
  setVolume: (volume: number) => Promise<void>;
  seek: (positionMs: number) => Promise<void>;
  getCurrentState: () => Promise<SpotifyPlaybackSnapshot | null>;
};

type PlayerProps = {
  /** Initial access token. Token rotations should be passed through too, but
   *  the player itself is never torn down — see internals. */
  accessToken: string;
  onReady: (deviceId: string) => void;
  onTrackEnd: () => void;
  onStatusChange?: (status: PlayerStatus) => void;
  onTrackChange?: (track: SDKTrack | null) => void;
  onPlaybackState?: (snapshot: SpotifyPlaybackSnapshot | null) => void;
  onError?: (message: string) => void;
};

function extractSDKTrack(t: SpotifyTrackInfo | null): SDKTrack | null {
  if (!t) return null;
  return {
    id: t.id,
    uri: t.uri,
    title: t.name,
    artist: t.artists.map((a) => a.name).join(", "),
    albumArt: t.album.images[0]?.url ?? "",
    durationMs: t.duration_ms,
  };
}

const wait = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

const Player = forwardRef<PlayerControls, PlayerProps>(function Player(
  { accessToken, onReady, onTrackEnd, onStatusChange, onTrackChange, onPlaybackState, onError },
  ref,
) {
  const playerRef = useRef<SpotifyPlayer | null>(null);
  const activeDeviceIdRef = useRef("");
  /** device_id last confirmed via /me/player/devices — skip re-polling for it */
  const confirmedDeviceIdRef = useRef("");
  const lastPositionRef = useRef(0);
  const lastTrackUriRef = useRef("");
  const trackEndFiredRef = useRef(false);
  const suppressTrackEndUntilRef = useRef(0);
  const [initializing, setInitializing] = useState(true);

  // Token is read fresh via a ref so refresh doesn't tear down the player.
  const accessTokenRef = useRef(accessToken);
  accessTokenRef.current = accessToken;

  // Callbacks via refs so the init effect closure stays stable.
  const cb = {
    onReady: useRef(onReady),
    onTrackEnd: useRef(onTrackEnd),
    onStatusChange: useRef(onStatusChange),
    onTrackChange: useRef(onTrackChange),
    onPlaybackState: useRef(onPlaybackState),
    onError: useRef(onError),
  };
  cb.onReady.current = onReady;
  cb.onTrackEnd.current = onTrackEnd;
  cb.onStatusChange.current = onStatusChange;
  cb.onTrackChange.current = onTrackChange;
  cb.onPlaybackState.current = onPlaybackState;
  cb.onError.current = onError;

  /* ── HTTP helpers using the freshest access token ── */
  async function spotifyFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`https://api.spotify.com/v1${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${accessTokenRef.current}`,
        ...(init.headers ?? {}),
      },
    });
    if (!res.ok && res.status !== 204) {
      const payload = await res.json().catch(() => null);
      const message =
        payload?.error?.message || payload?.error_description || `Spotify ${res.status}`;
      const err = new Error(message);
      (err as Error & { status?: number }).status = res.status;
      throw err;
    }
    if (res.status === 204) return undefined as T;
    return (await res.json().catch(() => undefined)) as T;
  }

  async function waitForDevice(deviceId: string): Promise<void> {
    // Once a device has been confirmed visible to the Spotify Web API, every
    // subsequent operation can target it without polling /me/player/devices
    // again. The confirmation is invalidated when the SDK re-emits `ready`
    // with a new device id (e.g. SDK reinit after navigation).
    if (confirmedDeviceIdRef.current === deviceId) return;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      try {
        const payload = await spotifyFetch<SpotifyDevicesResponse>("/me/player/devices");
        if (payload.devices.some((d) => d.id === deviceId)) {
          confirmedDeviceIdRef.current = deviceId;
          return;
        }
      } catch (error) {
        const status = (error as Error & { status?: number }).status;
        if (![401, 403, 404, 429, 500, 502, 503].includes(status ?? 0)) throw error;
      }
      await wait(400 * (attempt + 1));
    }
    throw new Error("Spotify browser device is not available yet. Try again in a moment.");
  }

  async function transferToDevice(deviceId: string, play: boolean): Promise<void> {
    await waitForDevice(deviceId);
    for (let attempt = 0; attempt < 6; attempt += 1) {
      try {
        await spotifyFetch("/me/player", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ device_ids: [deviceId], play }),
        });
        return;
      } catch (error) {
        const status = (error as Error & { status?: number }).status;
        if (![404, 429, 502, 503].includes(status ?? 0) || attempt === 5) throw error;
        await wait(350 * (attempt + 1));
      }
    }
  }

  /* ── Imperative API exposed to host page ── */
  useImperativeHandle(ref, () => ({
    resume: async () => {
      if (!playerRef.current) return;
      await playerRef.current.activateElement?.().catch(() => undefined);
      // resume() is sufficient when the SDK has a track loaded; no transfer needed.
      await playerRef.current.resume();
    },
    playUri: async (uri: string, positionMs = 0) => {
      if (!uri) return;
      const deviceId = activeDeviceIdRef.current;
      if (!deviceId) throw new Error("Spotify player is not ready yet");
      suppressTrackEndUntilRef.current = Date.now() + 1500;
      await playerRef.current?.activateElement?.().catch(() => undefined);
      await transferToDevice(deviceId, false);
      for (let attempt = 0; attempt < 10; attempt += 1) {
        try {
          await spotifyFetch(`/me/player/play?device_id=${encodeURIComponent(deviceId)}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              uris: [uri],
              position_ms: Math.max(0, Math.floor(positionMs)),
            }),
          });
          return;
        } catch (error) {
          const status = (error as Error & { status?: number }).status;
          if (![404, 429, 502, 503].includes(status ?? 0) || attempt === 9) throw error;
          await transferToDevice(deviceId, false).catch(() => undefined);
          await wait(400 * (attempt + 1));
        }
      }
    },
    pause: async () => {
      if (!playerRef.current) return;
      suppressTrackEndUntilRef.current = Date.now() + 1500;
      await playerRef.current.pause();
    },
    clearPlayback: async () => {
      suppressTrackEndUntilRef.current = Date.now() + 1500;
      await playerRef.current?.pause().catch(() => undefined);
      await playerRef.current?.seek(0).catch(() => undefined);
      // Reset state-tracking refs so the SDK's residual `track_window` state
      // (Spotify keeps the last URI loaded even after pause+seek) isn't
      // misread as a still-playing track on the next event.
      lastPositionRef.current = 0;
      lastTrackUriRef.current = "";
      trackEndFiredRef.current = false;
      cb.onPlaybackState.current?.(null);
      cb.onTrackChange.current?.(null);
      cb.onStatusChange.current?.("Waiting for songs...");
    },
    setVolume: async (volume: number) => {
      await playerRef.current?.setVolume(volume);
    },
    seek: async (positionMs: number) => {
      if (!playerRef.current) return;
      suppressTrackEndUntilRef.current = Date.now() + 1500;
      // Use the SDK's own seek — it operates on the SDK's player directly and
      // doesn't take a device_id query param that can 404 if Spotify briefly
      // disconnected the device.
      await playerRef.current.seek(Math.max(0, Math.floor(positionMs)));
    },
    getCurrentState: async () => {
      return (await playerRef.current?.getCurrentState()) ?? null;
    },
  }));

  /* ── Init exactly once after the first token arrives ──
   * Effect deps on `hasToken` (boolean), NOT the token string, so subsequent
   * refreshes don't tear down the player. The getOAuthToken callback always
   * reads accessTokenRef.current, so Spotify still gets the fresh token. */
  const hasToken = Boolean(accessToken);
  useEffect(() => {
    if (!hasToken) return;
    let cancelled = false;
    setInitializing(true);
    // Unique player name per mount avoids Spotify rejecting the new player
    // when StrictMode (or a quick re-navigation to /host) tears down and
    // rebuilds the SDK before Spotify has fully released the previous device.
    const playerName = `Roomi Host ${Math.random().toString(36).slice(2, 8)}`;

    // Natural-end watchdog. The Web Playback SDK is unreliable about
    // firing player_state_changed at the end of a track when there's
    // nothing in Spotify's own queue (which is our normal case — we play
    // single URIs). We schedule a check at the expected end time and, if
    // the SDK has indeed stopped at the duration, fire onTrackEnd.
    let watchdogTimer: number | null = null;
    const clearWatchdog = () => {
      if (watchdogTimer !== null) {
        window.clearTimeout(watchdogTimer);
        watchdogTimer = null;
      }
    };

    const initialize = () => {
      if (cancelled || !window.Spotify) return;
      if (playerRef.current) {
        playerRef.current.disconnect();
        playerRef.current = null;
      }
      // Reset the cached device confirmation so the new device_id is
      // re-checked once against /me/player/devices.
      confirmedDeviceIdRef.current = "";
      const player = new window.Spotify.Player({
        name: playerName,
        getOAuthToken: (callback) => callback(accessTokenRef.current),
        volume: 0.7,
      });

      player.addListener("ready", ({ device_id }: { device_id: string }) => {
        if (cancelled) return;
        if (activeDeviceIdRef.current !== device_id) {
          // Either first ready, or SDK reconnected on a new device id — drop
          // any prior /me/player/devices confirmation.
          confirmedDeviceIdRef.current = "";
        }
        activeDeviceIdRef.current = device_id;
        setInitializing(false);
        cb.onStatusChange.current?.("Waiting for songs...");
        cb.onReady.current?.(device_id);
      });

      player.addListener("not_ready", () => {
        cb.onStatusChange.current?.("Paused");
      });

      const errorHandler = (key: string) => ({ message }: { message: string }) => {
        cb.onError.current?.(message || `Spotify ${key}`);
      };
      player.addListener("authentication_error", errorHandler("authentication error"));
      player.addListener("initialization_error", errorHandler("initialization error"));
      player.addListener("account_error", errorHandler("Premium account required"));

      player.addListener("player_state_changed", (state: SpotifyPlaybackSnapshot | null) => {
        // Cancel any pending end-of-track watchdog — a state change supersedes it.
        clearWatchdog();
        cb.onPlaybackState.current?.(state);
        if (!state) {
          cb.onStatusChange.current?.("Waiting for songs...");
          cb.onTrackChange.current?.(null);
          return;
        }
        const currentTrack = state.track_window?.current_track ?? null;
        const currentTrackUri = currentTrack?.uri ?? "";

        cb.onTrackChange.current?.(extractSDKTrack(currentTrack));

        // Reset end-fired guard when URI changes (new track started).
        if (currentTrackUri !== lastTrackUriRef.current) {
          trackEndFiredRef.current = false;
        }

        // Natural-end detection: the SDK snaps position→0 and sets paused=true
        // for the SAME current_track when a track completes (and there's no
        // Spotify-side queue). Require that we were previously well into the
        // track to avoid false positives from a fresh paused load.
        const positionNearZero = state.position <= 200;
        const wasPlaying = lastPositionRef.current > 1000;
        const sameTrack = currentTrackUri.length > 0 && currentTrackUri === lastTrackUriRef.current;
        const isTrackEnd =
          state.paused &&
          Date.now() > suppressTrackEndUntilRef.current &&
          !trackEndFiredRef.current &&
          sameTrack &&
          positionNearZero &&
          wasPlaying;

        if (state.paused) {
          cb.onStatusChange.current?.(currentTrackUri ? "Paused" : "Waiting for songs...");
        } else {
          cb.onStatusChange.current?.("Playing");
          trackEndFiredRef.current = false;
        }

        if (isTrackEnd) {
          trackEndFiredRef.current = true;
          cb.onTrackEnd.current?.();
        }

        lastPositionRef.current = state.position;
        lastTrackUriRef.current = currentTrackUri;

        // If we're now actively playing, schedule the natural-end watchdog
        // at the expected end + a 1s grace period. When it fires, we double
        // check that the SDK has stalled at the end and emit onTrackEnd if
        // the SDK never fired its own end signal.
        if (!state.paused && state.duration > 0 && currentTrackUri) {
          const remaining = Math.max(0, state.duration - state.position);
          watchdogTimer = window.setTimeout(async () => {
            watchdogTimer = null;
            if (trackEndFiredRef.current) return;
            const snap = await playerRef.current?.getCurrentState().catch(() => null);
            const snapUri = snap?.track_window?.current_track?.uri ?? "";
            if (snapUri !== currentTrackUri) return;
            const atEnd =
              snap !== null &&
              snap !== undefined &&
              snap.duration > 0 &&
              snap.position >= snap.duration - 500;
            if (atEnd && snap.paused && !trackEndFiredRef.current) {
              trackEndFiredRef.current = true;
              cb.onTrackEnd.current?.();
            }
          }, remaining + 1000);
        }
      });

      player.connect().catch(() => {
        cb.onError.current?.("Could not connect Spotify player");
      });
      playerRef.current = player;
    };

    if (window.Spotify) {
      initialize();
    } else {
      window.onSpotifyWebPlaybackSDKReady = initialize;
      if (!document.getElementById("spotify-web-playback-sdk")) {
        const script = document.createElement("script");
        script.id = "spotify-web-playback-sdk";
        script.src = "https://sdk.scdn.co/spotify-player.js";
        script.async = true;
        document.body.appendChild(script);
      }
    }

    return () => {
      cancelled = true;
      clearWatchdog();
      if (playerRef.current) {
        playerRef.current.disconnect();
        playerRef.current = null;
      }
      activeDeviceIdRef.current = "";
      confirmedDeviceIdRef.current = "";
      lastPositionRef.current = 0;
      lastTrackUriRef.current = "";
      trackEndFiredRef.current = false;
      suppressTrackEndUntilRef.current = 0;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasToken]);

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3 text-sm text-zinc-300">
      <div className="flex items-center gap-2">
        {initializing ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
        <span>{initializing ? "Initializing Spotify player..." : "Spotify player connected"}</span>
      </div>
    </div>
  );
});

export default Player;
