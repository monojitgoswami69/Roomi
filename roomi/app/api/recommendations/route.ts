import axios from "axios";
import { NextResponse } from "next/server";
import { getAccessToken, getRecommendations } from "@/lib/spotify";
import { providerGetRoom, providerSetAccessToken } from "@/lib/socketProvider";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const roomCode = typeof body?.roomCode === "string" ? body.roomCode.trim().toUpperCase() : "";
  const seedGenres: string[] = Array.isArray(body?.seedGenres) ? body.seedGenres : [];
  const targetFeatures: Record<string, number> =
    typeof body?.targetFeatures === "object" && body.targetFeatures ? body.targetFeatures : {};
  const limit = typeof body?.limit === "number" ? body.limit : 12;

  if (!roomCode) {
    return NextResponse.json({ error: "roomCode is required" }, { status: 400 });
  }

  if (seedGenres.length === 0) {
    return NextResponse.json([]);
  }

  const room = await providerGetRoom(roomCode);
  if (!room) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }

  try {
    const tracks = await getRecommendations(room.accessToken ?? "", seedGenres, targetFeatures, limit);
    return NextResponse.json(tracks);
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 401) {
      try {
        const freshToken = await getAccessToken(room.refreshToken ?? "");
        await providerSetAccessToken(room.roomCode, freshToken);
        const tracks = await getRecommendations(freshToken, seedGenres, targetFeatures, limit);
        return NextResponse.json(tracks);
      } catch {
        return NextResponse.json({ error: "Failed to get recommendations" }, { status: 500 });
      }
    }

    return NextResponse.json({ error: "Failed to get recommendations" }, { status: 500 });
  }
}
