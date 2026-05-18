import { NextResponse } from "next/server";
import { providerGetRoom, providerSeek } from "@/lib/socketProvider";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const roomCode = typeof body?.roomCode === "string" ? body.roomCode.trim().toUpperCase() : "";
  const positionMs = Number(body?.positionMs ?? 0);

  if (!roomCode || !Number.isFinite(positionMs)) {
    return NextResponse.json({ error: "roomCode and positionMs are required" }, { status: 400 });
  }

  const room = await providerGetRoom(roomCode);
  if (!room) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }

  try {
    const result = await providerSeek(room.roomCode, positionMs);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to seek playback" },
      { status: 500 },
    );
  }
}
