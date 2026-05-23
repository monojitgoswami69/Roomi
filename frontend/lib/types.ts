/**
 * Types shared between client + server in the frontend.
 * Kept in sync (by convention) with the backend's internal types.
 */

export type Vote = "up" | "down";

export type Track = {
  id: string;
  uri: string;
  title: string;
  artist: string;
  albumArt: string;
  durationMs: number;
  addedBy: string;
};

export type QueueItem = {
  track: Track;
  upvotes: number;
  downvotes: number;
  score: number;
  voters: Record<string, Vote>;
};

export type PlaybackState = {
  isPlaying: boolean;
  startedAtTimestamp: number;
  startedAtPosition: number;
  pausedAtPosition: number;
  duration: number;
  track: Track | null;
};

export type RoomState = {
  roomCode: string;
  hostId: string;
  access: "open" | "locked";
  queue: QueueItem[];
  currentTrack: Track | null;
  playback: PlaybackState;
  guests: Record<string, string>;
  pendingGuests: Record<string, string>;
  guestCount: number;
};

export type JoinStatus = "approved" | "pending";

export type SocketAck<T = unknown> = {
  ok?: boolean;
  error?: string;
  status?: JoinStatus;
  state?: RoomState;
} & Partial<T>;
