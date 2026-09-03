export const STUDY_MEMORY_DEFAULT_KEY = "study_memory_default_enabled";
export const STUDY_VECTOR_KEY = "study_vector_enabled";
export function loadStudyMemoryDefault(): boolean {
  try { return localStorage.getItem(STUDY_MEMORY_DEFAULT_KEY) === "1"; } catch { return false; }
}
export function saveStudyMemoryDefault(v: boolean): void {
  try { localStorage.setItem(STUDY_MEMORY_DEFAULT_KEY, v ? "1" : "0"); } catch { /* ignore */ }
}
export function loadStudyVectorEnabled(): boolean {
  try { return localStorage.getItem(STUDY_VECTOR_KEY) === "1"; } catch { return false; }
}
export function saveStudyVectorEnabled(v: boolean): void {
  try { localStorage.setItem(STUDY_VECTOR_KEY, v ? "1" : "0"); } catch { /* ignore */ }
}
export function isChapterMemoryEnabled(opts: { courseEnabled?: boolean; chapterEnabled?: boolean; globalDefault: boolean }): boolean {
  if (typeof opts.chapterEnabled === "boolean") return opts.chapterEnabled;
  if (typeof opts.courseEnabled === "boolean") return opts.courseEnabled;
  return opts.globalDefault;
}
