export type ClassroomThemeId = "blackboard" | "day" | "sepia" | "midnight" | "minimal";
export const CLASSROOM_THEME_KEY = "study_classroom_theme";
export interface ClassroomThemeMeta { id: ClassroomThemeId; label: string; swatchBg: string; swatchFg: string; }
export const CLASSROOM_THEMES: ClassroomThemeMeta[] = [
  { id: "blackboard", label: "Blackboard", swatchBg: "#2b2b2b", swatchFg: "#6ee7b7" },
  { id: "day", label: "Day", swatchBg: "#ffffff", swatchFg: "#1f2937" },
  { id: "sepia", label: "Sepia", swatchBg: "#f4ecd8", swatchFg: "#3f3428" },
  { id: "midnight", label: "Midnight", swatchBg: "#0f172a", swatchFg: "#93c5fd" },
  { id: "minimal", label: "Minimal", swatchBg: "#f8fafc", swatchFg: "#64748b" },
];
export function isClassroomThemeId(v: unknown): v is ClassroomThemeId {
  return typeof v === "string" && (CLASSROOM_THEMES as ClassroomThemeMeta[]).some((t) => t.id === v);
}
export function loadClassroomTheme(): ClassroomThemeId {
  try {
    const v = localStorage.getItem(CLASSROOM_THEME_KEY);
    if (isClassroomThemeId(v)) return v;
  } catch { /* ignore */ }
  return "blackboard";
}
export function saveClassroomTheme(t: ClassroomThemeId): void {
  try { localStorage.setItem(CLASSROOM_THEME_KEY, t); } catch { /* ignore */ }
}
