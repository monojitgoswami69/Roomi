import { NextResponse } from "next/server";
import { playTrack } from "@/lib/spotify";
import { providerGetRoom, providerSetAccessToken, providerSetCurrentTrack } from "@/lib/socketProvider";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const roomCode = typeof body?.roomCode === "string" ? body.roomCode.trim().toUpperCase() : "";
  const uri = typeof body?.uri === "string" ? body.uri.trim() : "";

  if (!roomCode || !uri) {
    return NextResponse.json({ error: "roomCode and uri are required" }, { status: 400 });
  }

  const room = await providerGetRoom(roomCode);
  if (!room) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }

  if (!room.deviceId) {
    return NextResponse.json({ error: "Player not ready. Wait for Spotify to connect in your browser." }, { status: 400 });
  }

  try {
    await playTrack(room.accessToken ?? "", room.deviceId, uri, {
      refreshToken: room.refreshToken,
      onTokenRefresh: (freshToken) => providerSetAccessToken(room.roomCode, freshToken),
    });
    const playingTrack = room.queue.find((item) => item.track.uri === uri)?.track ?? room.currentTrack;
    await providerSetCurrentTrack(room.roomCode, playingTrack ?? null);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Failed to play track" }, { status: 500 });
  }
}
