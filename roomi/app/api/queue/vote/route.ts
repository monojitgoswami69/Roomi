import { NextResponse } from "next/server";
import { providerGetRoom, providerVote } from "@/lib/socketProvider";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const roomCode = typeof body?.roomCode === "string" ? body.roomCode.trim().toUpperCase() : "";
  const trackId = typeof body?.trackId === "string" ? body.trackId.trim() : "";
  const guestId = typeof body?.guestId === "string" ? body.guestId.trim() : "";
  const voteValue = body?.vote;

  if (!roomCode || !trackId || !guestId || (voteValue !== "up" && voteValue !== "down")) {
    return NextResponse.json({ error: "Invalid vote payload" }, { status: 400 });
  }

  const room = await providerGetRoom(roomCode);
  if (!room) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }

  const roomState = await providerVote(room.roomCode, guestId, trackId, voteValue);

  return NextResponse.json(roomState);
}
