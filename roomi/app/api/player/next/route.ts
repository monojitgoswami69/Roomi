import { NextResponse } from "next/server";
import { providerGetRoom, providerPlayNext } from "@/lib/socketProvider";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const roomCode = typeof body?.roomCode === "string" ? body.roomCode.trim().toUpperCase() : "";

  if (!roomCode) {
    return NextResponse.json({ error: "roomCode is required" }, { status: 400 });
  }

  const room = await providerGetRoom(roomCode);
  if (!room) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }

  try {
    const result = await providerPlayNext(room.roomCode);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to play next track" },
      { status: 500 },
    );
  }
}
