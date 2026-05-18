import { NextResponse } from "next/server";
import { providerGetRoom, providerJoinRoom } from "@/lib/socketProvider";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const roomCode = typeof body?.roomCode === "string" ? body.roomCode.trim().toUpperCase() : "";
  const guestId = typeof body?.guestId === "string" ? body.guestId.trim() : "";
  const displayName = typeof body?.displayName === "string" ? body.displayName.trim() || "Guest" : "Guest";

  if (!roomCode || !guestId) {
    return NextResponse.json({ error: "Invalid join payload" }, { status: 400 });
  }

  const room = await providerGetRoom(roomCode);
  if (!room) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }

  let status: "approved" | "pending" = "approved";
  if (guestId !== room.hostId) {
    const result = await providerJoinRoom({ roomCode: room.roomCode, guestId, displayName });
    status = result.status;
  }

  return NextResponse.json({ status, roomCode: room.roomCode });
}
