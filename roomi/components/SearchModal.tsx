"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  LoaderCircle,
  Music,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import type { Track } from "@/lib/roomStore";

/* ───────────────────────────── Types ───────────────────────────── */

type SearchModalProps = {
  open: boolean;
  roomCode: string;
  guestId: string;
  queuedTrackIds: string[];
  currentTrackId?: string | null;
  onClose: () => void;
};

type MoodCategory = {
  id: string;
  label: string;
  emoji: string;
  color: string;       // gradient start
  colorEnd: string;    // gradient end
  queries: string[];   // curated search queries (randomly picked for variety)
};

/* ──────────────────────── Mood categories ──────────────────────── */

const MOOD_CATEGORIES: MoodCategory[] = [
  {
    id: "party",
    label: "Party",
    emoji: "🎉",
    color: "#F43F5E",
    colorEnd: "#FB923C",
    queries: ["party hits", "dance party songs", "club bangers", "party anthems 2024"],
  },
  {
    id: "chill",
    label: "Chill",
    emoji: "🌊",
    color: "#06B6D4",
    colorEnd: "#8B5CF6",
    queries: ["chill vibes", "lo-fi chill", "chill acoustic", "relaxing songs"],
  },
  {
    id: "happy",
    label: "Happy",
    emoji: "☀️",
    color: "#FBBF24",
    colorEnd: "#F97316",
    queries: ["happy songs", "feel good music", "upbeat pop", "good vibes playlist"],
  },
  {
    id: "sad",
    label: "Sad",
    emoji: "🌧️",
    color: "#6366F1",
    colorEnd: "#3B82F6",
    queries: ["sad songs", "emotional songs", "heartbreak songs", "melancholy music"],
  },
  {
    id: "hiphop",
    label: "Hip-Hop",
    emoji: "🔥",
    color: "#EF4444",
    colorEnd: "#DC2626",
    queries: ["hip hop hits", "rap songs", "hip hop bangers", "top rap"],
  },
  {
    id: "romantic",
    label: "Romance",
    emoji: "💖",
    color: "#EC4899",
    colorEnd: "#F472B6",
    queries: ["romantic songs", "love songs", "r&b love", "slow dance songs"],
  },
  {
    id: "workout",
    label: "Workout",
    emoji: "💪",
    color: "#10B981",
    colorEnd: "#34D399",
    queries: ["workout music", "gym motivation", "high energy workout", "running songs"],
  },
  {
    id: "indie",
    label: "Indie",
    emoji: "🎸",
    color: "#A78BFA",
    colorEnd: "#C084FC",
    queries: ["indie hits", "indie pop", "alternative indie", "indie rock"],
  },
  {
    id: "bollywood",
    label: "Bollywood",
    emoji: "🇮🇳",
    color: "#F59E0B",
    colorEnd: "#EF4444",
    queries: ["bollywood hits", "bollywood party songs", "latest bollywood", "bollywood dance"],
  },
];

/* ────────────────────────── Helpers ────────────────────────── */

