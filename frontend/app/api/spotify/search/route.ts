import { NextResponse } from "next/server";
import { backendGetRoomToken, backendUpdateRoomToken } from "@/lib/backend";
import {
  refreshAccessToken,
  searchTracks,
  SpotifyApiError,
} from "@/lib/spotify";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const query = typeof body?.query === "string" ? body.query.trim() : "";
  const roomCode =
    typeof body?.roomCode === "string" ? body.roomCode.trim().toUpperCase() : "";

  if (!roomCode) {
    return NextResponse.json({ error: "roomCode required" }, { status: 400 });
  }
  if (!query) {
    return NextResponse.json([]);
  }

  const limit = typeof body?.limit === "number" ? body.limit : 10;

  const tokens = await backendGetRoomToken(roomCode);
  if (!tokens) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }

  const run = async (token: string) => {
    if (limit <= 10) {
      return searchTracks(token, query, limit, 0);
    }
    // Paginate in parallel
    const pageCount = Math.min(5, Math.ceil(limit / 10)); // Cap at 5 pages (50 tracks)
    const promises = [];
    for (let i = 0; i < pageCount; i++) {
      const pageLimit = Math.min(10, limit - i * 10);
      if (pageLimit <= 0) break;
      promises.push(searchTracks(token, query, pageLimit, i * 10));
    }
    const resultsArray = await Promise.all(promises);
    return resultsArray.flat();
  };

  try {
    const tracks = await run(tokens.accessToken);
    return NextResponse.json(tracks);
  } catch (error) {
    if (error instanceof SpotifyApiError && error.status === 401 && tokens.refreshToken) {
      try {
        const fresh = await refreshAccessToken(tokens.refreshToken);
        await backendUpdateRoomToken(roomCode, fresh).catch(() => undefined);
        const tracks = await run(fresh);
        return NextResponse.json(tracks);
      } catch {
        return NextResponse.json({ error: "Search failed" }, { status: 500 });
      }
    }
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}
