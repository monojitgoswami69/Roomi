import { NextResponse } from "next/server";
import { providerSeek } from "@/lib/socketProvider";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const roomCode = typeof body?.roomCode === "string" ? body.roomCode.trim().toUpperCase() : "";
  const positionMs = Number(body?.positionMs ?? 0);

  if (!roomCode || !Number.isFinite(positionMs)) {
    return NextResponse.json({ error: "roomCode and positionMs are required" }, { status: 400 });
  }

  try {
    const result = await providerSeek(roomCode, positionMs);
    return NextResponse.json(result);
  } catch (error) {
    const status = error instanceof Error && error.message === "Room not found" ? 404 : 500;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to seek playback" },
      { status },
    );
  }
}
