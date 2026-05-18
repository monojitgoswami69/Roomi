import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getAccessToken } from "@/lib/spotify";
import { providerCreateRoom, providerGetRoom, providerSetAccessToken } from "@/lib/socketProvider";

export async function GET(request: Request) {
  const session = await getSession(request);

  if (!session.isHost || !session.refreshToken) {
    return NextResponse.json(
      {
        error: "Forbidden",
        details: "Host session not found. Ensure you are on http://127.0.0.1:3000 and reconnect Spotify.",
      },
      { status: 403 },
    );
  }

  try {
    const accessToken = await getAccessToken(session.refreshToken);
    session.accessToken = accessToken;
    await session.save();
    if (session.roomCode) {
      const room = await providerGetRoom(session.roomCode);
      if (!room && session.hostId) {
        const recreated = await providerCreateRoom({
          hostId: session.hostId,
          accessToken,
          refreshToken: session.refreshToken,
        });
        session.roomCode = recreated.roomCode;
        await session.save();
      }
      await providerSetAccessToken(session.roomCode, accessToken).catch(() => undefined);
    }

    return NextResponse.json({ access_token: accessToken });
  } catch {
    return NextResponse.json({ error: "Failed to refresh token" }, { status: 500 });
  }
}
