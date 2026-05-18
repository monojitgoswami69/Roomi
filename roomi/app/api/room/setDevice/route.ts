import { NextResponse } from "next/server";
import axios from "axios";
import { getSession } from "@/lib/session";
import { activatePlayerDevice, getAccessToken } from "@/lib/spotify";
import { providerGetRoom, providerSetDevice } from "@/lib/socketProvider";

export async function POST(request: Request) {
  const session = await getSession(request);

  if (!session.isHost || !session.roomCode) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const deviceId = body?.deviceId;

  if (!deviceId || typeof deviceId !== "string") {
    return NextResponse.json({ error: "Missing deviceId" }, { status: 400 });
  }

  const room = await providerGetRoom(session.roomCode);
  if (!room) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }

  await providerSetDevice(room.roomCode, deviceId);
  try {
    await activatePlayerDevice(room.accessToken ?? "", deviceId);
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 401) {
      try {
        const accessToken = await getAccessToken(room.refreshToken ?? "");
        await activatePlayerDevice(accessToken, deviceId);
      } catch {
        return NextResponse.json({
          ok: true,
          deviceId,
          activationDeferred: true,
        });
      }
    } else {
      return NextResponse.json({
        ok: true,
        deviceId,
        activationDeferred: true,
      });
    }
  }

  return NextResponse.json({ ok: true, deviceId });
}
