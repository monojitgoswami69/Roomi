import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { providerDeleteRoom, providerGetRoom } from "@/lib/socketProvider";

export async function POST(request: Request) {
  const session = await getSession(request);

  if (!session.isHost) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (session.roomCode && (await providerGetRoom(session.roomCode))) {
    await providerDeleteRoom(session.roomCode);
  }

  session.roomCode = undefined;
  await session.save();

  return NextResponse.json({ ok: true });
}
