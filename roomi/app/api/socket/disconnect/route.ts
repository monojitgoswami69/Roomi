import { NextResponse } from "next/server";
import { providerDisconnect } from "@/lib/socketProvider";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const roomCode = typeof body?.roomCode === "string" ? body.roomCode.trim().toUpperCase() : "";
  const guestId = typeof body?.guestId === "string" ? body.guestId.trim() : "";
  const isHost = Boolean(body?.isHost);

  if (!roomCode || !guestId) {
    return NextResponse.json({ error: "Invalid disconnect payload" }, { status: 400 });
  }

  await providerDisconnect({ roomCode, guestId, isHost });

  return NextResponse.json({ ok: true });
}
