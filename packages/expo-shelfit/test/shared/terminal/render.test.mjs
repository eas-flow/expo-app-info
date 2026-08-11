import { describe, expect, it } from 'vitest';
import {
  bold,
  dim,
  pad,
  renderTable,
  shouldUseColor,
  width,
} from '../../../src/shared/terminal/render.mjs';

describe('width', () => {
  it('counts ASCII as 1 column each', () => {
    expect(width('abc')).toBe(3);
  });

  it('counts Japanese (East Asian wide) characters as 2 columns', () => {
    expect(width('日本語')).toBe(6);
  });

  it('handles mixed ASCII and wide characters', () => {
    expect(width('ios日本')).toBe(3 + 4);
  });

  it('counts emoji as 2 columns', () => {
    expect(width('🚀')).toBe(2);
  });

  it('counts full-width punctuation as 2 columns', () => {
    expect(width('！')).toBe(2);
  });

  it('counts a ZWJ-joined emoji sequence (e.g. family emoji) as 2 columns, not per-component', () => {
    expect(width('👨‍👩‍👧')).toBe(2);
  });

  it('counts a variation-selector character the same as its base character', () => {
    expect(width('⚠️')).toBe(width('⚠'));
  });
});

describe('pad', () => {
  it('pads ASCII strings to the target width', () => {
    expect(pad('ab', 5)).toBe('ab   ');
  });

  it('accounts for wide-character width when padding', () => {
    expect(pad('日本', 6)).toBe('日本  ');
  });

  it('does not pad (or truncate) when already at/over width', () => {
    expect(pad('abcdef', 3)).toBe('abcdef');
  });
});

describe('dim / bold', () => {
  it('wraps text in ANSI codes when isTTY is true', () => {
    expect(dim('x', true)).toBe('\x1b[2mx\x1b[0m');
    expect(bold('x', true)).toBe('\x1b[1mx\x1b[0m');
  });

  it('returns plain text when isTTY is false', () => {
    expect(dim('x', false)).toBe('x');
    expect(bold('x', false)).toBe('x');
  });
});

describe('shouldUseColor', () => {
  it('disables color when NO_COLOR is set, even on a TTY', () => {
    expect(shouldUseColor({ NO_COLOR: '1' }, true)).toBe(false);
  });

  it('ignores an empty NO_COLOR and falls back to isTTY', () => {
    expect(shouldUseColor({ NO_COLOR: '' }, true)).toBe(true);
    expect(shouldUseColor({ NO_COLOR: '' }, false)).toBe(false);
  });

  it('forces color when FORCE_COLOR is set, even off a TTY', () => {
    expect(shouldUseColor({ FORCE_COLOR: '1' }, false)).toBe(true);
  });

  it('treats FORCE_COLOR=0 as disabled, not forced on', () => {
    expect(shouldUseColor({ FORCE_COLOR: '0' }, true)).toBe(true);
    expect(shouldUseColor({ FORCE_COLOR: '0' }, false)).toBe(false);
  });

  it('lets NO_COLOR win when both NO_COLOR and FORCE_COLOR are set', () => {
    expect(shouldUseColor({ NO_COLOR: '1', FORCE_COLOR: '1' }, true)).toBe(false);
  });

  it('falls back to isTTY when neither is set', () => {
    expect(shouldUseColor({}, true)).toBe(true);
    expect(shouldUseColor({}, false)).toBe(false);
  });
});

describe('renderTable', () => {
  it('computes column widths from headers and rows, non-TTY output has no ANSI codes', () => {
    const out = renderTable(['A', 'B'], [['1', '22']], { isTTY: false });
    expect(out.includes('\x1b[')).toBe(false);
    expect(out.split('\n')).toHaveLength(5); // top, header, sep, row, bottom
  });

  it('handles an empty row set', () => {
    const out = renderTable(['A', 'B'], [], { isTTY: false });
    expect(out.split('\n')).toHaveLength(4); // top, header, sep, bottom
  });

  it('widens columns to fit Japanese content', () => {
    const out = renderTable(['APP'], [['日本語アプリ']], { isTTY: false });
    const lines = out.split('\n');
    expect(lines.some((l) => l.includes('日本語アプリ'))).toBe(true);
  });

  it('treats missing cells as empty strings', () => {
    const out = renderTable(['A', 'B'], [['x', undefined]], { isTTY: false });
    expect(out).toContain('x');
  });

  it('does not throw RangeError on a large number of rows', () => {
    const rows = Array.from({ length: 200_000 }, (_, i) => [String(i)]);
    expect(() => renderTable(['A'], rows, { isTTY: false })).not.toThrow();
  });
});
