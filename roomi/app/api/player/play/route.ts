import { NextResponse } from "next/server";
import { providerPlayTrack } from "@/lib/socketProvider";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const roomCode = typeof body?.roomCode === "string" ? body.roomCode.trim().toUpperCase() : "";
  const uri = typeof body?.uri === "string" ? body.uri.trim() : "";

  if (!roomCode || !uri) {
    return NextResponse.json({ error: "roomCode and uri are required" }, { status: 400 });
  }

  try {
    const result = await providerPlayTrack(roomCode, uri);
    return NextResponse.json(result);
  } catch (error) {
    const status = error instanceof Error && error.message === "Room not found" ? 404 : 500;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to play track" },
      { status },
    );
  }
}
