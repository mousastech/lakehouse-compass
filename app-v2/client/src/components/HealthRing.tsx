import { useEffect, useRef, useState } from 'react';
import { scoreColorVar } from '../lib/domains';

interface Props {
  score: number;
  delta: number;
  coveragePct: number;
  label: string;
  deltaLabel: string;
  coverageLabel: string;
}

const SIZE = 220;
const STROKE = 16;
const R = (SIZE - STROKE) / 2 - 10;
const C = 2 * Math.PI * R;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  );
}

function useCountUp(target: number, duration = 900): number {
  const [value, setValue] = useState(prefersReducedMotion() ? target : 0);
  const raf = useRef<number>(0);

  useEffect(() => {
    if (prefersReducedMotion()) {
      setValue(target);
      return;
    }
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setValue(Math.round(target * eased));
      if (p < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [target, duration]);

  return value;
}

export function HealthRing({ score, delta, coveragePct, label, deltaLabel, coverageLabel }: Props) {
  const shown = useCountUp(score);
  const color = `var(${scoreColorVar(score)})`;
  const dash = (score / 100) * C;
  const coverageDash = (coveragePct / 100) * C;

  return (
    <div className="flex flex-col items-center">
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={`${label}: ${score} out of 100`}>
        {/* Outer dashed coverage ring */}
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={R + 12}
          fill="none"
          stroke="var(--border)"
          strokeWidth={3}
          strokeDasharray="2 6"
        />
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={R + 12}
          fill="none"
          stroke="var(--primary)"
          strokeWidth={3}
          strokeDasharray={`${coverageDash} ${C}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
          opacity={0.55}
        />
        {/* Track */}
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={R}
          fill="none"
          stroke="var(--muted)"
          strokeWidth={STROKE}
        />
        {/* Score sweep */}
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={R}
          fill="none"
          stroke={color}
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${C}`}
          transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
          style={{ transition: 'stroke-dasharray var(--dur-story) var(--ease)' }}
        />
        <text
          x="50%"
          y="47%"
          textAnchor="middle"
          className="tnum"
          style={{ fill: 'var(--foreground)', fontSize: 46, fontWeight: 700 }}
        >
          {shown}
        </text>
        <text
          x="50%"
          y="62%"
          textAnchor="middle"
          style={{ fill: 'var(--muted-foreground)', fontSize: 12, letterSpacing: 1 }}
        >
          / 100
        </text>
      </svg>

      <div className="mt-2 text-center">
        <div className="text-sm font-medium text-foreground">{label}</div>
        <div className="mt-1 flex items-center justify-center gap-3 text-xs text-muted-foreground">
          <span style={{ color: delta >= 0 ? 'var(--domain-finops)' : 'var(--sev-high)' }}>
            {delta >= 0 ? '▲' : '▼'} {Math.abs(delta)} {deltaLabel}
          </span>
          <span>·</span>
          <span>
            {coveragePct}% {coverageLabel}
          </span>
        </div>
      </div>
    </div>
  );
}
