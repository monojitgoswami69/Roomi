import { useState, useEffect } from "react";

export function useAudioAnalysis(trackId: string | undefined, accessToken: string) {
  const [barHeights, setBarHeights] = useState<number[]>(new Array(80).fill(12));
  const [isLoading, setIsLoading] = useState(false);

  const buildFallbackBars = () =>
    Array.from({ length: 80 }, (_, i) =>
      Math.max(4, 12 + Math.sin(i * 0.3) * 10 + Math.cos(i * 0.15) * 6),
    );

  useEffect(() => {
    if (!trackId || !accessToken) {
      setTimeout(() => setBarHeights(buildFallbackBars()), 0);
      return;
    }

    const abortController = new AbortController();
    let cancelled = false;

    const fetchAnalysis = async () => {
      setIsLoading(true);
      try {
        const res = await fetch(`https://api.spotify.com/v1/audio-analysis/${trackId}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
          signal: abortController.signal
        });

        if (!res.ok) throw new Error("Analysis fetch failed");

        const data = await res.json();
        if (cancelled) return;

        const duration = data.track.duration;
        const segments = data.segments as Array<{start: number, loudness_max: number}>;
        
        const newBars = new Array(80).fill(0);
        for (let i = 0; i < 80; i++) {
          const targetTime = (i / 80) * duration;
          let closest = segments[0];
          let minDiff = Infinity;
          for (const seg of segments) {
            const diff = Math.abs(seg.start - targetTime);
            if (diff < minDiff) {
              minDiff = diff;
              closest = seg;
            } else if (diff > minDiff) {
              break; // Segments are sorted
            }
          }

          const normalized = Math.max(0, Math.min(1, (closest.loudness_max + 60) / 60));
          newBars[i] = Math.max(3, normalized * 48);
        }
        setBarHeights(newBars);
      } catch (error) {
        console.error("Audio analysis fetch failed", error);
        if (!cancelled) {
          setBarHeights(buildFallbackBars());
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    fetchAnalysis();

    return () => {
      cancelled = true;
      abortController.abort();
    };
  }, [trackId, accessToken]);

  return { barHeights, isLoading };
}
