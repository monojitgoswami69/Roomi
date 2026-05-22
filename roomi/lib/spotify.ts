import type { Track } from "@/lib/roomStore";

const SPOTIFY_ACCOUNTS_API = "https://accounts.spotify.com/api/token";
const SPOTIFY_WEB_API_BASE = "https://api.spotify.com/v1";

export class SpotifyApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "SpotifyApiError";
    this.status = status;
  }
}

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

  const response = await fetch(SPOTIFY_ACCOUNTS_API, {
    method: "POST",
    headers: {
      Authorization: getAuthHeader(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  if (!response.ok) {
    throw new SpotifyApiError("Spotify token refresh failed", response.status);
  }

  const payload = (await response.json()) as { access_token: string };
  return payload.access_token;
}

async function spotifyFetch<T>(path: string, accessToken: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${SPOTIFY_WEB_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init.headers ?? {}),
    },
  });

  if (!response.ok) {
    throw new SpotifyApiError(`Spotify request failed: ${response.status}`, response.status);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export async function searchTracks(accessToken: string, query: string, limit = 10): Promise<Track[]> {
  const safeLimit = Math.max(1, Math.min(10, Math.floor(limit)));
  const params = new URLSearchParams({
    q: query,
    type: "track",
    limit: String(safeLimit),
  });
  const response = await spotifyFetch<{
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
  }>(`/search?${params}`, accessToken);

  return response.tracks.items.map((track) => ({
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
  const safeLimit = Math.max(1, Math.min(10, Math.floor(limit)));
  const params = new URLSearchParams({
    seed_genres: seedGenres.join(","),
    limit: String(safeLimit),
  });
  for (const [key, value] of Object.entries(targetFeatures)) {
    params.set(key, String(value));
  }
  const response = await spotifyFetch<{
    tracks: Array<{
      id: string;
      uri: string;
      name: string;
      duration_ms: number;
      artists: Array<{ name: string }>;
      album: { images: Array<{ url: string }> };
    }>;
  }>(`/recommendations?${params}`, accessToken);

  return response.tracks.map((track) => ({
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
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await spotifyFetch<void>("/me/player", accessToken, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ device_ids: [deviceId], play: false }),
      });
      return;
    } catch (error) {
      lastError = error;
      if (!(error instanceof SpotifyApiError) || ![404, 429, 502, 503].includes(error.status)) {
        throw error;
      }
      await wait(250 * (attempt + 1));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Spotify device activation failed");
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
    await spotifyFetch<void>(`/me/player/play?device_id=${encodeURIComponent(deviceId)}`, token, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ uris: [uri] }),
    });
  };

  const tryWithRetry = async (token: string): Promise<void> => {
    try {
      await startPlayback(token);
    } catch (error) {
      if (error instanceof SpotifyApiError && [404, 429, 502, 503].includes(error.status)) {
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
      error instanceof SpotifyApiError &&
      error.status === 401 &&
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
  const response = await spotifyFetch<{ display_name?: string; id?: string }>("/me", accessToken);

  return {
    displayName: response.display_name?.trim() || response.id || "Account",
  };
}
