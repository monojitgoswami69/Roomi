import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { providerDeleteRoom, providerGetRoom } from "@/lib/socketProvider";

export async function POST(request: Request) {
  const session = await getSession(request);

  if (session.roomCode && (await providerGetRoom(session.roomCode))) {
    await providerDeleteRoom(session.roomCode);
  }

  await session.destroy();
  return NextResponse.json({ ok: true });
}