function formatDuration(ms: number): string {
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/* ──────────────────── Track Card Component ──────────────────── */

function TrackCard({
  track,
  queued,
  selected,
  onToggle,
}: {
  track: Track;
  queued: boolean;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      disabled={queued}
      onClick={onToggle}
      className={`group flex w-full items-center gap-3 rounded-2xl border px-3 py-2.5 text-left transition-all duration-200 ${
        selected
          ? "border-emerald-400/30 bg-emerald-500/[0.08] shadow-[0_0_24px_rgba(16,185,129,0.08)]"
          : "border-white/[0.06] bg-white/[0.03] hover:border-white/[0.12] hover:bg-white/[0.06]"
      } disabled:cursor-not-allowed disabled:opacity-40`}
    >
      {track.albumArt ? (
        <img
          src={track.albumArt}
          alt={track.title}
          className="h-12 w-12 shrink-0 rounded-xl object-cover shadow-[0_4px_12px_rgba(0,0,0,0.4)]"
        />
      ) : (
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-white/[0.06] bg-slate-900/60">
          <Music className="h-4 w-4 text-slate-600" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-semibold tracking-tight text-slate-100">
          {track.title}
        </p>
        <p className="mt-0.5 truncate text-[11px] text-slate-500">{track.artist}</p>
      </div>
      <div className="shrink-0 text-right">
        <p className="font-mono text-[10px] text-slate-600">{formatDuration(track.durationMs)}</p>
        {queued ? (
          <p className="mt-0.5 text-[10px] font-semibold text-slate-600">In queue</p>
        ) : selected ? (
          <div className="mt-0.5 flex items-center justify-end gap-1">
            <CheckCircle2 className="h-3 w-3 text-emerald-400" />
            <span className="text-[10px] font-semibold text-emerald-400">Added</span>
          </div>
        ) : (
          <p className="mt-0.5 text-[10px] font-medium text-slate-500 opacity-0 transition group-hover:opacity-100">
            + Add
          </p>
        )}
      </div>
    </button>
  );
}

/* ═══════════════════════ Main Component ═══════════════════════ */

export default function SearchModal({
  open,
  roomCode,
  guestId,
  queuedTrackIds,
  currentTrackId,
  onClose,
}: SearchModalProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Track[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedTracks, setSelectedTracks] = useState<Track[]>([]);
  const [confirming, setConfirming] = useState(false);

  // Mood browsing state
  const [activeMood, setActiveMood] = useState<string | null>(null);
  const [moodTracks, setMoodTracks] = useState<Track[]>([]);
  const [moodLoading, setMoodLoading] = useState(false);
  const [initialLoaded, setInitialLoaded] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);

  const blockedTrackIds = useMemo(() => {
    const ids = new Set(queuedTrackIds);
    if (currentTrackId) ids.add(currentTrackId);
    return ids;
  }, [currentTrackId, queuedTrackIds]);

  const selectedIds = useMemo(
    () => new Set(selectedTracks.map((track) => track.id)),
    [selectedTracks],
  );

  const handleClose = () => {
    setQuery("");
    setResults([]);
    setLoading(false);
    setError("");
    setSelectedTracks([]);
    setConfirming(false);
    setActiveMood(null);
    setMoodTracks([]);
    setInitialLoaded(false);
    onClose();
  };

  /* ── Focus input on open ── */
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  /* ── Load "Party" mood by default on first open ── */
  useEffect(() => {
    if (open && !initialLoaded && roomCode) {
      const timeoutId = window.setTimeout(() => {
        setInitialLoaded(true);
        setActiveMood("party");
      }, 0);
      return () => window.clearTimeout(timeoutId);
    }
  }, [open, initialLoaded, roomCode]);

  /* ── Fetch mood suggestions via search ── */
  const fetchMoodTracks = useCallback(
    async (moodId: string) => {
      if (!roomCode) return;
      const mood = MOOD_CATEGORIES.find((c) => c.id === moodId);
      if (!mood) return;

      // Pick a random query from the mood's curated list for variety
      const searchQuery = mood.queries[Math.floor(Math.random() * mood.queries.length)];

      setMoodLoading(true);
      setError("");
      try {
        const response = await fetch("/api/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: searchQuery, roomCode }),
        });
        const payload = await response.json();
        if (!response.ok) {
          setError(payload?.error ?? "Could not load suggestions");
          setMoodTracks([]);
        } else {
          setMoodTracks(Array.isArray(payload) ? payload : []);
        }
      } catch {
        setError("Could not load suggestions");
        setMoodTracks([]);
      } finally {
        setMoodLoading(false);
      }
    },
    [roomCode],
  );

  useEffect(() => {
    if (activeMood && !query.trim()) {
      const timeoutId = window.setTimeout(() => {
        fetchMoodTracks(activeMood);
      }, 0);
      return () => window.clearTimeout(timeoutId);
    }
  }, [activeMood, fetchMoodTracks, query]);

  /* ── Search debounce ── */
  useEffect(() => {
    let cancelled = false;
    const timeoutId = window.setTimeout(async () => {
      if (!open || !query.trim()) {
        setResults([]);
        return;
      }
      setLoading(true);
      setError("");
      try {
        const response = await fetch("/api/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: query.trim(), roomCode }),
        });
        const payload = await response.json();
        if (cancelled) return;
        if (!response.ok) {
          setError(payload?.error ?? "Search failed");
          setResults([]);
          return;
        }
        setResults(Array.isArray(payload) ? payload : []);
      } catch {
        if (!cancelled) {
          setError("Search failed");
          setResults([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 280);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [open, query, roomCode]);

  /* ── Track selection ── */
  const toggleSelection = (track: Track) => {
    if (blockedTrackIds.has(track.id)) return;
    setSelectedTracks((current) => {
      if (current.some((item) => item.id === track.id)) {
        return current.filter((item) => item.id !== track.id);
      }
      return [...current, track];
    });
  };

  const confirmSelection = async () => {
    if (!selectedTracks.length || !guestId) return;
    setConfirming(true);
    setError("");

    try {
      const tracksToAdd = selectedTracks.filter((track) => !blockedTrackIds.has(track.id));
      let addedCount = 0;
      let failedCount = 0;

      for (const track of tracksToAdd) {
        const response = await fetch("/api/queue/add", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ roomCode, guestId, track }),
        });
        if (response.ok) {
          addedCount += 1;
        } else {
          failedCount += 1;
        }
      }

      if (addedCount > 0) {
        handleClose();
        return;
      }

      if (tracksToAdd.length === 0) {
        setError("Selected tracks are already in queue or currently playing");
      } else if (failedCount > 0) {
        setError("Could not add selected songs");
      }
      setConfirming(false);
    } catch {
      setError("Could not add selected songs");
      setConfirming(false);
    }
  };

  /* ── Determine which tracks to display ── */
  const isSearching = query.trim().length > 0;
  const displayTracks = isSearching ? results : moodTracks;
  const isLoadingTracks = isSearching ? loading : moodLoading;
  const activeMoodData = MOOD_CATEGORIES.find((c) => c.id === activeMood);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-[rgba(2,6,23,0.82)] backdrop-blur-2xl animate-fade-in">
      <div className="mx-auto flex h-full w-full max-w-6xl items-center px-4 py-6 sm:px-6">
        <div className="grid h-full w-full gap-0 overflow-hidden rounded-[32px] border border-white/[0.08] bg-[linear-gradient(145deg,rgba(7,18,46,0.96),rgba(3,8,22,0.98))] shadow-[0_40px_120px_rgba(0,0,0,0.65)] md:grid-cols-[minmax(0,1.35fr)_300px]">

          {/* ─── Left panel: Browse + Search ─── */}
          <div className="flex min-h-0 flex-col">
            {/* Header + search bar */}
            <div className="border-b border-white/[0.06] px-5 pb-4 pt-5 sm:px-7 sm:pt-7">
              <div className="mb-5 flex items-center justify-between gap-4">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-sky-200/50">
                    Add To Queue
                  </p>
                  <h2 className="mt-1.5 text-xl font-semibold tracking-tight text-slate-50 sm:text-2xl">
                    Browse &amp; discover
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={handleClose}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.04] text-slate-500 transition hover:bg-white/[0.08] hover:text-white"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Search input — clean, no blue outline */}
              <div className="flex items-center gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.03] px-4 py-3 transition-colors focus-within:border-white/[0.12] focus-within:bg-white/[0.05]">
                <Search className="h-4 w-4 shrink-0 text-slate-500" />
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    if (!e.target.value.trim()) {
                      setResults([]);
                      setError("");
                      setLoading(false);
                    }
                  }}
                  placeholder="Search songs, artists..."
                  className="w-full bg-transparent text-sm text-slate-100 outline-none placeholder:text-slate-600"
                  style={{ caretColor: "#94a3b8" }}
                />
                {query ? (
                  <button
                    type="button"
                    onClick={() => {
                      setQuery("");
                      setResults([]);
                      setError("");
                    }}
                    className="rounded-lg p-1 text-slate-600 transition hover:bg-white/[0.06] hover:text-slate-300"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </div>

              {/* Mood pills — shown when NOT actively searching */}
              {!isSearching ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  {MOOD_CATEGORIES.map((mood) => {
                    const isActive = activeMood === mood.id;
                    return (
                      <button
                        key={mood.id}
                        type="button"
                        onClick={() => setActiveMood(mood.id)}
                        className="relative inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12px] font-semibold transition-all duration-200"
                        style={{
                          background: isActive
                            ? `linear-gradient(135deg, ${mood.color}22, ${mood.colorEnd}18)`
                            : "rgba(255,255,255,0.03)",
                          border: isActive
                            ? `1px solid ${mood.color}55`
                            : "1px solid rgba(255,255,255,0.06)",
                          color: isActive ? mood.color : "#94a3b8",
                          boxShadow: isActive ? `0 0 20px ${mood.color}15` : "none",
                        }}
                      >
                        <span className="text-sm">{mood.emoji}</span>
                        {mood.label}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>

            {/* Track listing */}
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-7">
              {error ? (
                <p className="mb-4 rounded-2xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
                  {error}
                </p>
              ) : null}

              {isLoadingTracks ? (
                <div className="flex h-full items-center justify-center">
                  <div className="flex flex-col items-center gap-3">
                    <LoaderCircle className="h-5 w-5 animate-spin text-slate-500" />
                    <p className="text-xs text-slate-600">
                      {isSearching ? "Searching..." : "Loading suggestions..."}
                    </p>
                  </div>
                </div>
              ) : displayTracks.length === 0 && isSearching ? (
                <div className="flex h-full flex-col items-center justify-center text-center">
                  <Search className="h-5 w-5 text-slate-700" />
                  <p className="mt-3 text-sm text-slate-500">
                    No results for &ldquo;{query}&rdquo;
                  </p>
                </div>
              ) : displayTracks.length === 0 && !isSearching && activeMood ? (
                <div className="flex h-full flex-col items-center justify-center text-center">
                  <Sparkles className="h-5 w-5 text-slate-700" />
                  <p className="mt-3 text-sm text-slate-500">
                    No suggestions available right now.
                  </p>
                </div>
              ) : displayTracks.length > 0 ? (
                <div>
                  {!isSearching && activeMoodData ? (
                    <div className="mb-3 flex items-center gap-2">
                      <span className="text-base">{activeMoodData.emoji}</span>
                      <p
                        className="text-[11px] font-bold uppercase tracking-[0.2em]"
                        style={{ color: activeMoodData.color }}
                      >
                        {activeMoodData.label} vibes
                      </p>
                      <button
                        type="button"
                        onClick={() => activeMood && fetchMoodTracks(activeMood)}
                        className="ml-auto rounded-lg border border-white/[0.06] bg-white/[0.03] px-2.5 py-1 text-[10px] font-semibold text-slate-500 transition hover:bg-white/[0.06] hover:text-slate-300"
                      >
                        Refresh
                      </button>
                    </div>
                  ) : null}
                  <div className="space-y-1.5">
                    {displayTracks.map((track) => (
                      <TrackCard
                        key={track.id}
                        track={track}
                        queued={blockedTrackIds.has(track.id)}
                        selected={selectedIds.has(track.id)}
                        onToggle={() => toggleSelection(track)}
                      />
                    ))}
                  </div>
                </div>
              ) : (
                <div className="flex h-full flex-col items-center justify-center text-center">
                  <Sparkles className="h-5 w-5 text-slate-700" />
                  <p className="mt-3 text-sm text-slate-500">
                    Pick a mood or search for songs
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* ─── Right panel: Selection cart ─── */}
          <aside className="flex min-h-0 flex-col border-t border-white/[0.06] bg-white/[0.015] p-5 md:border-l md:border-t-0">
            <div className="mb-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-600">
                Your picks
              </p>
              <h3 className="mt-1.5 text-lg font-semibold tracking-tight text-slate-100">
                {selectedTracks.length}{" "}
                <span className="text-slate-500 font-normal text-base">
                  {selectedTracks.length === 1 ? "song" : "songs"}
                </span>
              </h3>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {selectedTracks.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center rounded-2xl border border-dashed border-white/[0.06] bg-white/[0.015] px-4 text-center">
                  <div className="h-10 w-10 rounded-xl border border-white/[0.06] bg-white/[0.03] flex items-center justify-center">
                    <Music className="h-4 w-4 text-slate-700" />
                  </div>
                  <p className="mt-3 text-xs text-slate-600 leading-relaxed">
                    Tap songs to stage them
                    <br />
                    before adding to queue.
                  </p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {selectedTracks.map((track, idx) => (
                    <div
                      key={track.id}
                      className="flex items-center gap-2.5 rounded-xl border border-white/[0.06] bg-white/[0.03] px-2.5 py-2 transition hover:bg-white/[0.05]"
                    >
                      <span className="w-4 text-center font-mono text-[10px] text-slate-700">
                        {idx + 1}
                      </span>
                      {track.albumArt ? (
                        <img
                          src={track.albumArt}
                          alt={track.title}
                          className="h-9 w-9 shrink-0 rounded-lg object-cover"
                        />
                      ) : (
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-900/60">
                          <Music className="h-3 w-3 text-slate-600" />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[12px] font-semibold text-slate-200">
                          {track.title}
                        </p>
                        <p className="truncate text-[10px] text-slate-600">{track.artist}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => toggleSelection(track)}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-slate-600 transition hover:bg-rose-500/10 hover:text-rose-400"
                        aria-label={`Remove ${track.title}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="mt-4">
              <button
                type="button"
                onClick={confirmSelection}
                disabled={!selectedTracks.length || confirming}
                className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-4 text-sm font-semibold text-slate-950 shadow-[0_16px_36px_rgba(16,185,129,0.25)] transition-all hover:bg-emerald-400 hover:shadow-[0_16px_44px_rgba(16,185,129,0.35)] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
              >
                {confirming ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-4 w-4" />
                )}
                {confirming
                  ? "Adding..."
                  : selectedTracks.length
                    ? `Add ${selectedTracks.length} to queue`
                    : "Select songs first"}
              </button>
            </div>
          </aside>

        </div>
      </div>
    </div>
  );
}
