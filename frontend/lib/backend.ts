/**
 * Server-side helpers for talking to the Roomi backend over HTTP.
 * The frontend uses these for actions that cannot or should not happen
 * directly over the websocket (room creation after OAuth, search proxy,
 * refreshing the room's access token after Spotify rotation).
 */

const BACKEND_URL = (process.env.BACKEND_URL ?? "http://127.0.0.1:4001").replace(/\/$/, "");
const SECRET = (process.env.SOCKET_PROVIDER_SECRET ?? "").trim();

type Json = Record<string, unknown>;

async function call<T>(path: string, init: { method?: string; body?: Json } = {}): Promise<T> {
  // When no secret is set, omit the header entirely. The backend mirrors this:
  // if its SOCKET_PROVIDER_SECRET is also empty, requests are accepted. Once
  // either side configures one, both must match.
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (SECRET) headers["x-roomi-secret"] = SECRET;
  const res = await fetch(`${BACKEND_URL}${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  const payload = (await res.json().catch(() => null)) as { error?: string } | null;
  if (!res.ok) {
    const err = new Error((payload && payload.error) || `Backend ${res.status}`);
    (err as Error & { status?: number }).status = res.status;
    throw err;
  }
  return payload as T;
}

export async function backendCreateRoom(input: {
  hostId: string;
  accessToken: string;
  refreshToken: string;
}): Promise<{ roomCode: string }> {
  return call("/api/rooms", { method: "POST", body: input });
}

export async function backendDeleteRoom(roomCode: string): Promise<void> {
  await call(`/api/rooms/${encodeURIComponent(roomCode)}`, { method: "DELETE" });
}

export async function backendGetRoomToken(
  roomCode: string,
): Promise<{ accessToken: string; refreshToken: string } | null> {
  try {
    return await call(`/internal/rooms/${encodeURIComponent(roomCode)}/access-token`);
  } catch (error) {
    if ((error as Error & { status?: number }).status === 404) return null;
    throw error;
  }
}

export async function backendUpdateRoomToken(roomCode: string, accessToken: string): Promise<void> {
  await call(`/internal/rooms/${encodeURIComponent(roomCode)}/access-token`, {
    method: "POST",
    body: { accessToken },
  });
}
