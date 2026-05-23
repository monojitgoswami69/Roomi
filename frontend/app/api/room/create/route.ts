import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { backendCreateRoom, backendDeleteRoom } from "@/lib/backend";

export async function POST() {
  const session = await getSession();
  if (!session.isHost) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!session.hostId || !session.accessToken || !session.refreshToken) {
    return NextResponse.json({ error: "Missing host session tokens" }, { status: 400 });
  }

  // Tear down any prior room owned by this session.
  if (session.roomCode) {
    await backendDeleteRoom(session.roomCode).catch(() => undefined);
  }

  const room = await backendCreateRoom({
    hostId: session.hostId,
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
  });
  session.roomCode = room.roomCode;
  await session.save();
  return NextResponse.json({ roomCode: room.roomCode });
}
