import { describe, expect, it } from "vitest";
import { buildFlatToc, flattenToc, mapTocToChapters, tocForCourse } from "./studyToc";
import { defaultStudyPromptConfig, renderStudyPrompt, listPromptVars } from "./studyPrompts";
import { splitChapterText, buildMergeInput, lectureSourceForChapter, topKChunksForQuery } from "./studySummary";
import { classifyEpubImgRole, extractImageRefsFromHtml, findDuplicateImages } from "./studyEpubImageConfig";
import { isChapterMemoryEnabled } from "./studyMemory";

describe("studyToc", () => {
  it("builds flat toc and flattens nested", () => {
    const flat = buildFlatToc([{ id: "a", title: "Ch1", summary: "", difficulty: "normal", isCompleted: false } as never, { id: "b", title: "Ch2", summary: "", difficulty: "normal", isCompleted: false } as never]);
    expect(flat.length).toBe(2);
    expect(flat[0].chapterIndex).toBe(0);
    const nested = [{ id: "p", title: "Part", level: 0, children: [{ id: "c", title: "Ch1", level: 1, children: [] }] }];
    expect(flattenToc(nested as never).length).toBe(2);
  });
  it("maps toc titles to chapter index", () => {
    const nodes = [{ id: "n1", title: "Intro", level: 0, children: [] }];
    const chapters = [{ id: "x", title: "Intro", summary: "", difficulty: "normal", isCompleted: false } as never];
    const mapped = mapTocToChapters(nodes as never, chapters as never);
    expect(mapped[0].chapterIndex).toBe(0);
  });
  it("falls back to flat when course has no toc", () => {
    const course = { id: "c", title: "T", rawText: "", chapters: [{ id: "a", title: "A", summary: "", difficulty: "normal", isCompleted: false }], currentChapterIndex: 0, createdAt: 0, coverStyle: "", totalProgress: 0 } as never;
    expect(tocForCourse(course as never).length).toBe(1);
  });
});

describe("studyPrompts", () => {
  it("has required placeholders", () => {
    const def = defaultStudyPromptConfig();
    expect(def.summaryChunkPrompt).toContain("{{chunkText}}");
    expect(def.summaryMergePrompt).toContain("{{layerSummaries}}");
    expect(def.lecturePrompt).toContain("{{sourceText}}");
    expect(def.lecturePrompt).toContain("{{summary}}");
    expect(def.lecturePrompt).not.toContain("Quick recap");
  });
  it("renders vars and reports missing", () => {
    const { text, missing } = renderStudyPrompt("Hello {{name}} {{oops}}", { name: "A" });
    expect(text).toContain("A");
    expect(missing).toEqual(["oops"]);
    expect(listPromptVars("{{a}} {{b}} {{a}}")).toEqual(["a", "b"]);
  });
});

describe("studySummary chunking", () => {
  it("keeps short text in one chunk", () => {
    const chunks = splitChapterText("abc", 4000);
    expect(chunks.length).toBe(1);
    expect(chunks[0].range).toBe("0-3");
  });
  it("splits long text at boundaries and preserves coverage", () => {
    const text = `${"a".repeat(3990)}. Hello world. ${"b".repeat(3990)}. End.`;
    const chunks = splitChapterText(text, 4000);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].start).toBe(0);
    expect(chunks[chunks.length - 1].end).toBe(text.length);
    const joined = chunks.map((c) => c.text).join("");
    expect(joined).toBe(text);
  });
  it("merge input tags ranges", () => {
    expect(buildMergeInput([{ range: "0-10", summary: "s1" }])).toContain("0-10");
  });
  it("lecture source preserves tail for long chapters", () => {
    const text = `HEAD-${"x".repeat(20000)}-TAIL`;
    const { sourceText, truncated } = lectureSourceForChapter(text, "sum");
    expect(truncated).toBe(true);
    expect(sourceText).toContain("HEAD");
    expect(sourceText).toContain("TAIL");
  });
  it("topK prefers query-matching chunk", () => {
    const chunks = [{ index: 0, start: 0, end: 5, range: "0-5", text: "apple banana" }, { index: 1, start: 5, end: 10, range: "5-10", text: "quantum physics" }];
    const top = topKChunksForQuery(chunks, "quantum physics", 1);
    expect(top[0].index).toBe(1);
  });
});

describe("epub image role", () => {
  it("classifies note/icon/content", () => {
    expect(classifyEpubImgRole({ inNoteContext: true })).toBe("note");
    expect(classifyEpubImgRole({ inNoteContext: false, width: 32, height: 32 })).toBe("icon");
    expect(classifyEpubImgRole({ inNoteContext: false, width: 800, height: 600 })).toBe("content");
  });
});

describe("study memory switch", () => {
  it("chapter overrides course and global", () => {
    expect(isChapterMemoryEnabled({ courseEnabled: true, chapterEnabled: false, globalDefault: true })).toBe(false);
    expect(isChapterMemoryEnabled({ courseEnabled: false, chapterEnabled: undefined, globalDefault: true })).toBe(false);
    expect(isChapterMemoryEnabled({ courseEnabled: undefined, chapterEnabled: undefined, globalDefault: true })).toBe(true);
  });
});

describe("epub duplicate images", () => {
  const H1 = '<p>a<img src="blobref:b_1" data-epub-img-role="content"></p><p>b<img src="blobref:b_1" data-epub-img-role="content"><img src="blobref:b_2" data-epub-img-role="note"></p>';
  it("counts refs per html", () => {
    const m = extractImageRefsFromHtml(H1);
    expect(m.get("blobref:b_1")?.count).toBe(2);
    expect(m.get("blobref:b_2")?.role).toBe("note");
  });
  it("finds duplicates across chapters with threshold", () => {
    const chs = [{ rawHtml: '<img src="blobref:b_1"><img src="blobref:b_1"><img src="blobref:b_1">' }, { rawHtml: '<img src="blobref:b_1"><img src="blobref:b_2">' }];
    const dup = findDuplicateImages(chs as never, 3);
    expect(dup.length).toBe(1);
    expect(dup[0].ref).toBe("blobref:b_1");
    expect(dup[0].count).toBe(4);
  });
  it("returns empty when below threshold", () => {
    const chs = [{ rawHtml: '<img src="blobref:b_9">' }];
    expect(findDuplicateImages(chs as never, 3)).toEqual([]);
  });
});