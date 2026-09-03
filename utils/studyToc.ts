import type { StudyChapter, StudyCourse, StudyTocNode } from "../types";

export function makeTocId(prefix: string, n: number): string {
  return `${prefix}-${n}`;
}

export function buildFlatToc(chapters: StudyChapter[]): StudyTocNode[] {
  return chapters.map((c, i) => ({
    id: `toc-flat-${i}`,
    title: c.title,
    level: 0,
    chapterIndex: i,
    children: [],
  }));
}

export function flattenToc(nodes: StudyTocNode[]): StudyTocNode[] {
  const out: StudyTocNode[] = [];
  const walk = (list: StudyTocNode[]) => {
    for (const n of list) {
      out.push(n);
      if (n.children && n.children.length > 0) walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

export function mapTocToChapters(
  nodes: StudyTocNode[],
  chapters: StudyChapter[],
): StudyTocNode[] {
  const norm = (s: string) => (s || "").replace(/\s+/g, "").toLowerCase();
  const titleIndex = new Map<string, number>();
  chapters.forEach((c, i) => {
    const k = norm(c.title);
    if (!titleIndex.has(k)) titleIndex.set(k, i);
  });
  const walk = (list: StudyTocNode[]): StudyTocNode[] =>
    list.map((n) => {
      let idx = n.chapterIndex;
      if (idx === undefined) {
        const hit = titleIndex.get(norm(n.title));
        if (hit !== undefined) idx = hit;
      }
      return { ...n, chapterIndex: idx, children: n.children ? walk(n.children) : [] };
    });
  return walk(nodes);
}

export function tocForCourse(course: StudyCourse): StudyTocNode[] {
  if (course.toc && course.toc.length > 0) return course.toc;
  return buildFlatToc(course.chapters);
}

export function countTocLeaves(nodes: StudyTocNode[]): number {
  let n = 0;
  const walk = (list: StudyTocNode[]) => {
    for (const x of list) {
      if (!x.children || x.children.length === 0) n += 1;
      else walk(x.children);
    }
  };
  walk(nodes);
  return n;
}
