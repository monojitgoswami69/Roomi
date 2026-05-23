import type { Track } from "@/lib/types";

const SPOTIFY_ACCOUNTS = "https://accounts.spotify.com/api/token";
const SPOTIFY_API = "https://api.spotify.com/v1";

export class SpotifyApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "SpotifyApiError";
    this.status = status;
  }
}

function basicAuthHeader(): string {
  const clientId = (process.env.SPOTIFY_CLIENT_ID ?? "").trim();
  const clientSecret = (process.env.SPOTIFY_CLIENT_SECRET ?? "").trim();
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
}

export async function exchangeCodeForTokens(code: string, redirectUri: string): Promise<{
  access_token: string;
  refresh_token: string;
}> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
  });
  const res = await fetch(SPOTIFY_ACCOUNTS, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  if (!res.ok) {
    throw new SpotifyApiError(`Spotify token exchange failed: ${res.status}`, res.status);
  }
  return (await res.json()) as { access_token: string; refresh_token: string };
}

export async function refreshAccessToken(refreshToken: string): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  const res = await fetch(SPOTIFY_ACCOUNTS, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  if (!res.ok) {
    throw new SpotifyApiError(`Spotify token refresh failed: ${res.status}`, res.status);
  }
  const payload = (await res.json()) as { access_token: string };
  return payload.access_token;
}

async function spotifyFetch<T>(path: string, accessToken: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${SPOTIFY_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    throw new SpotifyApiError(`Spotify request failed: ${res.status}`, res.status);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export async function getSpotifyProfile(accessToken: string): Promise<{ displayName: string }> {
  const data = await spotifyFetch<{ display_name?: string; id?: string }>(
    "/me",
    accessToken,
  );
  return { displayName: data.display_name?.trim() || data.id || "Account" };
}

export async function searchTracks(accessToken: string, query: string, limit = 10, offset = 0): Promise<Track[]> {
  const safeLimit = Math.max(1, Math.min(10, Math.floor(limit)));
  const params = new URLSearchParams({
    q: query,
    type: "track",
    limit: String(safeLimit),
    offset: String(offset),
  });
  const data = await spotifyFetch<{
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

  return data.tracks.items.map((track) => ({
    id: track.id,
    uri: track.uri,
    title: track.name,
    artist: track.artists.map((a) => a.name).join(", "),
    albumArt: track.album.images[0]?.url ?? "",
    durationMs: track.duration_ms,
    addedBy: "",
  }));
}
