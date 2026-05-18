"use client";

import { useMemo, useState } from "react";
import { ArrowBigDown, ArrowBigUp, ListMusic, Music } from "lucide-react";

type QueueTrack = {
  id: string;
  uri: string;
  title: string;
  artist: string;
  albumArt: string;
  durationMs: number;
  addedBy: string;
};

type QueueItemData = {
  track: QueueTrack;
  upvotes: number;
  downvotes: number;
  score: number;
  myVote?: "up" | "down" | null;
  voteCount?: number;
  voters?: Record<string, "up" | "down">;
};

type RenderQueueItem = QueueItemData & {
  isPlaying: boolean;
};

type QueueProps = {
  items: QueueItemData[];
  guestId: string;
  roomCode: string;
  currentTrack?: QueueTrack | null;
};

function scoreTone(score: number) {
  if (score > 0) return "text-emerald-300";
  if (score <= 0) return "text-rose-300";
  return "text-slate-400";
}

export default function Queue({ items, guestId, roomCode, currentTrack = null }: QueueProps) {
  const [pendingTrackId, setPendingTrackId] = useState<string | null>(null);

  const sortedItems = useMemo(() => items, [items]);
  const visibleItems = useMemo<RenderQueueItem[]>(() => {
    if (!currentTrack) {
      return sortedItems.map((item) => ({ ...item, isPlaying: false }));
    }

    const playingItem: RenderQueueItem = {
      track: currentTrack,
      upvotes: 0,
      downvotes: 0,
      score: 0,
      voteCount: 0,
      myVote: null,
      voters: {},
      isPlaying: true,
    };

    return [playingItem, ...sortedItems.map((item) => ({ ...item, isPlaying: false }))];
  }, [currentTrack, sortedItems]);

  const castVote = async (trackId: string, vote: "up" | "down") => {
    if (!guestId || !roomCode) return;
    setPendingTrackId(trackId);
    try {
      await fetch("/api/queue/vote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomCode, trackId, guestId, vote }),
      });
    } finally {
      setPendingTrackId(null);
    }
  };

  if (visibleItems.length === 0) {
    return (
      <div className="rounded-[28px] border border-white/8 bg-white/5 px-4 py-12 text-center backdrop-blur-xl">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-white/8 bg-white/5">
          <ListMusic className="h-6 w-6 text-slate-500" />
        </div>
        <p className="mt-4 text-sm font-semibold tracking-tight text-slate-200">
          No songs in queue
        </p>
        <p className="mt-1 text-xs text-slate-500">Start the room with something worth spinning.</p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {visibleItems.map((item, index) => {
        const currentVote = item.myVote ?? item.voters?.[guestId] ?? null;
        const isPending = pendingTrackId === item.track.id;
        const voteCount = item.voteCount ?? item.score;

        return (
          <div
            key={`${index}-${item.track.id}`}
            className={`flex items-center gap-3 px-2 py-3 ${item.isPlaying ? "rounded-2xl bg-emerald-500/[0.06]" : ""}`}
          >
            <span className="w-6 shrink-0 text-center font-mono text-[11px] text-slate-500">
              {item.isPlaying ? "Now" : currentTrack ? index : index + 1}
            </span>

            {item.track.albumArt ? (
              <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-2xl shadow-[0_12px_30px_rgba(2,6,23,0.35)]">
                <img
                  src={item.track.albumArt}
                  alt={item.track.title}
                  className={`h-full w-full object-cover ${item.isPlaying ? "brightness-[0.42]" : ""}`}
                />
                {item.isPlaying ? (
                  <div className="absolute inset-0 flex items-center justify-center bg-slate-950/15">
                    <div className="eq-bars">
                      <span className="bg-emerald-300" />
                      <span className="bg-emerald-300" />
                      <span className="bg-emerald-300" />
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-white/8 bg-slate-900/70 ${item.isPlaying ? "relative overflow-hidden" : ""}`}>
                <Music className="h-5 w-5 text-slate-500" />
                {item.isPlaying ? (
                  <div className="absolute inset-0 flex items-center justify-center bg-slate-950/35">
                    <div className="eq-bars">
                      <span className="bg-emerald-300" />
                      <span className="bg-emerald-300" />
                      <span className="bg-emerald-300" />
                    </div>
                  </div>
                ) : null}
              </div>
            )}

            <div className="min-w-0 flex-1">
              <p className={`truncate text-sm font-semibold tracking-tight ${item.isPlaying ? "text-emerald-100" : "text-slate-100"}`}>
                {item.track.title}
              </p>
              <p className={`mt-1 truncate text-xs ${item.isPlaying ? "text-emerald-200/70" : "text-slate-400"}`}>{item.track.artist}</p>
            </div>

            {item.isPlaying ? (
              <div className="flex shrink-0 items-center">
                <span className="text-[11px] font-semibold uppercase tracking-[0.24em] text-emerald-300">
                  Playing
                </span>
              </div>
            ) : (
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  aria-label="Upvote"
                  disabled={isPending}
                  onClick={() => castVote(item.track.id, "up")}
                  className={`inline-flex h-8 w-8 items-center justify-center rounded-full transition active:scale-90 ${
                    currentVote === "up"
                      ? "text-amber-300 drop-shadow-[0_0_10px_rgba(252,211,77,0.55)]"
                      : "text-slate-500 hover:text-emerald-300"
                  } disabled:opacity-50`}
                >
                  <ArrowBigUp className="h-4 w-4" />
                </button>
                <span
                  className={`min-w-[2rem] text-center font-mono text-sm font-semibold tabular-nums ${scoreTone(
                    voteCount,
                  )}`}
                >
                  {voteCount > 0 ? `+${voteCount}` : voteCount}
                </span>
                <button
                  type="button"
                  aria-label="Downvote"
                  disabled={isPending}
                  onClick={() => castVote(item.track.id, "down")}
                  className={`inline-flex h-8 w-8 items-center justify-center rounded-full transition active:scale-90 ${
                    currentVote === "down"
                      ? "text-amber-300 drop-shadow-[0_0_10px_rgba(252,211,77,0.55)]"
                      : "text-slate-500 hover:text-rose-300"
                  } disabled:opacity-50`}
                >
                  <ArrowBigDown className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
