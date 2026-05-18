import axios from "axios";
import { NextResponse } from "next/server";
import { getAccessToken, searchTracks } from "@/lib/spotify";
import { providerGetRoom } from "@/lib/socketProvider";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const query = typeof body?.query === "string" ? body.query.trim() : "";
  const roomCode = typeof body?.roomCode === "string" ? body.roomCode.trim().toUpperCase() : "";

  if (!roomCode) {
    return NextResponse.json({ error: "roomCode is required" }, { status: 400 });
  }

  if (!query) {
    return NextResponse.json([]);
  }

  const room = await providerGetRoom(roomCode);
  if (!room) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }

  try {
    const tracks = await searchTracks(room.accessToken ?? "", query);
    return NextResponse.json(tracks);
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 401) {
      try {
        const freshToken = await getAccessToken(room.refreshToken ?? "");
        const tracks = await searchTracks(freshToken, query);
        return NextResponse.json(tracks);
      } catch {
        return NextResponse.json({ error: "Search failed, try again" }, { status: 500 });
      }
    }

    return NextResponse.json({ error: "Search failed, try again" }, { status: 500 });
  }
}
