import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { providerGetRoom } from "@/lib/socketProvider";

export async function GET(request: Request) {
  const session = await getSession(request);

  if (!session.isHost || !session.roomCode) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const roomState = await providerGetRoom(session.roomCode, session.hostId);

  if (!roomState) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }

  return NextResponse.json(roomState);
}
