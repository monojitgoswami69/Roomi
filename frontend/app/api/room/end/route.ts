import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { backendDeleteRoom } from "@/lib/backend";

export async function POST() {
  const session = await getSession();
  if (!session.isHost) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (session.roomCode) {
    await backendDeleteRoom(session.roomCode).catch(() => undefined);
    session.roomCode = undefined;
    await session.save();
  }
  return NextResponse.json({ ok: true });
}
