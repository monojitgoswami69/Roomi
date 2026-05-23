"use client";

import { Music } from "lucide-react";
import React, { useMemo } from "react";

interface Track {
  title: string;
  artist: string;
  albumArt?: string;
}

interface VinylDiscProps {
  track: Track | null;
  isPlaying: boolean;
}

export default function VinylDisc({ track, isPlaying }: VinylDiscProps) {
  const hasTrack = Boolean(track);

  // Define tonearm rotation based on track status and playback
  // - Playing (and has track): Swiveled onto the vinyl grooves (6deg)
  // - Paused/Idle (or no track): Swiveled out of the disc, resting in cradle (-28deg)
  const armRotation = useMemo(() => {
    return isPlaying && hasTrack ? 6 : -28;
  }, [hasTrack, isPlaying]);

  return (
    <div className="relative w-[19rem] h-[19rem] lg:w-[35rem] lg:h-[35rem] flex items-center justify-center overflow-visible select-none pointer-events-none">
      
      {/* 1. Dynamic Backlight Neon Aura (Leverages soft, minimal colors to distinguish the floating disc against the dark background) */}
      <div
        className="vinyl-aura absolute -inset-6 lg:-inset-10 rounded-full opacity-0 mix-blend-screen transition-all duration-1000"
        style={{
          background: isPlaying
            ? "radial-gradient(circle, rgba(139,92,246,0.2) 0%, rgba(56,189,248,0.12) 40%, rgba(0,0,0,0) 75%)"
            : "radial-gradient(circle, rgba(139,92,246,0.06) 0%, rgba(0,0,0,0) 65%)",
          opacity: hasTrack ? (isPlaying ? 1 : 0.45) : 0,
        }}
      />

      {/* 2. Soft Shadow Base Platter (Translucent backing separating the record from the page with light shadows) */}
      <div className="absolute w-[17.8rem] h-[17.8rem] lg:w-[33.2rem] lg:h-[33.2rem] rounded-full bg-zinc-950/80 shadow-[0_8px_32px_rgba(0,0,0,0.4)] border border-white/[0.03]" />

      {/* 3. The Spinning Vinyl Record Disc (Scaled Up) */}
      <div
        className="record-spin absolute w-[17rem] h-[17rem] lg:w-[32rem] lg:h-[32rem] rounded-full flex items-center justify-center overflow-hidden transition-transform duration-[1200ms]"
        style={{
          animationPlayState: isPlaying ? "running" : "paused",
          background:
            "conic-gradient(from 45deg, #121212, #242424, #121212, #2f2f2f, #121212, #242424, #121212, #2f2f2f, #121212), radial-gradient(circle, transparent 20%, #161616 21%, #090909 100%)",
          backgroundBlendMode: "overlay",
          boxShadow: "inset 0 1.5px 3px rgba(255,255,255,0.15), inset 0 -2px 4px rgba(0,0,0,0.8)",
        }}
      >
        {/* Micro-Groove concentric texture */}
        <div className="vinyl-grooves absolute inset-0 rounded-full opacity-65 mix-blend-overlay" />

        {/* Groove segment rings */}
        <div className="absolute inset-[15%] rounded-full border border-black/40" />
        <div className="absolute inset-[28%] rounded-full border border-black/35" />
        <div className="absolute inset-[42%] rounded-full border border-black/30" />
        <div className="absolute inset-[65%] rounded-full border border-black/25" />

        {/* High-Gloss Light Shimmer reflections */}
        <div
          className="absolute inset-0 rounded-full mix-blend-screen opacity-90"
          style={{
            background:
              "conic-gradient(from 0deg, transparent 5%, rgba(255,255,255,0.06) 12%, transparent 20%, transparent 40%, rgba(255,255,255,0.08) 50%, transparent 60%, transparent 80%, rgba(255,255,255,0.06) 88%, transparent 95%)",
          }}
        />

        {/* Polished Edge Rim */}
        <div className="absolute inset-0 rounded-full border-[1.5px] border-white/5" />

        {/* 4. Center Album Art Label */}
        <div
          className="absolute w-[6.2rem] h-[6.2rem] lg:w-[11.5rem] lg:h-[11.5rem] overflow-hidden rounded-full flex items-center justify-center z-10 shadow-[0_4px_10px_rgba(0,0,0,0.45)]"
          style={{
            background: "linear-gradient(135deg, #18181b, #09090b)",
            maskImage: "radial-gradient(circle, black 65%, rgba(0,0,0,0.85) 90%, transparent 100%)",
            WebkitMaskImage: "radial-gradient(circle, black 65%, rgba(0,0,0,0.85) 90%, transparent 100%)",
          }}
        >
          {hasTrack && track?.albumArt ? (
            <img
              src={track.albumArt}
              alt={track.title}
              className="h-full w-full object-cover select-none"
              draggable={false}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-zinc-900">
              <Music className="h-7 w-7 lg:h-12 lg:w-12 text-white/35" />
            </div>
          )}
        </div>

        {/* Golden Brass Center Rim Accent */}
        <div className="absolute w-[6.4rem] h-[6.4rem] lg:w-[11.7rem] lg:h-[11.7rem] rounded-full border-[1.5px] border-amber-500/25 mix-blend-overlay" />
      </div>

      {/* 5. Spindle Pin (Polished steel/brass pin) */}
      <div className="absolute w-2 h-2 lg:w-4.5 lg:h-4.5 bg-gradient-to-br from-zinc-300 via-zinc-100 to-zinc-400 rounded-full shadow-[0_1.5px_3px_rgba(0,0,0,0.5)] border border-zinc-500/40 z-20 flex items-center justify-center pointer-events-none">
        <div className="w-0.5 h-0.5 lg:w-1.5 lg:h-1.5 bg-gradient-to-br from-zinc-100 to-zinc-300 rounded-full shadow-inner" />
      </div>

      {/* 6. Floating S-Shape Tonearm (Brought closer to the disc edge with light, clean shadows) */}
      <div
        className="absolute z-30 w-[7.2rem] h-[14.4rem] lg:w-[12.5rem] lg:h-[25rem] top-[-2rem] right-[-1.4rem] lg:top-[-3.8rem] lg:right-[-2.5rem]"
        style={{
          // Clean, modern, soft shadow offset instead of deep heavy black shadow
          filter: "drop-shadow(-4px 8px 6px rgba(0,0,0,0.25))",
        }}
      >
        <svg
          viewBox="0 0 100 240"
          className="w-full h-full overflow-visible"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <linearGradient id="metal-grad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#f1f5f9" />
              <stop offset="30%" stopColor="#cbd5e1" />
              <stop offset="50%" stopColor="#94a3b8" />
              <stop offset="85%" stopColor="#64748b" />
              <stop offset="100%" stopColor="#475569" />
            </linearGradient>
            <linearGradient id="brass-grad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#fbbf24" />
              <stop offset="50%" stopColor="#d97706" />
              <stop offset="100%" stopColor="#78350f" />
            </linearGradient>
            <linearGradient id="neon-blue-grad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#38bdf8" />
              <stop offset="100%" stopColor="#6366f1" />
            </linearGradient>
          </defs>



          {/* Pivot Base Hub Assembly (Stationary cylinder hub with brushed metal and blue neon indicators) */}
          <circle cx="70" cy="38" r="16" fill="#09090b" stroke="#27272a" strokeWidth="2" />
          <circle cx="70" cy="38" r="13" fill="url(#neon-blue-grad)" opacity="0.3" />
          <circle cx="70" cy="38" r="11" fill="#18181b" stroke="url(#metal-grad)" strokeWidth="1.2" />
          <circle cx="70" cy="38" r="7" fill="#020617" />
          <circle cx="70" cy="38" r="3.5" fill="url(#brass-grad)" />

          {/* Swiveling Mechanical Arm Group (Pivots inward on playing, swivels back out to park on paused/idle) */}
          <g
            style={{
              transformOrigin: "70px 38px",
              transform: `rotate(${armRotation}deg)`,
              transition: "transform 1.2s cubic-bezier(0.25, 1, 0.25, 1)",
            }}
          >
            {/* Matte counterweight balanced at the top */}
            <rect
              x="62"
              y="2"
              width="16"
              height="18"
              rx="2"
              fill="url(#metal-grad)"
              stroke="#334155"
              strokeWidth="0.75"
            />
            {/* Weight division lines */}
            <line x1="66" y1="5" x2="66" y2="17" stroke="#1e293b" strokeWidth="1.2" />
            <line x1="70" y1="5" x2="70" y2="17" stroke="#1e293b" strokeWidth="1.2" />
            <line x1="74" y1="5" x2="74" y2="17" stroke="#1e293b" strokeWidth="1.2" />

            {/* S-shaped metal tonearm tube (Polished cylindrical silver sheen) */}
            <path
              d="M 70 20 L 70 38 Q 70 85 45 105 T 32 185 L 34 212"
              stroke="url(#metal-grad)"
              strokeWidth="3.4"
              strokeLinecap="round"
              fill="none"
            />

            {/* Cue Lever mechanism */}
            <line x1="58" y1="42" x2="52" y2="52" stroke="#475569" strokeWidth="1.8" strokeLinecap="round" />
            <circle cx="52" cy="52" r="1.5" fill="#0f172a" />

            {/* Connector collar */}
            <rect
              x="30"
              y="212"
              width="8"
              height="4"
              rx="0.5"
              fill="url(#brass-grad)"
              stroke="#334155"
              strokeWidth="0.5"
            />

            {/* Modern angular Cartridge head */}
            <path
              d="M 34 216 L 42 220 L 38 238 L 29 233 Z"
              fill="#18181b"
              stroke="#3f3f46"
              strokeWidth="1"
              strokeLinejoin="round"
            />
            {/* Stylus lifter finger grip */}
            <path d="M 42 220 Q 48 220 46 226" stroke="url(#metal-grad)" strokeWidth="1.2" fill="none" />

            {/* Glowing Active Status LED Indicator */}
            <circle
              cx="35"
              cy="226"
              r="2"
              className={isPlaying ? "needle-pulse" : ""}
              fill={hasTrack ? (isPlaying ? "#34d399" : "#fbbf24") : "#52525b"}
            />
          </g>
        </svg>
      </div>
    </div>
  );
}
