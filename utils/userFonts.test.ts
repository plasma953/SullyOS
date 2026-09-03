import { describe, expect, it } from 'vitest';
import {
  buildUserFontCss,
  createUserFont,
  fontAssetId,
  fontFormatFromFileName,
  formatFontSize,
  magicMatchesFormat,
  migrateLegacyCustomFont,
  stripUserFontsForLS,
  userFontFamily,
  type ValidatedFontFile,
} from './userFonts';
import type { UserFont } from '../types';

const mkFont = (over: Partial<UserFont> = {}): UserFont => ({
  id: 'f1',
  name: 'TestFont',
  format: 'ttf',
  dataUrl: 'data:font/ttf;base64,AAA',
  sizeBytes: 12345,
  createdAt: 1,
  ...over,
});

describe('fontFormatFromFileName', () => {
  it('accepts ttf/otf/woff/woff2 case-insensitively', () => {
    expect(fontFormatFromFileName('a.ttf')).toBe('ttf');
    expect(fontFormatFromFileName('a.OTF')).toBe('otf');
    expect(fontFormatFromFileName('a.Woff')).toBe('woff');
    expect(fontFormatFromFileName('a.woff2')).toBe('woff2');
  });
  it('ignores query/hash suffix', () => {
    expect(fontFormatFromFileName('a.woff2?v=2')).toBe('woff2');
  });
  it('rejects ttc/png/empty', () => {
    expect(fontFormatFromFileName('a.ttc')).toBeNull();
    expect(fontFormatFromFileName('a.png')).toBeNull();
    expect(fontFormatFromFileName('noext')).toBeNull();
  });
});

describe('magicMatchesFormat', () => {
  it('matches known magic bytes', () => {
    expect(magicMatchesFormat('00010000', 'ttf')).toBe(true);
    expect(magicMatchesFormat('4f54544f', 'otf')).toBe(true);
    expect(magicMatchesFormat('774f4646', 'woff')).toBe(true);
    expect(magicMatchesFormat('774f4632', 'woff2')).toBe(true);
  });
  it('rejects cross-format magic', () => {
    expect(magicMatchesFormat('774f4646', 'ttf')).toBe(false);
    expect(magicMatchesFormat('00010000', 'woff2')).toBe(false);
    expect(magicMatchesFormat('deadbeef', 'ttf')).toBe(false);
  });
});

describe('formatFontSize', () => {
  it('formats B/KB/MB', () => {
    expect(formatFontSize(512)).toBe('512 B');
    expect(formatFontSize(2048)).toBe('2.0 KB');
    expect(formatFontSize(3 * 1024 * 1024)).toBe('3.00 MB');
  });
  it('handles non-positive', () => {
    expect(formatFontSize(0)).toBe('-');
    expect(formatFontSize(-1)).toBe('-');
  });
});

describe('ids and css', () => {
  it('prefixes asset id and family', () => {
    expect(fontAssetId('abc')).toBe('font_abc');
    expect(userFontFamily('abc')).toBe('UserFont_abc');
  });
  it('empty library yields fallback only', () => {
    const css = buildUserFontCss([], undefined);
    expect(css).not.toContain('@font-face');
    expect(css).toContain('--app-font-family');
  });
  it('emits one face per font and points root at active', () => {
    const a = mkFont({ id: 'a' });
    const b = mkFont({ id: 'b', format: 'woff2', dataUrl: 'https://x/y.woff2' });
    const css = buildUserFontCss([a, b], 'b');
    expect(css.match(/@font-face/g)?.length).toBe(2);
    expect(css).toContain('UserFont_b');
  });
  it('falls back when active id missing', () => {
    const css = buildUserFontCss([mkFont()], 'nope');
    expect(css).toContain('@font-face');
    expect(css).not.toContain('UserFont_nope');
  });
});

describe('stripUserFontsForLS', () => {
  it('strips data: urls but keeps http', () => {
    const out = stripUserFontsForLS([
      mkFont({ dataUrl: 'data:font/ttf;base64,AAA' }),
      mkFont({ id: 'w', dataUrl: 'https://x/y.woff' }),
    ])!;
    expect(out[0].dataUrl).toBe('');
    expect(out[1].dataUrl).toBe('https://x/y.woff');
  });
  it('passes through undefined', () => {
    expect(stripUserFontsForLS(undefined)).toBeUndefined();
  });
});

describe('migrateLegacyCustomFont', () => {
  it('returns null for empty', () => {
    expect(migrateLegacyCustomFont(undefined)).toBeNull();
  });
  it('wraps data url with detected format', () => {
    const m = migrateLegacyCustomFont('data:font/woff2;base64,AAA')!;
    expect(m.format).toBe('woff2');
    expect(m.dataUrl.startsWith('data:')).toBe(true);
  });
  it('wraps http url with name from path', () => {
    const m = migrateLegacyCustomFont('https://cdn/x/myfont.otf')!;
    expect(m.format).toBe('otf');
    expect(m.name).toContain('myfont');
  });
});

describe('createUserFont', () => {
  it('assigns unique ids', () => {
    const v: ValidatedFontFile = { format: 'ttf', dataUrl: 'data:font/ttf;base64,AAA', sizeBytes: 10, name: 'N' };
    const a = createUserFont(v);
    const b = createUserFont(v);
    expect(a.id).not.toBe(b.id);
    expect(a.name).toBe('N');
  });
});
