import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { backendDeleteRoom } from "@/lib/backend";

export async function POST() {
  const session = await getSession();
  if (session.roomCode) {
    await backendDeleteRoom(session.roomCode).catch(() => undefined);
  }
  await session.destroy();
  return NextResponse.json({ ok: true });
}
