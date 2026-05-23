"use client";

import { io, type Socket } from "socket.io-client";
import type {
  JoinStatus,
  PlaybackState,
  RoomState,
  SocketAck,
  Track,
  Vote,
} from "@/lib/types";

/** Client → Server event payloads. */
export type ClientEvents = {
  "room:join": (
    payload: { roomCode: string; guestId: string; displayName?: string; asHost?: boolean },
    ack?: (response: SocketAck<{ status: JoinStatus; state: RoomState }>) => void,
  ) => void;
  "room:sync": (
    payload: Record<string, never>,
    ack?: (response: SocketAck<{ state: RoomState }>) => void,
  ) => void;
  "room:ping": (
    payload: Record<string, never>,
    ack?: (response: SocketAck) => void,
  ) => void;
  "room:set-access": (
    payload: { access: "open" | "locked" },
    ack?: (response: SocketAck) => void,
  ) => void;
  "room:moderate-guest": (
    payload: { guestId: string; intent: "approve-guest" | "reject-guest" | "kick-guest" },
    ack?: (response: SocketAck) => void,
  ) => void;
  "room:set-device": (
    payload: { deviceId: string },
    ack?: (response: SocketAck) => void,
  ) => void;
  "room:set-token": (
    payload: { accessToken: string },
    ack?: (response: SocketAck) => void,
  ) => void;
  "room:end": (
    payload: Record<string, never>,
    ack?: (response: SocketAck) => void,
  ) => void;
  "queue:add": (
    payload: { track: Track },
    ack?: (response: SocketAck<{ autoPlayTrack: Track | null; state: RoomState }>) => void,
  ) => void;
  "queue:add-batch": (
    payload: { tracks: Track[] },
    ack?: (response: SocketAck<{ addedCount: number; autoPlayTrack: Track | null; state: RoomState }>) => void,
  ) => void;
  "queue:vote": (
    payload: { trackId: string; vote: Vote },
    ack?: (response: SocketAck<{ state: RoomState }>) => void,
  ) => void;
  "queue:remove": (
    payload: { trackIds: string[] },
    ack?: (response: SocketAck) => void,
  ) => void;
  "playback:next": (
    payload: Record<string, never>,
    ack?: (response: SocketAck<{ currentTrack: Track | null; playback: PlaybackState }>) => void,
  ) => void;
  "playback:state": (
    payload: { playback: PlaybackState },
    ack?: (response: SocketAck) => void,
  ) => void;
};

export type RoomiSocket = Socket;

const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL;

export function createRoomiSocket(): RoomiSocket {
  return io(SOCKET_URL || undefined, {
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 250,
    reconnectionDelayMax: 2000,
    timeout: 10000,
  });
}
