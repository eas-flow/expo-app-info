// Kept dependency-free and pure so they are easy to unit test.

// East Asian Wide characters and the main emoji blocks -> 2 columns.
const WIDE_RANGES = [
  [0x1100, 0x115f],
  [0x2e80, 0xa4cf],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe30, 0xfe6f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x1f300, 0x1f64f], // emoji: pictographs / emoticons
  [0x1f680, 0x1f6ff], // emoji: transport & map symbols
  [0x1f900, 0x1f9ff], // emoji: supplemental symbols & pictographs
];

// Combining marks and variation selectors render on top of the previous
// glyph rather than taking their own column -> 0 columns.
const ZERO_WIDTH_RANGES = [
  [0x0300, 0x036f], // combining diacritics
  [0xfe00, 0xfe0f], // variation selectors
];

const ZWJ = 0x200d;

const inRanges = (c, ranges) => ranges.some(([lo, hi]) => c >= lo && c <= hi);

/**
 * ZWJ-joined sequences (family emoji and the like) are approximated by
 * treating the codepoint after a ZWJ as already counted — not real
 * grapheme-cluster segmentation, but enough to keep a joined emoji at 2
 * columns instead of ballooning per component.
 */
export function width(str) {
  let w = 0;
  let afterZWJ = false;
  for (const ch of String(str)) {
    const c = ch.codePointAt(0);
    if (c === ZWJ) {
      afterZWJ = true;
      continue;
    }
    if (afterZWJ) {
      afterZWJ = false;
      continue;
    }
    if (inRanges(c, ZERO_WIDTH_RANGES)) continue;
    w += inRanges(c, WIDE_RANGES) ? 2 : 1;
  }
  return w;
}

export const pad = (str, len) => str + ' '.repeat(Math.max(0, len - width(str)));

/**
 * Whether to emit ANSI color, per the no-color.org convention: NO_COLOR (any
 * non-empty value) disables color outright and wins over FORCE_COLOR;
 * FORCE_COLOR (any value other than "0") forces color on even off a TTY;
 * otherwise it follows isTTY. Treated as a plain boolean rather than a 0-3
 * level, since dim/bold are the only two effects this CLI ever emits.
 */
export function shouldUseColor(env = process.env, isTTY = process.stdout.isTTY) {
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== '') return false;
  if (env.FORCE_COLOR !== undefined && env.FORCE_COLOR !== '0') return true;
  return Boolean(isTTY);
}

/** ANSI dim. `isTTY` is threaded through explicitly so this is testable without a real TTY. */
export function dim(s, isTTY = shouldUseColor()) {
  return isTTY ? `\x1b[2m${s}\x1b[0m` : s;
}

/** ANSI bold. See `dim` for why `isTTY` is a parameter. */
export function bold(s, isTTY = shouldUseColor()) {
  return isTTY ? `\x1b[1m${s}\x1b[0m` : s;
}

// Single pass over rows rather than Math.max(...rows.map(...)) per column,
// which turns row count into Math.max's argument count and blows the call
// stack on large tables.
function computeWidths(headers, rows) {
  const widths = headers.map((h) => width(h));
  for (const row of rows) {
    for (let i = 0; i < widths.length; i++) {
      const w = width(row[i] ?? '');
      if (w > widths[i]) widths[i] = w;
    }
  }
  return widths;
}

export function renderTable(headers, rows, { isTTY = shouldUseColor() } = {}) {
  const widths = computeWidths(headers, rows);
  const line = (l, m, r) => dim(l + widths.map((w) => '─'.repeat(w + 2)).join(m) + r, isTTY);

  const out = [];
  out.push(line('┌', '┬', '┐'));
  out.push(
    dim('│', isTTY) +
      headers.map((h, i) => ` ${bold(pad(h, widths[i]), isTTY)} `).join(dim('│', isTTY)) +
      dim('│', isTTY)
  );
  out.push(line('├', '┼', '┤'));
  for (const row of rows) {
    out.push(
      dim('│', isTTY) +
        row.map((c, i) => ` ${pad(c ?? '', widths[i])} `).join(dim('│', isTTY)) +
        dim('│', isTTY)
    );
  }
  out.push(line('└', '┴', '┘'));
  return out.join('\n');
}
