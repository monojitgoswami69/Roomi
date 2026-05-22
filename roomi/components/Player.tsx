"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { LoaderCircle } from "lucide-react";

type PlayerStatus = "Playing" | "Paused" | "Waiting for songs...";

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

type SpotifyPlaybackState = {
  paused: boolean;
  position: number;
  duration: number;
  track_window: {
    current_track: SpotifyTrackInfo | null;
  };
};

type SpotifyDevicesResponse = {
  devices: Array<{
    id: string | null;
    is_active: boolean;
    name: string;
    type: string;
  }>;
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
  getCurrentState: () => Promise<SpotifyPlaybackState | null>;
};

type SpotifyNamespace = {
  Player: new (options: {
    name: string;
    getOAuthToken: (callback: (token: string) => void) => void;
    volume?: number;
  }) => SpotifyPlayer;
};

declare global {
  interface Window {
    Spotify?: SpotifyNamespace;
    onSpotifyWebPlaybackSDKReady?: () => void;
  }
}

export type SDKTrack = {
  id: string;
  uri: string;
  title: string;
  artist: string;
  albumArt: string;
  durationMs: number;
};

export type PlayerControls = {
  play: () => Promise<void>;
  playUri: (uri: string, positionMs?: number) => Promise<void>;
  clearPlayback: () => Promise<void>;
  pause: () => Promise<void>;
  setVolume: (volume: number) => Promise<void>;
  seek: (positionMs: number) => Promise<void>;
  getCurrentState: () => Promise<SpotifyPlaybackState | null>;
};

type PlayerProps = {
  accessToken: string;
  deviceId?: string;
  onReady: (deviceId: string) => void;
  onTrackEnd: () => void;
  onStatusChange?: (status: PlayerStatus) => void;
  onTrackChange?: (track: SDKTrack | null) => void;
  onPlaybackState?: (state: SpotifyPlaybackState | null) => void;
  onError?: (message: string) => void;
};

function extractSDKTrack(spotifyTrack: SpotifyTrackInfo | null): SDKTrack | null {
  if (!spotifyTrack) return null;
  return {
    id: spotifyTrack.id,
    uri: spotifyTrack.uri,
    title: spotifyTrack.name,
    artist: spotifyTrack.artists.map((a) => a.name).join(", "),
    albumArt: spotifyTrack.album.images[0]?.url ?? "",
    durationMs: spotifyTrack.duration_ms,
  };
}

