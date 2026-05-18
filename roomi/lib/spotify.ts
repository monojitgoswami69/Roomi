import axios from "axios";
import type { Track } from "@/lib/roomStore";

const SPOTIFY_ACCOUNTS_API = "https://accounts.spotify.com/api/token";
const SPOTIFY_WEB_API_BASE = "https://api.spotify.com/v1";

function getAuthHeader(): string {
  const clientId = process.env.SPOTIFY_CLIENT_ID ?? "";
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET ?? "";
  const token = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  return `Basic ${token}`;
}

export async function getAccessToken(refreshToken: string): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  const response = await axios.post<{ access_token: string }>(SPOTIFY_ACCOUNTS_API, body, {
    headers: {
      Authorization: getAuthHeader(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
  });

  return response.data.access_token;
}

export async function searchTracks(accessToken: string, query: string, limit = 10): Promise<Track[]> {
  const response = await axios.get<{
    tracks: {
      items: Array<{
        id: string;
        uri: string;
        name: string;
        duration_ms: number;
        artists: Array<{ name: string }>;
        album: { images: Array<{ url: string }> };
      }>;
    };
  }>(`${SPOTIFY_WEB_API_BASE}/search`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    params: {
      q: query,
      type: "track",
      limit,
    },
  });

  return response.data.tracks.items.map((track) => ({
    id: track.id,
    uri: track.uri,
    title: track.name,
    artist: track.artists.map((artist) => artist.name).join(", "),
    albumArt: track.album.images[0]?.url ?? "",
    durationMs: track.duration_ms,
    addedBy: "",
  }));
}

export async function getRecommendations(
  accessToken: string,
  seedGenres: string[],
  targetFeatures: Record<string, number> = {},
  limit = 12,
): Promise<Track[]> {
  const response = await axios.get<{
    tracks: Array<{
      id: string;
      uri: string;
      name: string;
      duration_ms: number;
      artists: Array<{ name: string }>;
      album: { images: Array<{ url: string }> };
    }>;
  }>(`${SPOTIFY_WEB_API_BASE}/recommendations`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    params: {
      seed_genres: seedGenres.join(","),
      limit,
      ...targetFeatures,
    },
  });

  return response.data.tracks.map((track) => ({
    id: track.id,
    uri: track.uri,
    title: track.name,
    artist: track.artists.map((a) => a.name).join(", "),
    albumArt: track.album.images[0]?.url ?? "",
    durationMs: track.duration_ms,
    addedBy: "",
  }));
}

export async function activatePlayerDevice(accessToken: string, deviceId: string): Promise<void> {
  await axios.put(
    `${SPOTIFY_WEB_API_BASE}/me/player`,
    { device_ids: [deviceId], play: false },
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function playTrack(
  accessToken: string,
  deviceId: string,
  uri: string,
  options?: { refreshToken?: string; onTokenRefresh?: (accessToken: string) => Promise<void> },
): Promise<void> {
  const startPlayback = async (token: string) => {
    await activatePlayerDevice(token, deviceId);
    await axios.put(
      `${SPOTIFY_WEB_API_BASE}/me/player/play`,
      { uris: [uri] },
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        params: {
          device_id: deviceId,
        },
      },
    );
  };

  const tryWithRetry = async (token: string): Promise<void> => {
    try {
      await startPlayback(token);
    } catch (error) {
      if (axios.isAxiosError(error) && [404, 429, 502, 503].includes(error.response?.status ?? 0)) {
        await wait(300);
        await startPlayback(token);
        return;
      }
      throw error;
    }
  };

  try {
    await tryWithRetry(accessToken);
  } catch (error) {
    // Auto-refresh on 401 if refresh credentials are provided
    if (
      axios.isAxiosError(error) &&
      error.response?.status === 401 &&
      options?.refreshToken
    ) {
      const freshToken = await getAccessToken(options.refreshToken);
      await options.onTokenRefresh?.(freshToken);
      await tryWithRetry(freshToken);
      return;
    }
    throw error;
  }
}

export async function getSpotifyProfile(accessToken: string): Promise<{ displayName: string }> {
  const response = await axios.get<{ display_name?: string; id?: string }>(`${SPOTIFY_WEB_API_BASE}/me`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  return {
    displayName: response.data.display_name?.trim() || response.data.id || "Account",
  };
}
