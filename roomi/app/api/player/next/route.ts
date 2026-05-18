import { NextResponse } from "next/server";
import type { QueueItem } from "@/lib/roomStore";
import { playTrack } from "@/lib/spotify";
import {
  providerGetRoom,
  providerRemoveTracks,
  providerSetAccessToken,
  providerSetCurrentTrack,
} from "@/lib/socketProvider";

type NextTrackSelection = {
  selected: QueueItem | null;
  skippedTrackIds: string[];
};

function selectNextTrack(queue: QueueItem[]): NextTrackSelection {
  if (queue.length === 0) {
    return { selected: null, skippedTrackIds: [] };
  }

  const skippedTrackIds: string[] = [];
  for (const item of queue) {
    if (item.score >= 0) {
      return { selected: item, skippedTrackIds };
    }
    skippedTrackIds.push(item.track.id);
  }

  // Entire queue is negative; play least negative (top item in score-desc queue).
  return { selected: queue[0], skippedTrackIds: [] };
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const roomCode = typeof body?.roomCode === "string" ? body.roomCode.trim().toUpperCase() : "";

  if (!roomCode) {
    return NextResponse.json({ error: "roomCode is required" }, { status: 400 });
  }

  const room = await providerGetRoom(roomCode);
  if (!room) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }

  if (!room.deviceId) {
    return NextResponse.json({ error: "Player not ready. Wait for Spotify to connect in your browser." }, { status: 400 });
  }

  const { selected, skippedTrackIds } = selectNextTrack(room.queue);
  if (!selected) {
    await providerSetCurrentTrack(room.roomCode, null);
    return NextResponse.json({ currentTrack: null });
  }

  try {
    await playTrack(room.accessToken ?? "", room.deviceId, selected.track.uri, {
      refreshToken: room.refreshToken,
      onTokenRefresh: (freshToken) => providerSetAccessToken(room.roomCode, freshToken),
    });
  } catch {
    return NextResponse.json({ error: "Failed to play next track" }, { status: 500 });
  }

  await providerRemoveTracks(room.roomCode, [...skippedTrackIds, selected.track.id]);
  await providerSetCurrentTrack(room.roomCode, selected.track);

  return NextResponse.json({ currentTrack: selected.track });
}
