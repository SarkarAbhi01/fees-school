import { useState } from 'react';

/** Tiny SVG charts (no chart library). */
export interface Point { label: string; value: number; sub?: string }

export function BarChart({ data, height = 180, format = (n: number) => String(n), color = '#173A31' }: { data: Point[]; height?: number; format?: (n: number) => string; color?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  if (!data.length) return <p className="py-8 text-center text-sm text-slate-500">No data for this selection.</p>;
  const max = Math.max(1, ...data.map((d) => d.value));
  const w = Math.max(280, data.length * 28), pad = 22;
  const step = (w - pad) / data.length, bw = Math.max(4, step * 0.65);
  const every = Math.ceil(data.length / 10);
  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${w} ${height + 24}`} className="w-full" style={{ minWidth: Math.min(w, 560), height: 'auto' }} role="img" aria-label="Bar chart">
        <line x1={pad} x2={w} y1={height} y2={height} stroke="#e2e8f0" />
        <text x={0} y={10} fontSize="9" fill="#64748b">{format(max)}</text>
        {data.map((d, i) => {
          const h = (d.value / max) * (height - 16), x = pad + i * step + (step - bw) / 2;
          return (
            <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onClick={() => setHover(i)}>
              <rect x={x} y={height - h} width={bw} height={Math.max(h, d.value > 0 ? 1 : 0)} rx={2} fill={color} opacity={hover === null || hover === i ? 1 : 0.5} />
              <rect x={pad + i * step} y={0} width={step} height={height} fill="transparent" />
              {i % every === 0 && <text x={x + bw / 2} y={height + 14} fontSize="9" textAnchor="middle" fill="#64748b">{d.label}</text>}
            </g>
          );
        })}
        {hover !== null && (
          <g pointerEvents="none">
            <rect x={Math.min(w - 120, Math.max(pad, pad + hover * step - 40))} y={2} width={120} height={30} rx={4} fill="#14201C" />
            <text x={Math.min(w - 120, Math.max(pad, pad + hover * step - 40)) + 6} y={14} fontSize="10" fill="#fff">{data[hover].label}</text>
            <text x={Math.min(w - 120, Math.max(pad, pad + hover * step - 40)) + 6} y={26} fontSize="10" fontWeight="600" fill="#fff">{format(data[hover].value)}{data[hover].sub ? ` · ${data[hover].sub}` : ''}</text>
          </g>
        )}
      </svg>
    </div>
  );
}

/** Horizontal bars with a label and a value, e.g. "top schools". */
export function HBars({ data, format = (n: number) => String(n), color = '#173A31' }: { data: Point[]; format?: (n: number) => string; color?: string }) {
  if (!data.length) return <p className="py-6 text-center text-sm text-slate-500">No data for this selection.</p>;
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <ul className="space-y-2 p-4">
      {data.map((d) => (
        <li key={d.label} className="text-sm">
          <div className="flex justify-between gap-3"><span className="truncate">{d.label}</span><b className="shrink-0">{format(d.value)}</b></div>
          <div className="mt-1 h-2 rounded-sm bg-board-100"><div className="h-2 rounded-sm" style={{ width: `${(d.value / max) * 100}%`, background: color }} /></div>
        </li>
      ))}
    </ul>
  );
}

export function Stat({ label, value, tone = 'text-ink', hint }: { label: string; value: string | number; tone?: string; hint?: string }) {
  return (
    <div className="bg-white p-4 sm:p-5">
      <p className="text-xs text-slate-500 sm:text-sm">{label}</p>
      <p className={`mt-1 font-display text-2xl font-bold sm:text-3xl ${tone}`}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}
