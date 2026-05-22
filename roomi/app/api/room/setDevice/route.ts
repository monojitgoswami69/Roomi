import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { providerGetRoom, providerSetDevice } from "@/lib/socketProvider";

export async function POST(request: Request) {
  const session = await getSession(request);

  if (!session.isHost || !session.roomCode) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const deviceId = body?.deviceId;

  if (!deviceId || typeof deviceId !== "string") {
    return NextResponse.json({ error: "Missing deviceId" }, { status: 400 });
  }

  const room = await providerGetRoom(session.roomCode);
  if (!room) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }

  await providerSetDevice(room.roomCode, deviceId);
  return NextResponse.json({ ok: true, deviceId });
}
