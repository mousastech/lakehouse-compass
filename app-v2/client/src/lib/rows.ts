// AppKit 0.24: useAnalyticsQuery types `data` as a union of all query row shapes,
// which blocks field access. Route ALL access through these helpers so the UI
// coerces fields explicitly. Numbers come back as strings → always Number().

export function asRows(data: unknown): Record<string, unknown>[] {
  return Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
}

export function firstRow(data: unknown): Record<string, unknown> {
  return asRows(data)[0] ?? {};
}

export function toNum(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function toStr(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

export function toBool(v: unknown): boolean {
  return v === true || v === 'true' || v === 1 || v === '1';
}

export function toArr(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === 'string' && v.trim().startsWith('[')) {
    try {
      const p = JSON.parse(v);
      return Array.isArray(p) ? p.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}
