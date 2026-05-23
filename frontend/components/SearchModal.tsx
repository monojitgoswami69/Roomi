"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  LoaderCircle,
  Music,
  Plus,
  RotateCw,
  Search,
  X,
} from "lucide-react";
import type { Track } from "@/lib/types";
import type { RoomiSocket } from "@/lib/socket";

type SearchModalProps = {
  open: boolean;
  roomCode: string;
  socket: RoomiSocket | null;
  queuedTrackIds: string[];
  currentTrackId?: string | null;
  onClose: () => void;
};

type MoodCategory = {
  id: string;
  label: string;
  emoji: string;
  color: string;
  colorEnd: string;
  queries: string[];
};

const MOOD_CATEGORIES: MoodCategory[] = [
  { id: "party", label: "Party", emoji: "🎉", color: "#F43F5E", colorEnd: "#FB923C",
    queries: ["party hits", "dance party songs", "club bangers", "party anthems 2024"] },
  { id: "chill", label: "Chill", emoji: "🌊", color: "#06B6D4", colorEnd: "#8B5CF6",
    queries: ["chill vibes", "lo-fi chill", "chill acoustic", "relaxing songs"] },
  { id: "happy", label: "Happy", emoji: "☀️", color: "#FBBF24", colorEnd: "#F97316",
    queries: ["happy songs", "feel good music", "upbeat pop", "good vibes playlist"] },
  { id: "hiphop", label: "Hip-Hop", emoji: "🔥", color: "#EF4444", colorEnd: "#DC2626",
    queries: ["hip hop hits", "rap songs", "hip hop bangers", "top rap"] },
  { id: "romantic", label: "Romance", emoji: "💖", color: "#EC4899", colorEnd: "#F472B6",
    queries: ["romantic songs", "love songs", "r&b love", "slow dance songs"] },
  { id: "workout", label: "Workout", emoji: "💪", color: "#10B981", colorEnd: "#34D399",
    queries: ["workout music", "gym motivation", "high energy workout", "running songs"] },
  { id: "indie", label: "Indie", emoji: "🎸", color: "#A78BFA", colorEnd: "#C084FC",
    queries: ["indie hits", "indie pop", "alternative indie", "indie rock"] },
  { id: "bollywood", label: "Bollywood", emoji: "🇮🇳", color: "#F59E0B", colorEnd: "#EF4444",
    queries: ["bollywood hits", "bollywood party songs", "latest bollywood", "bollywood dance"] },
];

