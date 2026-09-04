// Pomodoro wiring guard (source-level, same style as amsg2ChatLoop.wiring.test.ts).
// vitest runs in pure Node without jsdom, so React screens cannot mount here.
// This only guards against the wiring being dropped: AppID registration,
// desktop icon, PhoneShell render path, and the unified chat payload hook
// that keeps all three LLM paths aware of a live focus run.
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
const payload = read('./chatRequestPayload.ts');

describe('pomodoro app registration', () => {
  it('AppID has Pomodoro', () => {
    expect(types).toContain("Pomodoro = 'pomodoro'");
  });

  it('desktop has Pomodoro icon and entry', () => {
    expect(constants).toContain('Pomodoro:');
    expect(constants).toContain('AppID.Pomodoro');
  });

  it('PhoneShell lazy-loads, maps and renders PomodoroApp', () => {
    expect(shell).toContain("import('../apps/PomodoroApp')");
    expect(shell).toContain('[AppID.Pomodoro]: PomodoroApp');
    expect(shell).toContain('case AppID.Pomodoro: return <PomodoroApp />;');
  });
});

describe('pomodoro chat ordering guard', () => {
  it('unified payload imports the pomodoro block builder', () => {
    expect(payload).toContain("from './pomodoroContextBlock'");
  });

  it('volatile tail includes the live focus state', () => {
    expect(payload).toMatch(/buildPomodoroContextBlock\(userProfile\?\.name/);
  });
});
