// Tarot wiring guard (source-level, same style as pomodoroWiring.test.ts).
// vitest runs in pure Node without jsdom, so React screens cannot mount here.
// This only guards against the wiring being dropped: AppID registration,
// desktop icon, PhoneShell render path, safe-area self-handling, and the
// IndexedDB store + accessors for reading history.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel: string): string => readFileSync(
  fileURLToPath(new URL(rel, import.meta.url)),
  'utf8',
);

const types = read('../types.ts');
const constants = read('../constants.tsx');
const shell = read('../components/PhoneShell.tsx');
const safeArea = read('./safeAreaApps.ts');
const db = read('./db.ts');

describe('tarot app registration', () => {
  it('AppID has Tarot', () => {
    expect(types).toContain("Tarot = 'tarot'");
  });

  it('desktop has Tarot icon and entry', () => {
    expect(constants).toContain('Tarot:');
    expect(constants).toContain('AppID.Tarot');
  });

  it('PhoneShell lazy-loads, maps and renders TarotApp', () => {
    expect(shell).toContain("import('../apps/TarotApp')");
    expect(shell).toContain('[AppID.Tarot]: TarotApp');
    expect(shell).toContain('case AppID.Tarot: return <TarotApp />;');
  });

  it('Tarot handles its own safe area', () => {
    expect(safeArea).toContain('AppID.Tarot');
  });
});

describe('tarot reading store', () => {
  it('db has the tarot_readings store and accessors', () => {
    expect(db).toContain('tarot_readings');
    expect(db).toContain('getTarotReadings');
    expect(db).toContain('saveTarotReading');
    expect(db).toContain('deleteTarotReading');
  });
});
