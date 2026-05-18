"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, LoaderCircle } from "lucide-react";

function normalizeRoomCode(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
}

export default function JoinRoom() {
  const router = useRouter();
  const [roomCode, setRoomCode] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const canSubmit = useMemo(() => roomCode.length === 6 && displayName.trim().length > 0, [roomCode, displayName]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) return;
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/room/${roomCode}`);
      if (!response.ok) { setError("Room not found"); setLoading(false); return; }
      router.push(`/room/${roomCode}?name=${encodeURIComponent(displayName.trim())}`);
    } catch {
      setError("Could not join room right now");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label htmlFor="roomCode" className="text-xs font-medium text-zinc-500">
            Room Code
          </label>
          <span className="font-mono text-[11px] text-zinc-600">{roomCode.length}/6</span>
        </div>
        <input
          id="roomCode"
          value={roomCode}
          onChange={(e) => setRoomCode(normalizeRoomCode(e.target.value))}
          placeholder="ABC123"
          className="w-full rounded-xl bg-zinc-900 border border-zinc-800 px-4 py-3 font-mono text-sm tracking-[0.2em] text-white outline-none transition placeholder:tracking-[0.2em] placeholder:text-zinc-700 focus:border-green-500/40"
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="name" className="text-xs font-medium text-zinc-500">
          Your Name
        </label>
        <input
          id="name"
          value={displayName}
          maxLength={28}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="Alex"
          className="w-full rounded-xl bg-zinc-900 border border-zinc-800 px-4 py-3 text-sm text-white outline-none transition placeholder:text-zinc-700 focus:border-green-500/40"
        />
      </div>

      {error ? (
        <p className="rounded-xl bg-red-500/10 border border-red-500/10 px-3 py-2.5 text-sm text-red-400">{error}</p>
      ) : null}

      <button
        type="submit"
        disabled={!canSubmit || loading}
        className="group w-full rounded-xl bg-blue-500 px-4 py-3 text-sm font-medium text-white transition-all active:scale-[0.98] hover:bg-blue-600 disabled:opacity-40"
      >
        {loading ? (
          <span className="inline-flex items-center gap-2">
            <LoaderCircle className="h-4 w-4 animate-spin" />
            Checking...
          </span>
        ) : (
          <span className="inline-flex items-center gap-2">
            Join Room
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </span>
        )}
      </button>
    </form>
  );
}
