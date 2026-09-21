export interface HeatCell {
  dow: number; // 1=Sun .. 7=Sat (Spark dayofweek)
  hour: number; // 0..23
  n: number;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Activity Heatmap (spec §20.3): 24h × 7d intensity grid.
export function Heatmap({ cells }: { cells: HeatCell[] }) {
  if (cells.length === 0) return <div className="grid place-items-center p-8 text-sm text-muted-foreground">—</div>;
  const max = Math.max(...cells.map((c) => c.n), 1);
  const grid = new Map<string, number>();
  for (const c of cells) grid.set(`${c.dow}-${c.hour}`, c.n);

  return (
    <div className="overflow-x-auto">
      <table className="border-separate" style={{ borderSpacing: 2 }}>
        <tbody>
          {DAYS.map((day, di) => (
            <tr key={day}>
              <td className="pr-2 text-right text-[10px] text-muted-foreground">{day}</td>
              {Array.from({ length: 24 }, (_, h) => {
                const n = grid.get(`${di + 1}-${h}`) ?? 0;
                const intensity = n / max;
                return (
                  <td key={h}>
                    <div
                      title={`${day} ${h}:00 — ${n}`}
                      className="h-4 w-4 rounded-sm"
                      style={{ background: n === 0 ? 'var(--muted)' : `color-mix(in oklch, var(--domain-usage) ${Math.round(20 + intensity * 80)}%, var(--card))` }}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
          <tr>
            <td />
            {Array.from({ length: 24 }, (_, h) => (
              <td key={h} className="text-center text-[8px] text-muted-foreground">{h % 6 === 0 ? h : ''}</td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
