import { NextResponse } from "next/server";
import type { PlaybackState } from "@/lib/roomStore";
import { providerPublishPlaybackState } from "@/lib/socketProvider";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const roomCode = typeof body?.roomCode === "string" ? body.roomCode.trim().toUpperCase() : "";
  const playback = body?.playback as PlaybackState | undefined;

  if (!roomCode || !playback) {
    return NextResponse.json({ error: "roomCode and playback are required" }, { status: 400 });
  }

  try {
    const result = await providerPublishPlaybackState(roomCode, playback);
    return NextResponse.json(result);
  } catch (error) {
    const providerStatus = (error as Error & { status?: number }).status;
    const status = providerStatus ?? (error instanceof Error && error.message === "Room not found" ? 404 : 500);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to publish playback state" },
      { status },
    );
  }
}
