"use client";

import { useMemo } from "react";
import { QrCode } from "lucide-react";
import qrcode from "qrcode";

export default function RoomQRCode({ value }: { value: string }) {
  const qrData = useMemo(() => {
    if (!value) return null;
    try {
      return qrcode.create(value, { errorCorrectionLevel: "M" });
    } catch {
      return null;
    }
  }, [value]);

  if (!qrData) return <QrCode className="h-10 w-10 text-slate-400" />;

  const size = qrData.modules.size;
  const paths: React.ReactNode[] = [];

  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      if (!qrData.modules.data[row * size + col]) continue;
      const isFinder =
        (row < 7 && col < 7) ||
        (col > size - 8 && row < 7) ||
        (row > size - 8 && col < 7);
      if (isFinder) continue;
      paths.push(
        <circle
          key={`${row}-${col}`}
          cx={col + 0.5}
          cy={row + 0.5}
          r={0.4}
          fill="#FFFFFF"
        />,
      );
    }
  }

  [
    { x: 0, y: 0 },
    { x: size - 7, y: 0 },
    { x: 0, y: size - 7 },
  ].forEach((pos, idx) => {
    paths.push(
      <g key={`finder-${idx}`}>
        <rect
          x={pos.x + 0.5}
          y={pos.y + 0.5}
          width={6}
          height={6}
          rx={1.5}
          fill="none"
          stroke="#FFFFFF"
          strokeWidth={1}
        />
        <rect x={pos.x + 2} y={pos.y + 2} width={3} height={3} rx={0.75} fill="#FFFFFF" />
      </g>,
    );
  });

  return (
    <svg className="h-[136px] w-[136px]" viewBox={`0 0 ${size} ${size}`}>
      {paths}
    </svg>
  );
}