function formatDuration(ms: number): string {
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

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
      className={`group flex w-full items-center gap-4 px-4 py-3.5 text-left border-b transition-all duration-200 outline-none ${
        selected
          ? "bg-emerald-500/[0.06] rounded-2xl border-transparent"
          : "border-white/[0.03] hover:bg-white/[0.03] hover:rounded-2xl hover:border-transparent hover:-translate-y-[0.5px]"
      } disabled:cursor-not-allowed disabled:opacity-30`}
    >
      {track.albumArt ? (
        <img
          src={track.albumArt}
          alt={track.title}
          className="h-14 w-14 shrink-0 rounded-xl object-cover border border-white/10 shadow-sm"
        />
      ) : (
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-slate-900/60">
          <Music className="h-6 w-6 text-slate-500" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-base font-bold text-white tracking-tight">
          {track.title}
        </p>
        <p className="mt-1 truncate text-sm text-slate-400 font-medium">{track.artist}</p>
      </div>
      <div className="shrink-0 text-right">
        <p className="font-mono text-xs text-slate-450 font-medium">{formatDuration(track.durationMs)}</p>
        {queued ? (
          <p className="mt-1 text-xs font-bold text-slate-500">In queue</p>
        ) : selected ? (
          <div className="mt-1 flex items-center justify-end gap-1">
            <CheckCircle2 className="h-4 w-4 text-emerald-450 fill-emerald-500/10" />
            <span className="text-xs font-bold text-emerald-450">Staged</span>
          </div>
        ) : (
          <p className="mt-1 text-xs font-bold text-slate-300 opacity-0 transition group-hover:opacity-100">
            + Add
          </p>
        )}
      </div>
    </button>
  );
}

export default function SearchModal({
  open,
  roomCode,
  socket,
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
  const [activeMood, setActiveMood] = useState<string | null>(null);
  const [moodTracks, setMoodTracks] = useState<Track[]>([]);
  const [moodLoading, setMoodLoading] = useState(false);
  const [homeTracks, setHomeTracks] = useState<Track[]>([]);
  const [homeLoading, setHomeLoading] = useState(false);
  const [initialLoaded, setInitialLoaded] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const [shouldRender, setShouldRender] = useState(open);
  const [isClosing, setIsClosing] = useState(false);

  useEffect(() => {
    if (open) {
      setShouldRender(true);
      setIsClosing(false);
    } else if (shouldRender) {
      setIsClosing(true);
      const timer = setTimeout(() => {
        setShouldRender(false);
        setIsClosing(false);
      }, 250);
      return () => clearTimeout(timer);
    }
  }, [open, shouldRender]);

  const blockedTrackIds = useMemo(() => {
    const ids = new Set(queuedTrackIds);
    if (currentTrackId) ids.add(currentTrackId);
    return ids;
  }, [currentTrackId, queuedTrackIds]);

  const selectedIds = useMemo(
    () => new Set(selectedTracks.map((t) => t.id)),
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
    setHomeTracks([]);
    setInitialLoaded(false);
    onClose();
  };

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 100);
  }, [open]);

  const fetchHomeTracks = useCallback(async () => {
    if (!roomCode) return;
    setHomeLoading(true);
    setError("");
    const genericQueries = [
      "top hits", "viral", "synthwave", "acoustic chill", "lo-fi beats",
      "hip hop", "dance hits", "indie", "r&b", "pop classics", "chill vibes"
    ];
    const q1 = genericQueries[Math.floor(Math.random() * genericQueries.length)];
    let q2 = genericQueries[Math.floor(Math.random() * genericQueries.length)];
    if (q1 === q2) {
      q2 = genericQueries[(genericQueries.indexOf(q1) + 1) % genericQueries.length];
    }
    
    try {
      const [res1, res2] = await Promise.all([
        fetch("/api/spotify/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: q1, roomCode, limit: 25 }),
        }),
        fetch("/api/spotify/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: q2, roomCode, limit: 25 }),
        })
      ]);
      const [payload1, payload2] = await Promise.all([
        res1.ok ? res1.json() : Promise.resolve([]),
        res2.ok ? res2.json() : Promise.resolve([])
      ]);
      
      const tracks1 = Array.isArray(payload1) ? payload1 : [];
      const tracks2 = Array.isArray(payload2) ? payload2 : [];
      
      const merged = [...tracks1, ...tracks2];
      const seen = new Set<string>();
      const deduped: Track[] = [];
      for (const track of merged) {
        if (!seen.has(track.id)) {
          seen.add(track.id);
          deduped.push(track);
        }
      }
      
      const shuffled = deduped.sort(() => Math.random() - 0.5);
      setHomeTracks(shuffled.slice(0, 50));
    } catch {
      setError("Could not load suggestions");
      setHomeTracks([]);
    } finally {
      setHomeLoading(false);
    }
  }, [roomCode]);

  useEffect(() => {
    if (open && !initialLoaded && roomCode) {
      const id = window.setTimeout(() => {
        setInitialLoaded(true);
        fetchHomeTracks();
      }, 0);
      return () => window.clearTimeout(id);
    }
  }, [open, initialLoaded, roomCode, fetchHomeTracks]);

  const fetchMoodTracks = useCallback(
    async (moodId: string) => {
      if (!roomCode) return;
      const mood = MOOD_CATEGORIES.find((c) => c.id === moodId);
      if (!mood) return;
      const searchQuery = mood.queries[Math.floor(Math.random() * mood.queries.length)];
      setMoodLoading(true);
      setError("");
      try {
        const res = await fetch("/api/spotify/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: searchQuery, roomCode, limit: 50 }),
        });
        const payload = await res.json();
        if (!res.ok) {
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
      const id = window.setTimeout(() => fetchMoodTracks(activeMood), 0);
      return () => window.clearTimeout(id);
    }
  }, [activeMood, fetchMoodTracks, query]);

  useEffect(() => {
    let cancelled = false;
    const id = window.setTimeout(async () => {
      if (!open || !query.trim()) {
        setResults([]);
        return;
      }
      setLoading(true);
      setError("");
      try {
        const res = await fetch("/api/spotify/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: query.trim(), roomCode, limit: 50 }),
        });
        const payload = await res.json();
        if (cancelled) return;
        if (!res.ok) {
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
      window.clearTimeout(id);
    };
  }, [open, query, roomCode]);

  const toggleSelection = (track: Track) => {
    if (blockedTrackIds.has(track.id)) return;
    setSelectedTracks((current) => {
      if (current.some((t) => t.id === track.id)) {
        return current.filter((t) => t.id !== track.id);
      }
      return [...current, track];
    });
  };

  const confirmSelection = () => {
    if (!selectedTracks.length || !socket) return;
    const tracksToAdd = selectedTracks.filter((t) => !blockedTrackIds.has(t.id));
    if (tracksToAdd.length === 0) {
      setError("Selected tracks are already in queue or currently playing");
      return;
    }
    setConfirming(true);
    setError("");
    socket.emit("queue:add-batch", { tracks: tracksToAdd }, (ack: { error?: string }) => {
      setConfirming(false);
      if (ack?.error) {
        setError(ack.error);
        return;
      }
      handleClose();
    });
  };

  const isSearching = query.trim().length > 0;
  const rawDisplayTracks = isSearching ? results : moodTracks;
  const displayTracks = rawDisplayTracks.filter((track, idx, arr) => arr.findIndex((t) => t.id === track.id) === idx);
  const isLoadingTracks = isSearching ? loading : moodLoading;
  const activeMoodData = MOOD_CATEGORIES.find((c) => c.id === activeMood);

  if (!shouldRender) return null;

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 md:p-10 ${
        isClosing ? "animate-backdrop-exit" : "animate-backdrop-enter"
      }`}
      onClick={handleClose}
    >
      <div
        className={`relative grid h-[92vh] sm:h-[88vh] max-h-[840px] w-full max-w-[94vw] lg:max-w-[80vw] gap-0 overflow-hidden rounded-[24px] sm:rounded-[28px] border-2 border-slate-700/80 bg-gradient-to-b from-[#111827] to-[#0a0f1a] shadow-[0_30px_70px_-10px_rgba(0,0,0,0.98),0_0_50px_rgba(56,189,248,0.06)] grid-rows-[minmax(0,1fr)_auto] md:grid-rows-none md:grid-cols-[minmax(0,1.35fr)_360px] ${
          isClosing ? "animate-modal-exit" : "animate-modal-enter"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex min-h-0 min-w-0 flex-col">
          <div className="px-4 pb-3 pt-4 sm:px-8 sm:pb-4 sm:pt-5">
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="flex flex-1 items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 sm:px-4 py-2.5 sm:py-3 transition-all focus-within:border-white/20 focus-within:bg-white/[0.05]">
                <Search className="h-5 w-5 shrink-0 text-slate-400" />
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
                  className="w-full min-w-0 border-none bg-transparent text-base text-white outline-none ring-0 focus:border-none focus:outline-none focus:ring-0 placeholder:text-slate-450 search-input-no-ring"
                  style={{ caretColor: "#64748b" }}
                />
                {query ? (
                  <button
                    type="button"
                    onClick={() => {
                      setQuery("");
                      setResults([]);
                      setError("");
                    }}
                    className="rounded-lg p-1.5 text-slate-500 transition hover:bg-white/[0.06] hover:text-slate-350"
                  >
                    <X className="h-4 w-4" />
                  </button>
                ) : null}
              </div>
              <button
                type="button"
                onClick={handleClose}
                className="md:hidden inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.02] text-slate-400 transition-all hover:bg-white/[0.08] hover:text-white active:scale-95"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>

          <div
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain no-scrollbar px-4 py-3 sm:px-8"
          >
            {error ? (
              <p className="mb-4 rounded-xl border border-rose-500/10 bg-rose-500/5 px-4 py-2.5 text-sm text-rose-350">
                {error}
              </p>
            ) : null}

            {isLoadingTracks ? (
              <div className="flex h-full items-center justify-center">
                <div className="flex flex-col items-center gap-3">
                  <LoaderCircle className="h-7 w-7 animate-spin text-slate-500" />
                  <p className="text-base text-slate-400">
                    {isSearching ? "Searching..." : "Loading suggestions..."}
                  </p>
                </div>
              </div>
            ) : !isSearching ? (
              /* Home / Browse & Category state */
              activeMood === null ? (
                /* Home Browse Page */
                <div className="space-y-8">
                  <div>
                    <div className="grid grid-cols-2 gap-2.5 sm:gap-3.5 sm:grid-cols-3 lg:grid-cols-4">
                      {MOOD_CATEGORIES.map((mood) => (
                        <button
                          key={mood.id}
                          type="button"
                          onClick={() => setActiveMood(mood.id)}
                          className="h-20 sm:h-24 rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4 sm:p-5 text-left overflow-hidden relative group hover:bg-white/[0.04] hover:border-white/15 transition-all duration-300"
                        >
                          <span className="text-base sm:text-lg font-extrabold text-white block tracking-tight">
                            {mood.label}
                          </span>
                          <span className="text-3xl sm:text-4xl absolute -right-1 -bottom-1.5 rotate-[20deg] opacity-35 scale-100 group-hover:scale-110 group-hover:rotate-[12deg] transition-all duration-300 select-none">
                            {mood.emoji}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="mb-4 flex items-center gap-2">
                      <h3 className="text-sm font-bold uppercase tracking-wider text-slate-400">
                        Suggested for you
                      </h3>
                      {homeLoading ? (
                        <LoaderCircle className="h-5 w-5 animate-spin text-slate-500 ml-2" />
                      ) : (
                        <button
                          type="button"
                          onClick={fetchHomeTracks}
                          className="ml-auto rounded-full border border-white/10 bg-white/[0.03] p-2 text-slate-400 hover:text-white hover:bg-white/10 transition-all duration-200 active:scale-95"
                          aria-label="Refresh Suggestions"
                        >
                          <RotateCw className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                    {homeLoading ? (
                      <div className="flex h-32 items-center justify-center">
                        <LoaderCircle className="h-6 w-6 animate-spin text-slate-650" />
                      </div>
                    ) : homeTracks.length > 0 ? (
                      <div className="space-y-1.5">
                        {homeTracks.map((track) => (
                          <TrackCard
                            key={track.id}
                            track={track}
                            queued={blockedTrackIds.has(track.id)}
                            selected={selectedIds.has(track.id)}
                            onToggle={() => toggleSelection(track)}
                          />
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-slate-550 text-center py-6">No suggestions loaded</p>
                    )}
                  </div>
                </div>
              ) : (
                /* Category detail view page */
                <div className="space-y-8">
                  <div className="flex items-center gap-4 border-b border-white/[0.06] pb-4">
                    <button
                      type="button"
                      onClick={() => setActiveMood(null)}
                      className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/[0.02] text-slate-400 hover:text-white hover:bg-white/10 transition-all active:scale-95"
                      aria-label="Back to Vibes"
                    >
                      <ArrowLeft className="h-5 w-5" />
                    </button>
                    {activeMoodData && (
                      <div className="flex items-center gap-2 ml-0.5">
                        <span className="text-xl">{activeMoodData.emoji}</span>
                        <span className="text-lg font-extrabold tracking-tight text-white">
                          {activeMoodData.label} Vibes
                        </span>
                      </div>
                    )}
                    {moodLoading ? (
                      <LoaderCircle className="h-5 w-5 animate-spin text-slate-500 ml-2" />
                    ) : (
                      <button
                        type="button"
                        onClick={() => fetchMoodTracks(activeMood)}
                        className="ml-auto rounded-full border border-white/10 bg-white/[0.03] p-2 text-slate-400 hover:text-white hover:bg-white/10 transition-all duration-200 active:scale-95"
                        aria-label="Refresh Category suggestions"
                      >
                        <RotateCw className="h-4 w-4" />
                      </button>
                    )}
                  </div>

                  {moodLoading ? (
                    <div className="flex h-32 items-center justify-center">
                      <LoaderCircle className="h-6 w-6 animate-spin text-slate-650" />
                    </div>
                  ) : moodTracks.length > 0 ? (
                    <div className="space-y-1.5">
                      {moodTracks.map((track) => (
                        <TrackCard
                          key={track.id}
                          track={track}
                          queued={blockedTrackIds.has(track.id)}
                          selected={selectedIds.has(track.id)}
                          onToggle={() => toggleSelection(track)}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center text-center py-10">
                      <Music className="h-6 w-6 text-slate-700" />
                      <p className="mt-3 text-base text-slate-500">No suggestions available right now.</p>
                    </div>
                  )}
                </div>
              )
            ) : displayTracks.length === 0 ? (
              /* Empty Results State */
              <div className="flex h-full flex-col items-center justify-center text-center">
                <Search className="h-7 w-7 text-slate-600" />
                <p className="mt-3 text-base text-slate-500">No results for &ldquo;{query}&rdquo;</p>
              </div>
            ) : (
              /* Search Results Layout (Spotify Style) */
              <div className="space-y-8">
                {/* Two Column Section */}
                <div className="grid items-stretch gap-6 md:grid-cols-[1.1fr_1.4fr]">
                  {/* Left: Top Result Card */}
                  <div className="flex flex-col">
                    <h3 className="text-sm font-bold uppercase tracking-wider text-slate-400 mb-4">
                      Top Result
                    </h3>
                    {displayTracks[0] && (
                      <button
                        type="button"
                        disabled={blockedTrackIds.has(displayTracks[0].id)}
                        onClick={() => toggleSelection(displayTracks[0])}
                        className={`relative w-full flex-1 rounded-2xl border p-5 flex flex-col justify-between group transition-all duration-300 text-left disabled:cursor-not-allowed disabled:opacity-40 ${
                          selectedIds.has(displayTracks[0].id)
                            ? "border-emerald-500/30 bg-emerald-500/[0.06] hover:bg-emerald-500/[0.1]"
                            : "border-white/10 bg-white/[0.03] hover:bg-white/[0.06] hover:border-white/15"
                        }`}
                      >
                        <div className="flex items-start gap-4">
                          {displayTracks[0].albumArt ? (
                            <img
                              src={displayTracks[0].albumArt}
                              alt={displayTracks[0].title}
                              className="h-28 w-28 rounded-xl object-cover border border-white/10 shadow-lg group-hover:scale-105 transition-all duration-300"
                            />
                          ) : (
                            <div className="flex h-28 w-28 items-center justify-center rounded-xl border border-white/10 bg-slate-900/60">
                              <Music className="h-10 w-10 text-slate-500" />
                            </div>
                          )}
                        </div>

                        <div className="flex items-end justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-xl font-extrabold text-white tracking-tight">
                              {displayTracks[0].title}
                            </p>
                            <p className="truncate text-sm text-slate-400 font-medium mt-1">
                              {displayTracks[0].artist}
                            </p>
                          </div>
                          <span
                            className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full shadow-lg transition-all duration-200 group-hover:scale-110 ${
                              blockedTrackIds.has(displayTracks[0].id)
                                ? "bg-slate-700 text-slate-400"
                                : selectedIds.has(displayTracks[0].id)
                                  ? "bg-emerald-500 text-slate-950"
                                  : "bg-white text-slate-950"
                            }`}
                          >
                            {blockedTrackIds.has(displayTracks[0].id) ? (
                              <Check className="h-5 w-5" />
                            ) : selectedIds.has(displayTracks[0].id) ? (
                              <CheckCircle2 className="h-5 w-5" />
                            ) : (
                              <Plus className="h-5 w-5" />
                            )}
                          </span>
                        </div>
                      </button>
                    )}
                  </div>

                  {/* Right: Songs Matches list */}
                  <div className="flex flex-col">
                    <h3 className="text-sm font-bold uppercase tracking-wider text-slate-400 mb-4">
                      Songs
                    </h3>
                    <div className="flex-1 flex flex-col justify-between space-y-1">
                      {displayTracks.slice(1, 4).map((track) => (
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
                </div>

                {/* Below: All Other Matches */}
                {displayTracks.length > 4 && (
                  <div>
                    <h3 className="text-sm font-bold uppercase tracking-wider text-slate-400 mb-4">
                      More Matches
                    </h3>
                    <div className="space-y-1.5">
                      {displayTracks.slice(4).map((track) => (
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
                )}
              </div>
            )}
          </div>
        </div>

        <aside className="flex min-h-0 min-w-0 w-full flex-col border-t border-white/[0.08] bg-white/[0.005] p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] sm:p-4 sm:pb-[calc(1rem+env(safe-area-inset-bottom,0px))] md:p-6 md:pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))] md:border-l md:border-white/[0.08] md:border-t-0">
          <div className="mb-3 hidden md:flex items-center justify-between md:mb-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-sky-400/90">
                Your picks
              </p>
              <h3 className="mt-1 text-xl font-extrabold tracking-tight text-white">
                {selectedTracks.length}{" "}
                <span className="text-slate-500 font-normal text-base">
                  {selectedTracks.length === 1 ? "song" : "songs"}
                </span>
              </h3>
            </div>
            <button
              type="button"
              onClick={handleClose}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.02] text-slate-400 transition-all hover:bg-white/[0.08] hover:text-white"
              aria-label="Close"
            >
              <X className="h-4.5 w-4.5" />
            </button>
          </div>

          {/* Mobile: horizontal scroll strip of staged tracks */}
          {selectedTracks.length > 0 ? (
            <div
              className="md:hidden mb-3 flex w-full gap-2 overflow-x-auto overscroll-contain no-scrollbar -mx-1 px-1"
            >
              {selectedTracks.map((track) => (
                <button
                  key={track.id}
                  type="button"
                  onClick={() => toggleSelection(track)}
                  className="group relative shrink-0"
                  aria-label={`Remove ${track.title}`}
                >
                  {track.albumArt ? (
                    <img
                      src={track.albumArt}
                      alt={track.title}
                      className="h-12 w-12 rounded-lg object-cover border border-white/10"
                    />
                  ) : (
                    <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-slate-900/60 border border-white/10">
                      <Music className="h-5 w-5 text-slate-500" />
                    </div>
                  )}
                  <span className="absolute -top-1 -right-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-rose-500 text-white shadow">
                    <X className="h-3 w-3" />
                  </span>
                </button>
              ))}
            </div>
          ) : null}

          {/* Desktop: full picks list */}
          <div className="hidden md:block min-h-0 flex-1 overflow-y-auto no-scrollbar">
            {selectedTracks.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center px-4 text-center">
                <Music className="h-7 w-7 text-slate-700 animate-pulse" />
                <p className="mt-3.5 text-xs text-slate-500 leading-relaxed max-w-[180px]">
                  Tap songs to stage them before adding to the queue.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {selectedTracks.map((track, idx) => (
                  <div
                    key={track.id}
                    className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-[#0c1324]/50 px-3 py-2.5 transition hover:bg-[#121c33]/70 hover:border-white/10"
                  >
                    <span className="w-5 text-center font-mono text-sm text-slate-500 font-medium">
                      {(idx + 1).toString().padStart(2, "0")}
                    </span>
                    {track.albumArt ? (
                      <img
                        src={track.albumArt}
                        alt={track.title}
                        className="h-11 w-11 shrink-0 rounded-lg object-cover border border-white/5"
                      />
                    ) : (
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-slate-900/60 border border-white/5">
                        <Music className="h-5 w-5 text-slate-500" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold text-slate-100">
                        {track.title}
                      </p>
                      <p className="truncate text-xs text-slate-400 font-medium mt-0.5">{track.artist}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleSelection(track)}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-full text-slate-500 transition hover:bg-white/[0.08] hover:text-white"
                      aria-label={`Remove ${track.title}`}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="md:mt-5">
            <button
              type="button"
              onClick={confirmSelection}
              disabled={!selectedTracks.length || confirming}
              className="inline-flex h-11 sm:h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-5 text-sm sm:text-base font-bold text-slate-950 transition-all hover:bg-emerald-450 hover:scale-[1.01] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-30"
            >
              {confirming ? (
                <LoaderCircle className="h-5 w-5 animate-spin" />
              ) : (
                <CheckCircle2 className="h-5 w-5" />
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
  );
}
