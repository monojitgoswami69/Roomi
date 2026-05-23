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
  "skip-vote:start": (
    payload: Record<string, never>,
    ack?: (response: SocketAck) => void,
  ) => void;
  "skip-vote:cast": (
    payload: { vote: "yes" | "no" },
    ack?: (response: SocketAck) => void,
  ) => void;
  "kick-vote:start": (
    payload: { targetId: string },
    ack?: (response: SocketAck) => void,
  ) => void;
  "kick-vote:cast": (
    payload: { vote: "yes" | "no" },
    ack?: (response: SocketAck) => void,
  ) => void;
  "room:make-cohost": (
    payload: { guestId: string; enabled?: boolean },
    ack?: (response: SocketAck) => void,
  ) => void;
};

export type RoomiSocket = Socket;

const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL;

export function createRoomiSocket(): RoomiSocket {
  let url: string | undefined = SOCKET_URL;

  if (typeof window !== "undefined") {
    const isPageHttps = window.location.protocol === "https:";
    const pageHostname = window.location.hostname;
    
    // 1. Fallback to same-origin (undefined) if production domain is remote but socket points to localhost
    const isUrlLocal = !!(url && (url.includes("localhost") || url.includes("127.0.0.1")));
    const isPageLocal = pageHostname === "localhost" || pageHostname === "127.0.0.1";
    
    if (isUrlLocal && !isPageLocal) {
      url = undefined;
    }

    // 2. Upgrade http to https if loading from a secure page to prevent mixed content blocking
    if (isPageHttps && url && url.startsWith("http://")) {
      url = url.replace("http://", "https://");
    }
  }

  return io(url || undefined, {
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 250,
    reconnectionDelayMax: 2000,
    timeout: 10000,
  });
}
