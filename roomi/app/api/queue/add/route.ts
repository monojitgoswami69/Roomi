import { NextResponse } from "next/server";
import type { Track } from "@/lib/roomStore";
import { playTrack } from "@/lib/spotify";
import {
  providerAddTrack,
  providerGetRoom,
  providerRemoveTracks,
  providerSetAccessToken,
  providerSetCurrentTrack,
} from "@/lib/socketProvider";

/**
 * Auto-play the first track when nothing is currently playing.
 * Proactively refreshes the access token to avoid stale-token failures.
 * Removes the track from queue and sets it as currentTrack.
 */
async function autoPlayTrack(roomCode: string, track: Track): Promise<void> {
  const room = await providerGetRoom(roomCode);
  if (!room || !room.deviceId) {
    return;
  }

  try {
    await playTrack(room.accessToken ?? "", room.deviceId, track.uri, {
      refreshToken: room.refreshToken,
      onTokenRefresh: (freshToken) => providerSetAccessToken(room.roomCode, freshToken),
    });
    await providerRemoveTracks(room.roomCode, [track.id]);
    await providerSetCurrentTrack(room.roomCode, track);
  } catch (err) {
    // Auto-play is best-effort; track stays in queue for client-side auto-play hook
    console.error("[autoPlayTrack] Failed:", err instanceof Error ? err.message : err);
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const roomCode = typeof body?.roomCode === "string" ? body.roomCode.trim().toUpperCase() : "";
  const guestId = typeof body?.guestId === "string" ? body.guestId.trim() : "";
  const track = body?.track as Track | undefined;

  if (!roomCode || !guestId || !track?.id || !track?.uri || !track?.title) {
    return NextResponse.json({ error: "Invalid queue payload" }, { status: 400 });
  }

  const room = await providerGetRoom(roomCode);
  if (!room) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }

  const result = await providerAddTrack(room.roomCode, guestId, track);

  if (result.autoPlayTrack && room.deviceId) {
    await autoPlayTrack(room.roomCode, result.autoPlayTrack);
  }

  const updatedRoom = await providerGetRoom(room.roomCode, guestId);

  return NextResponse.json(updatedRoom ?? result.state ?? { ok: true });
}
