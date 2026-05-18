import { NextResponse } from "next/server";
import type { Track } from "@/lib/roomStore";
import { providerAddTrack, providerGetRoom } from "@/lib/socketProvider";

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
  const updatedRoom = await providerGetRoom(room.roomCode, guestId);

  return NextResponse.json(updatedRoom ?? result.state ?? { ok: true });
}
