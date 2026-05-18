import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { providerCreateRoom, providerGetRoom } from "@/lib/socketProvider";

export async function GET(request: Request) {
  const session = await getSession(request);

  if (!session.isHost || !session.roomCode) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let roomState = await providerGetRoom(session.roomCode, session.hostId);

  if (!roomState && session.hostId && session.accessToken && session.refreshToken) {
    const recreated = await providerCreateRoom({
      hostId: session.hostId,
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
    });
    session.roomCode = recreated.roomCode;
    await session.save();
    roomState = await providerGetRoom(recreated.roomCode, session.hostId);
  }

  if (!roomState) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }

  return NextResponse.json(roomState);
}
