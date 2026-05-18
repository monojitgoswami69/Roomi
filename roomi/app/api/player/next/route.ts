import { NextResponse } from "next/server";
import { providerPlayNext } from "@/lib/socketProvider";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const roomCode = typeof body?.roomCode === "string" ? body.roomCode.trim().toUpperCase() : "";

  if (!roomCode) {
    return NextResponse.json({ error: "roomCode is required" }, { status: 400 });
  }

  try {
    const result = await providerPlayNext(roomCode);
    return NextResponse.json(result);
  } catch (error) {
    const status = error instanceof Error && error.message === "Room not found" ? 404 : 500;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to play next track" },
      { status },
    );
  }
}
