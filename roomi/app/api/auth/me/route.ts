import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";

export async function GET(request: Request) {
  const session = await getSession(request);

  return NextResponse.json({
    connected: Boolean(session.isHost && session.refreshToken && session.accessToken),
    accountName: session.accountName ?? "",
    hasActiveRoom: Boolean(session.roomCode),
    roomCode: session.roomCode ?? null,
  });
}
