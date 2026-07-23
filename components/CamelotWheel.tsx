"use client";

interface WheelTrack {
  id: string;
  fileName: string;
  camelotKey: string; // e.g. "8A"
}

interface WheelConnection {
  trackAId: string;
  trackBId: string;
  score: number;
}

interface CamelotWheelProps {
  tracks?: WheelTrack[];
  connections?: WheelConnection[];
  size?: number;
}

const OUTER_KEYS = Array.from({ length: 12 }, (_, i) => `${i + 1}B`);
const INNER_KEYS = Array.from({ length: 12 }, (_, i) => `${i + 1}A`);

function polarToCartesian(cx: number, cy: number, radius: number, angleDeg: number) {
  const angleRad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + radius * Math.cos(angleRad), y: cy + radius * Math.sin(angleRad) };
}

export default function CamelotWheel({ tracks = [], connections = [], size = 420 }: CamelotWheelProps) {
  const cx = size / 2;
  const cy = size / 2;
  const outerRadius = size * 0.42;
  const innerRadius = size * 0.28;
  const trackDotRadius = size * 0.36;

  const keyPositions = new Map<string, { x: number; y: number }>();
  OUTER_KEYS.forEach((key, i) => keyPositions.set(key, polarToCartesian(cx, cy, outerRadius, i * 30)));
  INNER_KEYS.forEach((key, i) => keyPositions.set(key, polarToCartesian(cx, cy, innerRadius, i * 30)));

  // Position tracks around the wheel based on their key, offsetting duplicates
  const keyOccupancy = new Map<string, number>();
  const trackPositions = new Map<string, { x: number; y: number }>();

  tracks.forEach((track) => {
    const idx = OUTER_KEYS.indexOf(track.camelotKey);
    const isOuter = idx !== -1;
    const keyIndex = isOuter ? idx : INNER_KEYS.indexOf(track.camelotKey);
    if (keyIndex === -1) return;

    const occupancyCount = keyOccupancy.get(track.camelotKey) ?? 0;
    keyOccupancy.set(track.camelotKey, occupancyCount + 1);

    const radiusJitter = trackDotRadius + occupancyCount * 14;
    const pos = polarToCartesian(cx, cy, radiusJitter, keyIndex * 30);
    trackPositions.set(track.id, pos);
  });

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="overflow-visible">
      {/* Wheel segment dividers */}
      {Array.from({ length: 12 }, (_, i) => {
        const angle = i * 30 - 15;
        const p1 = polarToCartesian(cx, cy, innerRadius * 0.5, angle);
        const p2 = polarToCartesian(cx, cy, outerRadius * 1.08, angle);
        return (
          <line
            key={`div-${i}`}
            x1={p1.x}
            y1={p1.y}
            x2={p2.x}
            y2={p2.y}
            stroke="var(--color-line)"
            strokeWidth={1}
          />
        );
      })}

      {/* Outer ring (major/B keys) */}
      <circle cx={cx} cy={cy} r={outerRadius} fill="none" stroke="var(--color-line)" strokeWidth={1.5} />
      {/* Inner ring (minor/A keys) */}
      <circle cx={cx} cy={cy} r={innerRadius} fill="none" stroke="var(--color-line)" strokeWidth={1.5} />

      {/* Key labels */}
      {OUTER_KEYS.map((key, i) => {
        const pos = polarToCartesian(cx, cy, outerRadius, i * 30);
        return (
          <text
            key={key}
            x={pos.x}
            y={pos.y}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={size * 0.028}
            fill="#6b6878"
            fontFamily="var(--font-display)"
          >
            {key}
          </text>
        );
      })}
      {INNER_KEYS.map((key, i) => {
        const pos = polarToCartesian(cx, cy, innerRadius, i * 30);
        return (
          <text
            key={key}
            x={pos.x}
            y={pos.y}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={size * 0.026}
            fill="#524f5e"
            fontFamily="var(--font-display)"
          >
            {key}
          </text>
        );
      })}

      {/* Connections between matched tracks */}
      {connections.map((conn, i) => {
        const a = trackPositions.get(conn.trackAId);
        const b = trackPositions.get(conn.trackBId);
        if (!a || !b) return null;
        const opacity = 0.25 + (conn.score / 100) * 0.6;
        return (
          <line
            key={`conn-${i}`}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            stroke="url(#connGradient)"
            strokeWidth={1 + (conn.score / 100) * 2}
            opacity={opacity}
          />
        );
      })}

      <defs>
        <linearGradient id="connGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="var(--color-magenta)" />
          <stop offset="100%" stopColor="var(--color-violet)" />
        </linearGradient>
      </defs>

      {/* Track dots */}
      {tracks.map((track) => {
        const pos = trackPositions.get(track.id);
        if (!pos) return null;
        return (
          <g key={track.id}>
            <circle cx={pos.x} cy={pos.y} r={5} fill="var(--color-amber)" />
            <circle cx={pos.x} cy={pos.y} r={9} fill="var(--color-amber)" opacity={0.25} />
          </g>
        );
      })}

      {/* Center label */}
      <text
        x={cx}
        y={cy}
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize={size * 0.045}
        fill="var(--color-paper)"
        fontFamily="var(--font-display)"
        fontWeight={700}
      >
        MASHMIX
      </text>
    </svg>
  );
}
