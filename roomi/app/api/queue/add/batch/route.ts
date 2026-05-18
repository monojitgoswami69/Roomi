import { NextResponse } from "next/server";
import type { Track } from "@/lib/roomStore";
import { providerAddTracks, providerGetRoom } from "@/lib/socketProvider";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const roomCode = typeof body?.roomCode === "string" ? body.roomCode.trim().toUpperCase() : "";
  const guestId = typeof body?.guestId === "string" ? body.guestId.trim() : "";
  const tracks = Array.isArray(body?.tracks) ? (body.tracks as Track[]) : [];

  if (!roomCode || !guestId || tracks.length === 0) {
    return NextResponse.json({ error: "Invalid queue payload" }, { status: 400 });
  }

  const validTracks = tracks.filter((track) => track?.id && track?.uri && track?.title);
  if (validTracks.length === 0) {
    return NextResponse.json({ error: "Invalid queue payload" }, { status: 400 });
  }

  const room = await providerGetRoom(roomCode);
  if (!room) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }

  const result = await providerAddTracks(room.roomCode, guestId, validTracks);
  return NextResponse.json(result.state ?? { ok: true, addedCount: result.addedCount });
}