const Player = forwardRef<PlayerControls, PlayerProps>(
  ({ accessToken, deviceId, onReady, onTrackEnd, onStatusChange, onTrackChange, onPlaybackState, onError }, ref) => {
    const playerRef = useRef<SpotifyPlayer | null>(null);
    const activeDeviceIdRef = useRef("");
    const lastPositionRef = useRef(0);
    const lastTrackUriRef = useRef("");
    const trackEndFiredRef = useRef(false);
    const suppressTrackEndUntilRef = useRef(0);
    const [initializing, setInitializing] = useState(true);

    // Keep the latest access token in a ref so the SDK callback always reads
    // the freshest value WITHOUT causing the useEffect to re-run.
    const accessTokenRef = useRef(accessToken);
    accessTokenRef.current = accessToken;
    const deviceIdRef = useRef(deviceId ?? "");
    deviceIdRef.current = deviceId ?? "";

    // Same for callbacks — keep refs so the effect closure is stable
    const onReadyRef = useRef(onReady);
    onReadyRef.current = onReady;
    const onTrackEndRef = useRef(onTrackEnd);
    onTrackEndRef.current = onTrackEnd;
    const onStatusChangeRef = useRef(onStatusChange);
    onStatusChangeRef.current = onStatusChange;
    const onTrackChangeRef = useRef(onTrackChange);
    onTrackChangeRef.current = onTrackChange;
    const onPlaybackStateRef = useRef(onPlaybackState);
    onPlaybackStateRef.current = onPlaybackState;
    const onErrorRef = useRef(onError);
    onErrorRef.current = onError;

    const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

    const spotifyFetch = async <TResponse = void>(path: string, init: RequestInit = {}): Promise<TResponse> => {
      const response = await fetch(`https://api.spotify.com/v1${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${accessTokenRef.current}`,
          ...(init.headers ?? {}),
        },
      });
      if (!response.ok && response.status !== 204) {
        const payload = await response.json().catch(() => null);
        const message =
          payload?.error?.message ||
          payload?.error_description ||
          `Spotify request failed: ${response.status}`;
        const error = new Error(message);
        (error as Error & { status?: number }).status = response.status;
        throw error;
      }
      if (response.status === 204) {
        return undefined as TResponse;
      }
      return (await response.json().catch(() => undefined)) as TResponse;
    };

    const waitForDevice = async (deviceId: string): Promise<void> => {
      for (let attempt = 0; attempt < 12; attempt += 1) {
        try {
          const payload = await spotifyFetch<SpotifyDevicesResponse>("/me/player/devices");
          if (payload.devices.some((device) => device.id === deviceId)) {
            return;
          }
        } catch (error) {
          const status = (error as Error & { status?: number }).status;
          if (![401, 403, 404, 429, 500, 502, 503].includes(status ?? 0)) {
            throw error;
          }
        }
        await wait(300 * (attempt + 1));
      }
      throw new Error("Spotify browser device is not available yet. Try again in a moment.");
    };

    const activateDevice = async (play = false) => {
      const deviceIdToUse = activeDeviceIdRef.current || deviceIdRef.current;
      if (!deviceIdToUse) throw new Error("Spotify player is not ready yet");
      await waitForDevice(deviceIdToUse);
      for (let attempt = 0; attempt < 8; attempt += 1) {
        try {
          await spotifyFetch("/me/player", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ device_ids: [deviceIdToUse], play }),
          });
          return;
        } catch (error) {
          const status = (error as Error & { status?: number }).status;
          if (![404, 429, 502, 503].includes(status ?? 0) || attempt === 7) {
            throw error;
          }
          await wait(350 * (attempt + 1));
        }
      }
    };

    useImperativeHandle(ref, () => ({
      play: async () => {
        if (!playerRef.current) {
          return;
        }
        await playerRef.current.activateElement?.().catch(() => undefined);
        await activateDevice(true).catch(() => undefined);
        await playerRef.current.resume();
      },
      playUri: async (uri: string, positionMs = 0) => {
        if (!uri) return;
        const deviceIdToUse = activeDeviceIdRef.current || deviceIdRef.current;
        if (!deviceIdToUse) throw new Error("Spotify player is not ready yet");
        suppressTrackEndUntilRef.current = Date.now() + 1500;
        await playerRef.current?.activateElement?.().catch(() => undefined);
        await activateDevice(false);
        for (let attempt = 0; attempt < 12; attempt += 1) {
          try {
            await spotifyFetch(`/me/player/play?device_id=${encodeURIComponent(deviceIdToUse)}`, {
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
            if (![404, 429, 502, 503].includes(status ?? 0) || attempt === 11) {
              throw error;
            }
            await activateDevice(false).catch(() => undefined);
            await wait(400 * (attempt + 1));
          }
        }
      },
      clearPlayback: async () => {
        suppressTrackEndUntilRef.current = Date.now() + 1500;
        await playerRef.current?.pause().catch(() => undefined);
        await playerRef.current?.seek(0).catch(() => undefined);
        onPlaybackStateRef.current?.(null);
        onTrackChangeRef.current?.(null);
        onStatusChangeRef.current?.("Waiting for songs...");
      },
      pause: async () => {
        if (!playerRef.current) {
          return;
        }
        suppressTrackEndUntilRef.current = Date.now() + 1500;
        await playerRef.current.pause();
      },
      setVolume: async (volume: number) => {
        if (!playerRef.current) {
          return;
        }
        await playerRef.current.setVolume(volume);
      },
      seek: async (positionMs: number) => {
        if (!playerRef.current) return;
        suppressTrackEndUntilRef.current = Date.now() + 1500;
        const deviceIdToUse = activeDeviceIdRef.current || deviceIdRef.current;
        const clampedPosition = Math.max(0, Math.floor(positionMs));
        if (deviceIdToUse) {
          await spotifyFetch(
            `/me/player/seek?${new URLSearchParams({
              position_ms: String(clampedPosition),
              device_id: deviceIdToUse,
            }).toString()}`,
            { method: "PUT" },
          );
          return;
        }
        await playerRef.current.seek(clampedPosition);
      },
      getCurrentState: async () => {
        if (!playerRef.current) return null;
        return await playerRef.current.getCurrentState();
      },
    }));

    // Initialize the Spotify SDK player ONCE. The getOAuthToken callback
    // reads from accessTokenRef so it always has the latest token without
    // needing to tear down and rebuild the player.
    // Gate by `hasToken` (boolean) so token refreshes don't re-run this effect
    // and tear down an active player.
    const hasToken = Boolean(accessToken);
    useEffect(() => {
      if (!hasToken) {
        return;
      }

      let cancelled = false;
      setInitializing(true);

      const initializePlayer = () => {
        if (cancelled || !window.Spotify) {
          return;
        }

        if (playerRef.current) {
          playerRef.current.disconnect();
          playerRef.current = null;
        }

        const player = new window.Spotify.Player({
          name: "Roomi Host Player",
          getOAuthToken: (callback) => callback(accessTokenRef.current),
          volume: 0.7,
        });

        player.addListener("ready", ({ device_id }: { device_id: string }) => {
          if (cancelled) {
            return;
          }
          activeDeviceIdRef.current = device_id;
          deviceIdRef.current = device_id;
          setInitializing(false);
          onStatusChangeRef.current?.("Waiting for songs...");
          onReadyRef.current(device_id);
        });

        player.addListener("not_ready", () => {
          onStatusChangeRef.current?.("Paused");
        });

        player.addListener("authentication_error", ({ message }: { message: string }) => {
          onErrorRef.current?.(message || "Spotify authentication error");
        });

        player.addListener("initialization_error", ({ message }: { message: string }) => {
          onErrorRef.current?.(message || "Spotify player initialization error");
        });

        player.addListener("account_error", ({ message }: { message: string }) => {
          onErrorRef.current?.(message || "Spotify Premium account required");
        });

        player.addListener("player_state_changed", (state: SpotifyPlaybackState | null) => {
          onPlaybackStateRef.current?.(state);
          if (!state) {
            onStatusChangeRef.current?.("Waiting for songs...");
            onTrackChangeRef.current?.(null);
            return;
          }

          const currentTrack = state.track_window?.current_track ?? null;
          const currentTrackUri = currentTrack?.uri ?? "";

          // Report currently playing track to parent
          onTrackChangeRef.current?.(extractSDKTrack(currentTrack));

          // When the URI changes, a new track started — reset the end-fired guard
          if (currentTrackUri !== lastTrackUriRef.current) {
            trackEndFiredRef.current = false;
          }

          // Detect natural track end:
          //   The SDK fires paused=true with position snapping to 0 (or very close)
          //   while the URI stays the same and we were previously well into the track.
          const positionNearZero = state.position <= 200; // within 200 ms of start
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
            onStatusChangeRef.current?.(currentTrackUri ? "Paused" : "Waiting for songs...");
          } else {
            onStatusChangeRef.current?.("Playing");
            // Reset guard when playback resumes so the next natural end is caught
            trackEndFiredRef.current = false;
          }

          if (isTrackEnd) {
            trackEndFiredRef.current = true;
            onTrackEndRef.current();
          }

          lastPositionRef.current = state.position;
          lastTrackUriRef.current = currentTrackUri;
        });

        player.connect().catch(() => {
          onErrorRef.current?.("Could not connect Spotify player");
        });

        playerRef.current = player;
      };

      if (window.Spotify) {
        initializePlayer();
      } else {
        window.onSpotifyWebPlaybackSDKReady = initializePlayer;
        let scriptTag = document.getElementById("spotify-web-playback-sdk") as HTMLScriptElement | null;

        if (!scriptTag) {
          scriptTag = document.createElement("script");
          scriptTag.id = "spotify-web-playback-sdk";
          scriptTag.src = "https://sdk.scdn.co/spotify-player.js";
          scriptTag.async = true;
          document.body.appendChild(scriptTag);
        }
      }

      return () => {
        cancelled = true;
        if (playerRef.current) {
          playerRef.current.disconnect();
          playerRef.current = null;
        }
      };
    }, [hasToken]);

    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3 text-sm text-zinc-300">
        <div className="flex items-center gap-2">
          {initializing ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
          <span>{initializing ? "Initializing Spotify player..." : "Spotify player connected"}</span>
        </div>
      </div>
    );
  },
);

Player.displayName = "Player";

export default Player;
