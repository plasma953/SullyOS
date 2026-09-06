import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { CARDS } from './tarotData';

describe('tarot image contract', () => {
  it('ships one bundled image per card (scripts/fetch-tarot-images.mjs)', () => {
    const dir = path.join(process.cwd(), 'public', 'tarot', 'rws');
    const missing = CARDS.map((c) => c.id).filter(
      (id) => !fs.existsSync(path.join(dir, `${id}.jpg`)),
    );
    expect(missing).toEqual([]);
  });
});
