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
  theme?: "cyberpunk" | "aurora" | "midnight" | "amber";
}

export default function VinylDisc({ track, isPlaying, theme = "cyberpunk" }: VinylDiscProps) {
  const hasTrack = Boolean(track);

  // Define tonearm rotation based on track status and playback
  // - Playing (and has track): Swiveled onto the vinyl grooves (6deg)
  // - Paused/Idle (or no track): Swiveled out of the disc, resting in cradle (-28deg)
  const armRotation = useMemo(() => {
    return isPlaying && hasTrack ? 6 : -28;
  }, [hasTrack, isPlaying]);

  // Define dynamic colored neon backing aura themes
  const auraGlow = useMemo(() => {
    switch (theme) {
      case "aurora":
        return isPlaying
          ? "radial-gradient(circle, rgba(16,185,129,0.32) 0%, rgba(56,189,248,0.18) 45%, rgba(99,102,241,0.06) 65%, rgba(0,0,0,0) 80%)"
          : "radial-gradient(circle, rgba(16,185,129,0.12) 0%, rgba(0,0,0,0) 70%)";
      case "midnight":
        return isPlaying
          ? "radial-gradient(circle, rgba(139,92,246,0.3) 0%, rgba(219,39,119,0.18) 45%, rgba(99,102,241,0.06) 65%, rgba(0,0,0,0) 80%)"
          : "radial-gradient(circle, rgba(139,92,246,0.12) 0%, rgba(0,0,0,0) 70%)";
      case "amber":
        return isPlaying
          ? "radial-gradient(circle, rgba(245,158,11,0.28) 0%, rgba(239,68,68,0.16) 45%, rgba(251,191,36,0.08) 65%, rgba(0,0,0,0) 80%)"
          : "radial-gradient(circle, rgba(245,158,11,0.1) 0%, rgba(0,0,0,0) 70%)";
      case "cyberpunk":
      default:
        return isPlaying
          ? "radial-gradient(circle, rgba(139,92,246,0.2) 0%, rgba(56,189,248,0.12) 40%, rgba(0,0,0,0) 75%)"
          : "radial-gradient(circle, rgba(139,92,246,0.06) 0%, rgba(0,0,0,0) 65%)";
    }
  }, [isPlaying, theme]);

  return (
    <div className="relative w-[70vw] h-[70vw] min-w-[12rem] min-h-[12rem] max-w-[18rem] max-h-[18rem] lg:w-[28vw] lg:h-[28vw] lg:min-w-[24rem] lg:min-h-[24rem] lg:max-w-[31rem] lg:max-h-[31rem] flex items-center justify-center overflow-visible select-none pointer-events-none">
      
      {/* 1. Dynamic Backlight Neon Aura (Leverages soft, minimal colors to distinguish the floating disc against the dark background) */}
      <div
        className="vinyl-aura absolute -inset-6 lg:-inset-10 rounded-full opacity-0 mix-blend-screen transition-all duration-1000"
        style={{
          background: auraGlow,
          opacity: hasTrack ? (isPlaying ? 1 : 0.45) : 0,
        }}
      />

      {/* 2. Platter & Vinyl Body Container */}
      <div className="relative w-full h-full rounded-full flex items-center justify-center overflow-hidden">
        
        {/* 3a. The Spinning Vinyl Record (Grooves, ridges, and glares rotate together for highly visible motion!) */}
        <div
          className="record-spin absolute inset-0 rounded-full flex items-center justify-center overflow-hidden"
          style={{
            animationPlayState: isPlaying ? "running" : "paused",
            background:
              "conic-gradient(from 45deg, #101010, #1c1c1c, #101010, #262626, #101010, #1c1c1c, #101010, #262626, #101010), radial-gradient(circle, transparent 20%, #161616 21%, #0a0a0a 22%, #161616 24%, #0a0a0a 26%, #222 28%, #0a0a0a 32%, #161616 36%, #0a0a0a 40%, #181818 45%, #0a0a0a 50%, #222 55%, #0a0a0a 60%, #161616 68%, #0a0a0a 76%, #161616 84%, #0a0a0a 92%, #121212 100%)",
            backgroundBlendMode: "overlay",
            boxShadow: "inset 0 1.5px 3px rgba(255,255,255,0.15), inset 0 -2px 4px rgba(0,0,0,0.8)",
          }}
        >
          {/* Concentric Micro-Groove texture */}
          <div className="vinyl-grooves absolute inset-0 rounded-full opacity-70 mix-blend-overlay pointer-events-none" />

          {/* Finer subtle inner groove rings */}
          <div className="absolute inset-[15%] rounded-full border border-black/45 pointer-events-none" />
          <div className="absolute inset-[28%] rounded-full border border-black/40 pointer-events-none" />
          <div className="absolute inset-[42%] rounded-full border border-black/35 pointer-events-none" />
          <div className="absolute inset-[65%] rounded-full border border-black/30 pointer-events-none" />

          {/* Glossy High-Gloss Lighting Shimmers (Now rotating to make the spinning motion extremely obvious and satisfying) */}
          <div
            className="absolute inset-0 rounded-full mix-blend-screen opacity-90 pointer-events-none"
            style={{
              background:
                "conic-gradient(from -25deg, transparent 4%, rgba(255,255,255,0.07) 12%, transparent 22%, transparent 45%, rgba(255,255,255,0.09) 50%, transparent 58%, transparent 78%, rgba(255,255,255,0.07) 86%, transparent 94%)",
            }}
          />

          {/* Center Album Art Label */}
          <div
            className="absolute w-[36%] h-[36%] overflow-hidden rounded-full flex items-center justify-center z-10 shadow-[0_4px_10px_rgba(0,0,0,0.45)]"
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
                <Music className="h-1/3 w-1/3 text-white/35" />
              </div>
            )}

            {/* Vintage printed record label text layers */}
            <div className="absolute top-[8%] left-1/2 -translate-x-1/2 z-20 pointer-events-none text-[clamp(4px,1.5vw,7.5px)] font-bold tracking-[0.25em] text-amber-400/80 uppercase select-none font-mono">
              Roomi Recs
            </div>
            <div className="absolute bottom-[8%] left-1/2 -translate-x-1/2 z-20 pointer-events-none text-[clamp(4px,1.5vw,7.5px)] font-bold tracking-[0.25em] text-amber-400/80 uppercase select-none font-mono">
              Hi-Fi Stereo
            </div>
          </div>

          {/* Golden Brass Center Rim Accent */}
          <div className="absolute w-[37.2%] h-[37.2%] rounded-full border-[1.5px] border-amber-500/25 mix-blend-overlay pointer-events-none" />
        </div>

        {/* Outer Edge Rim Polish Bevel (Stationary high-end rim highlight) */}
        <div className="absolute inset-0 rounded-full border-[2px] border-white/5 shadow-[inset_0_2px_4px_rgba(255,255,255,0.15)] pointer-events-none z-10" />
      </div>

      {/* 4. Spindle Pin (Polished steel/brass pin) */}
      <div className="absolute w-[2.6%] h-[2.6%] min-w-[8px] min-h-[8px] bg-gradient-to-br from-zinc-300 via-zinc-100 to-zinc-400 rounded-full shadow-[0_1.5px_3px_rgba(0,0,0,0.5)] border border-zinc-500/40 z-20 flex items-center justify-center pointer-events-none">
        <div className="w-[40%] h-[40%] bg-gradient-to-br from-zinc-100 to-zinc-300 rounded-full shadow-inner" />
      </div>

      {/* 5. Floating S-Shape Tonearm (Sized and positioned in absolute percentages to scale 100% proportionally) */}
      <div
        className="absolute z-30 w-[42%] h-[84%] top-[-10%] right-[-7%]"
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
