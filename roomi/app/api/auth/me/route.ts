import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";

export async function GET(request: Request) {
  const session = await getSession(request);
  const flashError = session.flashError ?? null;
  if (session.flashError) {
    session.flashError = undefined;
    await session.save();
  }

  return NextResponse.json({
    connected: Boolean(session.isHost && session.refreshToken && session.accessToken),
    accountName: session.accountName ?? "",
    hasActiveRoom: Boolean(session.roomCode),
    roomCode: session.roomCode ?? null,
    flashError,
  });
}
