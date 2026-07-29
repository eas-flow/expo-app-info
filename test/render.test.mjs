import { describe, expect, it } from 'vitest';
import { bold, dim, pad, relativeDate, renderTable, width } from '../src/render.mjs';

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

  it('counts emoji as 1 column (outside the wide ranges checked)', () => {
    expect(width('🚀')).toBe(1);
  });

  it('counts full-width punctuation as 2 columns', () => {
    expect(width('！')).toBe(2);
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
});

describe('relativeDate', () => {
  const base = new Date('2026-07-29T00:00:00.000Z').getTime();

  it('returns "-" for a missing date', () => {
    expect(relativeDate(null, base)).toBe('-');
  });

  it('returns "today" for the same day (0 days)', () => {
    expect(relativeDate(new Date(base).toISOString(), base)).toBe('today');
  });

  it('returns "yesterday" for exactly 1 day ago', () => {
    const iso = new Date(base - 1 * 86_400_000).toISOString();
    expect(relativeDate(iso, base)).toBe('yesterday');
  });

  it('returns "Nd ago" just under the 30-day boundary', () => {
    const iso = new Date(base - 29 * 86_400_000).toISOString();
    expect(relativeDate(iso, base)).toBe('29d ago');
  });

  it('returns "Nmo ago" at the 30-day boundary', () => {
    const iso = new Date(base - 30 * 86_400_000).toISOString();
    expect(relativeDate(iso, base)).toBe('1mo ago');
  });

  it('returns "Nmo ago" just under the 365-day boundary', () => {
    const iso = new Date(base - 364 * 86_400_000).toISOString();
    expect(relativeDate(iso, base)).toBe('12mo ago');
  });

  it('returns "Ny ago" at the 365-day boundary', () => {
    const iso = new Date(base - 365 * 86_400_000).toISOString();
    expect(relativeDate(iso, base)).toBe('1y ago');
  });
});
