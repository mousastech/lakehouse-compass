// Streams the Compass Agent SSE response (POST /api/agent/ask) and dispatches
// typed events. Tool results are data; the UI renders them as collapsible steps.

export interface ToolStep {
  name: string;
  args: Record<string, unknown>;
  rows?: number;
}

export interface AgentHandlers {
  onToken: (text: string) => void;
  onTool: (step: ToolStep) => void;
  onToolResult: (name: string, rows?: number) => void;
  onDone: () => void;
  onError: (message: string) => void;
}

export async function askCompass(q: string, ws: string, h: AgentHandlers): Promise<void> {
  let resp: Response;
  try {
    resp = await fetch('/api/agent/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q, ws }),
    });
  } catch (e) {
    h.onError(e instanceof Error ? e.message : String(e));
    return;
  }
  if (!resp.ok || !resp.body) {
    h.onError(`request failed (${resp.status})`);
    return;
  }
  const reader = resp.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      if (!chunk.startsWith('data: ')) continue;
      let obj: Record<string, unknown>;
      try {
        obj = JSON.parse(chunk.slice(6));
      } catch {
        continue;
      }
      switch (obj.type) {
        case 'token':
          h.onToken(String(obj.text ?? ''));
          break;
        case 'tool':
          h.onTool({ name: String(obj.name), args: (obj.args as Record<string, unknown>) || {} });
          break;
        case 'tool_result':
          h.onToolResult(String(obj.name), typeof obj.rows === 'number' ? obj.rows : undefined);
          break;
        case 'done':
          h.onDone();
          return;
        case 'error':
          h.onError(String(obj.message ?? 'error'));
          return;
      }
    }
  }
  h.onDone();
}

// Split answer text into plain segments and citation chips ([SEC-014], [F-1001]).
const CITE = /\[([A-Z]{2,4}-\d{2,4}|F-\d+)\]/g;
export function splitCitations(text: string): { text: string; cite?: string }[] {
  const out: { text: string; cite?: string }[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  CITE.lastIndex = 0;
  while ((m = CITE.exec(text)) !== null) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    out.push({ text: m[1], cite: m[1] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}
