import { describe, expect, it } from "vitest";
import { clearStaleRelationHomes, ensureRelationLink, listJoinableHomes, listRelationHomes, syncMemberFromRelationships } from "./relationshipHomeLink";

describe("relationshipHomeLink", () => {
  const w1: any = { id: "w1", name: "home1", memberIds: ["c1"], houses: [{ id: "h1", residentIds: ["c1"] }], relationships: [{ fromId: "c1", toId: "c2" }] };
  const w2: any = { id: "w2", name: "home2", memberIds: [], houses: [], relationships: [] };
  it("lists joinable homes", () => {
    expect(listJoinableHomes("c1", [w1, w2]).length).toBe(2);
    expect(listJoinableHomes("", [w1])).toEqual([]);
  });
  it("lists relation homes", () => {
    expect(listRelationHomes({ id: "r", homeId: "w1" } as any, [w1, w2]).length).toBe(1);
    expect(listRelationHomes({ id: "r" } as any, [w1])).toEqual([]);
  });
  it("sync adds and removes member with house cleanup", () => {
    const added = syncMemberFromRelationships(w2, "c9", ["w2"]);
    expect(added.memberIds).toContain("c9");
    const removed = syncMemberFromRelationships(w1, "c1", []);
    expect(removed.memberIds).not.toContain("c1");
    expect(removed.houses[0].residentIds).not.toContain("c1");
    expect(removed.relationships.length).toBe(0);
  });
  it("ensure link and clear stale", () => {
    const rels: any = [{ id: "r1", homeId: undefined }];
    expect(ensureRelationLink(rels, "r1", "w2")[0].homeId).toBe("w2");
    expect(clearStaleRelationHomes([{ id: "r1", homeId: "gone" } as any], [w1])[0].homeId).toBeUndefined();
  });
});
