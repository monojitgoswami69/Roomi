import type { PlaybackState, PublicRoomState, Room, Track } from "@/lib/roomStore";

const providerUrl = process.env.SOCKET_PROVIDER_URL?.replace(/\/$/, "");

type ProviderRequestInit = Omit<RequestInit, "body"> & {
  body?: unknown;
};

export type ProviderRoomState = PublicRoomState & {
  roomCode: string;
  hostId: string;
  accessToken?: string;
  refreshToken?: string;
  deviceId?: string;
};

function requireProviderUrl(): string {
  if (!providerUrl) {
    throw new Error("SOCKET_PROVIDER_URL is required");
  }
  return providerUrl;
}

async function providerRequest<T>(path: string, init: ProviderRequestInit = {}): Promise<T> {
  const response = await fetch(`${requireProviderUrl()}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: "no-store",
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(payload?.error ?? `Socket provider request failed: ${response.status}`);
    (error as Error & { status?: number }).status = response.status;
    throw error;
  }

  return payload as T;
}

export async function providerCreateRoom(room: {
  hostId: string;
  accessToken: string;
  refreshToken: string;
}): Promise<{ roomCode: string; code: string }> {
  return providerRequest("/api/rooms", {
    method: "POST",
    body: room,
  });
}

export async function providerDeleteRoom(roomCode: string): Promise<void> {
  await providerRequest(`/api/rooms/${roomCode}`, { method: "DELETE" });
}

export async function providerGetRoom(roomCode: string, viewerId?: string): Promise<ProviderRoomState | null> {
  const search = viewerId ? `?viewerId=${encodeURIComponent(viewerId)}` : "";
  try {
    return await providerRequest(`/api/rooms/${roomCode}${search}`);
  } catch {
    return null;
  }
}

export async function providerJoinRoom(body: {
  roomCode: string;
  guestId: string;
  displayName: string;
}): Promise<{ status: "approved" | "pending"; roomCode: string; state?: ProviderRoomState }> {
  return providerRequest("/api/rooms/join", {
    method: "POST",
    body,
  });
}

export async function providerDisconnect(body: {
  roomCode: string;
  guestId: string;
  isHost?: boolean;
}): Promise<void> {
  await providerRequest("/api/rooms/disconnect", {
    method: "POST",
    body,
  });
}

export async function providerSetDevice(roomCode: string, deviceId: string): Promise<void> {
  await providerRequest(`/api/rooms/${roomCode}/device`, {
    method: "POST",
    body: { deviceId },
  });
}

export async function providerSetAccessToken(roomCode: string, accessToken: string): Promise<void> {
  await providerRequest(`/api/rooms/${roomCode}/token`, {
    method: "POST",
    body: { accessToken },
  });
}

export async function providerSetAccess(roomCode: string, access: "open" | "locked"): Promise<void> {
  await providerRequest(`/api/rooms/${roomCode}/access`, {
    method: "POST",
    body: { access },
  });
}

export async function providerModerateGuest(
  roomCode: string,
  intent: "approve-guest" | "reject-guest" | "kick-guest",
  guestId: string,
): Promise<void> {
  await providerRequest(`/api/rooms/${roomCode}/guests`, {
    method: "POST",
    body: { intent, guestId },
  });
}

export async function providerAddTrack(roomCode: string, guestId: string, track: Track): Promise<{ autoPlayTrack?: Track; state?: ProviderRoomState }> {
  return providerRequest(`/api/rooms/${roomCode}/queue`, {
    method: "POST",
    body: { guestId, track },
  });
}

export async function providerAddTracks(
  roomCode: string,
  guestId: string,
  tracks: Track[],
): Promise<{ addedCount: number; autoPlayTrack?: Track | null; state?: ProviderRoomState }> {
  return providerRequest(`/api/rooms/${roomCode}/queue/batch`, {
    method: "POST",
    body: { guestId, tracks },
  });
}

export async function providerVote(roomCode: string, guestId: string, trackId: string, vote: "up" | "down"): Promise<ProviderRoomState> {
  return providerRequest(`/api/rooms/${roomCode}/vote`, {
    method: "POST",
    body: { guestId, trackId, vote },
  });
}

export async function providerSetCurrentTrack(roomCode: string, track: Track | null): Promise<void> {
  await providerRequest(`/api/rooms/${roomCode}/current`, {
    method: "POST",
    body: { track },
  });
}

export async function providerRemoveTracks(roomCode: string, trackIds: string[]): Promise<void> {
  await providerRequest(`/api/rooms/${roomCode}/queue/remove`, {
    method: "POST",
    body: { trackIds },
  });
}

export async function providerPlayNext(roomCode: string): Promise<{ currentTrack: Track | null; playback?: PlaybackState }> {
  return providerRequest(`/api/rooms/${roomCode}/playback/next`, {
    method: "POST",
  });
}

export async function providerPublishPlaybackState(
  roomCode: string,
  playback: PlaybackState,
): Promise<{ playback: PlaybackState }> {
  return providerRequest(`/api/rooms/${roomCode}/playback/state`, {
    method: "POST",
    body: { playback },
  });
}

export function providerRoomToLegacyRoom(room: ProviderRoomState): Room {
  return {
    code: room.roomCode,
    hostId: room.hostId,
    accessToken: room.accessToken ?? "",
    refreshToken: room.refreshToken ?? "",
    deviceId: room.deviceId ?? "",
    access: room.access,
    queue: room.queue,
    currentTrack: room.currentTrack,
    playback: room.playback,
    guests: room.guests,
    pendingGuests: room.pendingGuests,
    createdAt: Date.now(),
    lastActivity: Date.now(),
  };
}
