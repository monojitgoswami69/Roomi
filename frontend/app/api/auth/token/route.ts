import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { refreshAccessToken } from "@/lib/spotify";
import { backendUpdateRoomToken } from "@/lib/backend";

export async function GET() {
  const session = await getSession();
  if (!session.isHost || !session.refreshToken) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const accessToken = await refreshAccessToken(session.refreshToken);
    session.accessToken = accessToken;
    await session.save();
    if (session.roomCode) {
      await backendUpdateRoomToken(session.roomCode, accessToken).catch(() => undefined);
    }
    return NextResponse.json({ access_token: accessToken });
  } catch {
    return NextResponse.json({ error: "Failed to refresh token" }, { status: 500 });
  }
}
