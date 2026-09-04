import { describe, expect, it } from "vitest";
import { cleanLegacyHiddenRefs, extractImageHashesFromHtml, findDuplicateImages, isImageHash } from "./studyEpubImageConfig";
import { isSha256Hex, sha256Hex } from "./imageHash";

describe("image hash dup", () => {
  it("groups same hash across different tokens", () => {
    const h = "a".repeat(64);
    const chs = [
      { rawHtml: `<img src="blobref:b_1" data-epub-img-hash="${h}"><img src="blobref:b_2" data-epub-img-hash="${h}">` },
      { rawHtml: `<img src="blobref:b_3" data-epub-img-hash="${h}">` },
    ];
    const dup = findDuplicateImages(chs as never, 3);
    expect(dup.length).toBe(1);
    expect(dup[0].hash).toBe(h);
    expect(dup[0].count).toBe(3);
    expect(dup[0].ref).toBe("blobref:b_1");
  });
  it("extracts hash map with first-token representative", () => {
    const h = "b".repeat(64);
    const m = extractImageHashesFromHtml(`<img src="blobref:b_9" data-epub-img-hash="${h}" data-epub-img-role="note">`);
    expect(m.get(h)?.count).toBe(1);
    expect(m.get(h)?.ref).toBe("blobref:b_9");
    expect(m.get(h)?.role).toBe("note");
  });
  it("falls back to ref keys when hash missing", () => {
    const chs = [{ rawHtml: '<img src="blobref:b_7"><img src="blobref:b_7">' }];
    const dup = findDuplicateImages(chs as never, 2);
    expect(dup.length).toBe(1);
    expect(dup[0].ref).toBe("blobref:b_7");
  });
  it("cleans legacy blobref hidden list", () => {
    const h = "c".repeat(64);
    expect(cleanLegacyHiddenRefs([h, "blobref:b_1", 123 as never])).toEqual([h]);
    expect(isImageHash(h)).toBe(true);
    expect(isImageHash("blobref:b_1")).toBe(false);
  });
  it("sha256Hex is stable and sensitive", async () => {
    const a = new Blob(["hello"], { type: "text/plain" });
    const b = new Blob(["hello"], { type: "text/plain" });
    const c = new Blob(["world"], { type: "text/plain" });
    expect(await sha256Hex(a)).toBe(await sha256Hex(b));
    expect(await sha256Hex(a)).not.toBe(await sha256Hex(c));
    expect(isSha256Hex(await sha256Hex(a))).toBe(true);
  });
});
