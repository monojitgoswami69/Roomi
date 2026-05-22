import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    { error: "Playback is controlled by the host browser. Use /api/player/state to publish observed state." },
    { status: 410 },
  );
}
