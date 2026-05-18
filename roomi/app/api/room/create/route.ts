import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { providerCreateRoom, providerGetRoom } from "@/lib/socketProvider";

export async function POST(request: Request) {
  const session = await getSession(request);

  if (!session.isHost) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!session.hostId || !session.accessToken || !session.refreshToken) {
    return NextResponse.json({ error: "Missing host session tokens" }, { status: 400 });
  }

  if (session.roomCode && (await providerGetRoom(session.roomCode))) {
    return NextResponse.json({ code: session.roomCode, roomCode: session.roomCode });
  }

  const room = await providerCreateRoom({
    hostId: session.hostId,
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
  });
  session.roomCode = room.roomCode;
  await session.save();

  return NextResponse.json({ code: room.roomCode, roomCode: room.roomCode });
}
