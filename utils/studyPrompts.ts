export interface StudyPromptConfig {
  summaryChunkPrompt: string;
  summaryMergePrompt: string;
  lecturePrompt: string;
}

export const STUDY_PROMPT_KEY = "study_prompt_config";

export const DEFAULT_SUMMARY_CHUNK_PROMPT = [
  "Task: Summarize one section of a book chapter.",
  "Chapter: {{chapterTitle}}",
  "Section range: {{range}} (chars {{range}} of the chapter source).",
  "Source section:",
  "{{chunkText}}",
  "Requirements:",
  "- Use the SAME LANGUAGE as the source.",
  "- Output 2-4 bullet points with **bold** key terms.",
  "- Do NOT invent content beyond the source.",
].join("\n");

export const DEFAULT_SUMMARY_MERGE_PROMPT = [
  "Task: Merge section summaries into one chapter summary.",
  "Chapter: {{chapterTitle}}",
  "Section summaries:",
  "{{layerSummaries}}",
  "Requirements:",
  "- Use the SAME LANGUAGE as the summaries.",
  "- Output 3-6 key points with **bold** key terms, then a 1-2 sentence takeaway.",
  "- Do NOT invent content.",
].join("\n");

export const DEFAULT_LECTURE_PROMPT = [
  "{{persona}}",
  "",
  "[Current Lesson]",
  'Topic: "{{chapterTitle}}" (difficulty: {{difficulty}}). Preference: "{{preference}}". Style: {{style}}.',
  "",
  "[Chapter Summary (reference, do NOT repeat verbatim)]",
  "{{summary}}",
  "",
  "[Source Material (authoritative)]",
  "{{sourceText}}",
  "",
  "[Task: Lecture]",
  "Explain key concepts strictly from the Source Material.",
  "- Markdown with **bold** terms, lists, and $ math / $$ block math where needed.",
  "- Structure: 1. Friendly intro 2. Core explanation with analogies 3. Concrete example.",
  "- End with ONE guiding question that invites the user to review; do NOT write a full Summary section.",
].join("\n");

export function defaultStudyPromptConfig(): StudyPromptConfig {
  return {
    summaryChunkPrompt: DEFAULT_SUMMARY_CHUNK_PROMPT,
    summaryMergePrompt: DEFAULT_SUMMARY_MERGE_PROMPT,
    lecturePrompt: DEFAULT_LECTURE_PROMPT,
  };
}

export function loadStudyPromptConfig(): StudyPromptConfig {
  const def = defaultStudyPromptConfig();
  try {
    const raw = localStorage.getItem(STUDY_PROMPT_KEY);
    if (!raw) return def;
    const p = JSON.parse(raw) as Partial<StudyPromptConfig>;
    return {
      summaryChunkPrompt: typeof p.summaryChunkPrompt === "string" && p.summaryChunkPrompt.trim() ? p.summaryChunkPrompt : def.summaryChunkPrompt,
      summaryMergePrompt: typeof p.summaryMergePrompt === "string" && p.summaryMergePrompt.trim() ? p.summaryMergePrompt : def.summaryMergePrompt,
      lecturePrompt: typeof p.lecturePrompt === "string" && p.lecturePrompt.trim() ? p.lecturePrompt : def.lecturePrompt,
    };
  } catch {
    return def;
  }
}

export function saveStudyPromptConfig(cfg: StudyPromptConfig): void {
  try {
    localStorage.setItem(STUDY_PROMPT_KEY, JSON.stringify(cfg));
  } catch { /* ignore quota/private mode */ }
}

export function resetStudyPromptConfig(): StudyPromptConfig {
  const def = defaultStudyPromptConfig();
  try {
    localStorage.removeItem(STUDY_PROMPT_KEY);
  } catch { /* ignore */ }
  return def;
}

export function renderStudyPrompt(template: string, vars: Record<string, string>): { text: string; missing: string[] } {
  const missing: string[] = [];
  const text = template.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (m, key: string) => {
    if (Object.prototype.hasOwnProperty.call(vars, key)) return vars[key] ?? "";
    if (!missing.includes(key)) missing.push(key);
    return m;
  });
  return { text, missing };
}

export function listPromptVars(template: string): string[] {
  const out: string[] = [];
  const re = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(template)) !== null) {
    if (!out.includes(m[1])) out.push(m[1]);
  }
  return out;
}