import type { RelationshipProfile, WorldProfile } from '../types';

export function listJoinableHomes(charId: string, worlds: WorldProfile[], _groups?: unknown): WorldProfile[] {
  if (!charId || !Array.isArray(worlds)) return [];
  return worlds.filter((w) => w && typeof w.id === 'string');
}

export function listRelationHomes(rel: RelationshipProfile | null | undefined, worlds: WorldProfile[]): WorldProfile[] {
  if (!rel || !rel.homeId || !Array.isArray(worlds)) return [];
  const w = worlds.find((x) => x && x.id === rel.homeId);
  return w ? [w] : [];
}

export function getRelationHomeName(rel: RelationshipProfile | null | undefined, worlds: WorldProfile[]): string {
  const list = listRelationHomes(rel, worlds);
  return list.length > 0 ? list[0].name : '';
}

export function syncMemberFromRelationships(world: WorldProfile, charId: string, relHomeIds: Array<string | undefined>): WorldProfile {
  if (!world || !charId) return world;
  const wantsIn = (relHomeIds || []).some((id) => id === world.id);
  const has = (world.memberIds || []).includes(charId);
  if (wantsIn && !has) {
    return { ...world, memberIds: [...(world.memberIds || []), charId] };
  }
  if (!wantsIn && has) {
    return {
      ...world,
      memberIds: (world.memberIds || []).filter((m) => m !== charId),
      houses: (world.houses || []).map((h) => ({ ...h, residentIds: (h.residentIds || []).filter((r) => r !== charId) })),
      relationships: (world.relationships || []).filter((r) => (r as { fromId?: string }).fromId !== charId && (r as { toId?: string }).toId !== charId),
    };
  }
  return world;
}

export function ensureRelationLink(rels: RelationshipProfile[], relId: string, homeId: string | undefined): RelationshipProfile[] {
  if (!Array.isArray(rels)) return [];
  return rels.map((r) => (r.id === relId ? { ...r, homeId } : r));
}

export function clearStaleRelationHomes(rels: RelationshipProfile[], worlds: WorldProfile[]): RelationshipProfile[] {
  if (!Array.isArray(rels)) return [];
  const ids = new Set((worlds || []).map((w) => w.id));
  return rels.map((r) => (r.homeId && !ids.has(r.homeId) ? { ...r, homeId: undefined } : r));
}
