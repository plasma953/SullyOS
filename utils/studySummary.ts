export interface StudyTextChunk { index: number; start: number; end: number; range: string; text: string; }
export const STUDY_SUMMARY_THRESHOLD_KEY = "study_ai_summary_threshold";
export const DEFAULT_SUMMARY_THRESHOLD = 4000;
export function loadSummaryThreshold(): number {
  try {
    const raw = localStorage.getItem(STUDY_SUMMARY_THRESHOLD_KEY);
    const n = raw ? Number(raw) : NaN;
    if (Number.isFinite(n) && n >= 500 && n <= 20000) return Math.floor(n);
  } catch { /* ignore */ }
  return DEFAULT_SUMMARY_THRESHOLD;
}
export function saveSummaryThreshold(n: number): void {
  try { localStorage.setItem(STUDY_SUMMARY_THRESHOLD_KEY, String(Math.floor(n))); } catch { /* ignore */ }
}
export function splitChapterText(fullText: string, threshold: number): StudyTextChunk[] {
  const text = fullText || "";
  const th = Math.max(500, Math.min(20000, Math.floor(threshold) || DEFAULT_SUMMARY_THRESHOLD));
  if (!text) return [];
  if (text.length <= th) return [{ index: 0, start: 0, end: text.length, range: `0-${text.length}`, text }];
  const out: StudyTextChunk[] = [];
  let start = 0;
  let idx = 0;
  while (start < text.length) {
    let end = Math.min(start + th, text.length);
    if (end < text.length) {
      const windowStart = Math.max(start, end - 400);
      let cut = -1;
      for (let i = end; i >= windowStart; i--) {
        const ch = text[i];
        if (ch === "\n" || ch === "." || ch === "!" || ch === "?" || ch === ";") { cut = i + 1; break; }
      }
      const cjkMarks = ["\u3002", "\uFF01", "\uFF1F", "\uFF1B", "\n"];
      if (cut < 0) {
        for (let i = end; i >= windowStart; i--) {
          if (cjkMarks.includes(text[i])) { cut = i + 1; break; }
        }
      }
      if (cut > start + Math.floor(th * 0.5)) end = cut;
    }
    out.push({ index: idx, start, end, range: `${start}-${end}`, text: text.slice(start, end) });
    start = end;
    idx += 1;
  }
  return out;
}
export function buildMergeInput(layers: { range: string; summary: string }[]): string {
  return layers.map((l, i) => `[${i + 1} range ${l.range}]\n${l.summary}`.trim()).join("\n\n");
}
export function lectureSourceForChapter(fullText: string, summary: string): { sourceText: string; truncated: boolean } {
  const text = fullText || "";
  const HEAD = 8000;
  const TAIL = 8000;
  const LIMIT = 16000;
  if (text.length <= LIMIT) return { sourceText: text, truncated: false };
  const head = text.slice(0, HEAD);
  const tail = text.slice(text.length - TAIL);
  const note = summary ? "[middle omitted; see summary for the middle]" : "[middle omitted]";
  return { sourceText: `${head}\n\n${note}\n\n${tail}`, truncated: true };
}
export function scoreChunkForQuery(chunk: string, query: string): number {
  if (!query.trim()) return 0;
  const tokens = query.toLowerCase().split(/[^a-z0-9\u4e00-\u9fa5]+/g).filter((t) => t.length >= 2).slice(0, 12);
  if (tokens.length === 0) return 0;
  const low = chunk.toLowerCase();
  let s = 0;
  for (const t of tokens) {
    let idx = low.indexOf(t);
    let c = 0;
    while (idx >= 0 && c < 5) { s += 1; c += 1; idx = low.indexOf(t, idx + t.length); }
  }
  return s;
}
export function topKChunksForQuery(chunks: StudyTextChunk[], query: string, k: number): StudyTextChunk[] {
  const scored = chunks.map((c) => ({ c, s: scoreChunkForQuery(c.text, query) }));
  scored.sort((a, b) => b.s - a.s);
  const top = scored.slice(0, Math.max(1, Math.min(k, chunks.length))).filter((x) => x.s > 0);
  const picked = (top.length > 0 ? top : scored.slice(0, Math.min(k, chunks.length))).map((x) => x.c);
  picked.sort((a, b) => a.start - b.start);
  return picked;
}
