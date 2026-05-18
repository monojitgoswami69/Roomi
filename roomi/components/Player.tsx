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
  track_window: {
    current_track: SpotifyTrackInfo | null;
  };
};

type SpotifyPlayer = {
  connect: () => Promise<boolean>;
  disconnect: () => void;
  addListener: <TPayload = unknown>(
    eventName: string,
    callback: (payload: TPayload) => void,
  ) => void;
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
  pause: () => Promise<void>;
  setVolume: (volume: number) => Promise<void>;
  seek: (positionMs: number) => Promise<void>;
  getCurrentState: () => Promise<SpotifyPlaybackState | null>;
};

type PlayerProps = {
  accessToken: string;
  onReady: (deviceId: string) => void;
  onTrackEnd: () => void;
  onStatusChange?: (status: PlayerStatus) => void;
  onTrackChange?: (track: SDKTrack | null) => void;
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
  ({ accessToken, onReady, onTrackEnd, onStatusChange, onTrackChange, onError }, ref) => {
    const playerRef = useRef<SpotifyPlayer | null>(null);
    const lastPositionRef = useRef(0);
    const lastTrackUriRef = useRef("");
    const trackEndFiredRef = useRef(false);
    const [initializing, setInitializing] = useState(true);

    // Keep the latest access token in a ref so the SDK callback always reads
    // the freshest value WITHOUT causing the useEffect to re-run.
    const accessTokenRef = useRef(accessToken);
    accessTokenRef.current = accessToken;

    // Same for callbacks — keep refs so the effect closure is stable
    const onReadyRef = useRef(onReady);
    onReadyRef.current = onReady;
    const onTrackEndRef = useRef(onTrackEnd);
    onTrackEndRef.current = onTrackEnd;
    const onStatusChangeRef = useRef(onStatusChange);
    onStatusChangeRef.current = onStatusChange;
    const onTrackChangeRef = useRef(onTrackChange);
    onTrackChangeRef.current = onTrackChange;
    const onErrorRef = useRef(onError);
    onErrorRef.current = onError;

    useImperativeHandle(ref, () => ({
      play: async () => {
        if (!playerRef.current) {
          return;
        }
        await playerRef.current.resume();
      },
      pause: async () => {
        if (!playerRef.current) {
          return;
        }
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
        await playerRef.current.seek(positionMs);
      },
      getCurrentState: async () => {
        if (!playerRef.current) return null;
        return await playerRef.current.getCurrentState();
      },
    }));

    // Initialize the Spotify SDK player ONCE. The getOAuthToken callback
    // reads from accessTokenRef so it always has the latest token without
    // needing to tear down and rebuild the player.
    useEffect(() => {
      if (!accessToken) {
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
          const durationMs = currentTrack?.duration_ms ?? 0;
          const positionNearZero = state.position <= 200; // within 200 ms of start
          const positionNearEnd = durationMs > 0 && (durationMs - state.position) < 1000;
          const wasPlaying = lastPositionRef.current > 1000;
          const sameTrack = currentTrackUri.length > 0 && currentTrackUri === lastTrackUriRef.current;

          const isTrackEnd =
            state.paused &&
            !trackEndFiredRef.current &&
            sameTrack &&
            (positionNearZero && wasPlaying || positionNearEnd);

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
    }, [accessToken]);

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
