"use client";

import { useEffect, useState } from "react";
import { UserX, ThumbsDown, ThumbsUp } from "lucide-react";
import type { KickVote } from "@/lib/types";

type Props = {
  vote: KickVote;
  currentGuestId: string;
  onCast: (choice: "yes" | "no") => void;
};

export default function KickVoteToast({ vote, currentGuestId, onCast }: Props) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(id);
  }, []);

  const total = Math.max(1, vote.endsAt - vote.startedAt);
  const remaining = Math.max(0, vote.endsAt - now);
  const seconds = Math.ceil(remaining / 1000);
  const progress = Math.max(0, Math.min(1, remaining / total));
  const myVote = vote.votes[currentGuestId];
  const isTarget = currentGuestId === vote.targetId;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-[60] flex justify-center px-3">
      <div className="pointer-events-auto w-full max-w-md rounded-2xl border border-white/10 bg-slate-950/95 px-4 py-3 shadow-[0_20px_60px_rgba(0,0,0,0.6)] backdrop-blur-xl animate-fade-in-up">
        <div className="flex items-center gap-2 text-xs font-semibold text-rose-300">
          <UserX className="h-4 w-4" />
          <span className="truncate">{vote.initiatorName} wants to kick</span>
          <span className="ml-auto shrink-0 font-mono text-slate-400">{seconds}s</span>
        </div>
        <p className="mt-1 truncate text-sm font-semibold text-slate-100">
          {vote.targetName}
        </p>
        <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-white/5">
          <div
            className="h-full bg-rose-400 transition-[width] duration-200 ease-linear"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
        {isTarget ? (
          <p className="mt-3 text-center text-xs font-semibold text-slate-400">
            You can't vote on your own kick
          </p>
        ) : (
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() => onCast("yes")}
              className={`flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold transition active:scale-95 ${
                myVote === "yes"
                  ? "bg-rose-500 text-slate-950"
                  : "bg-rose-500/10 text-rose-300 hover:bg-rose-500/20"
              }`}
              aria-label="Vote to kick"
            >
              <ThumbsUp className="h-3.5 w-3.5" />
              Kick ({vote.yesCount})
            </button>
            <button
              type="button"
              onClick={() => onCast("no")}
              className={`flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold transition active:scale-95 ${
                myVote === "no"
                  ? "bg-emerald-500 text-slate-950"
                  : "bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20"
              }`}
              aria-label="Vote to keep"
            >
              <ThumbsDown className="h-3.5 w-3.5" />
              Keep ({vote.noCount})
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
