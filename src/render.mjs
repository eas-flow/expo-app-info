// Table rendering, column width, and relative-date helpers.
// Kept dependency-free and pure so they are easy to unit test.

/** Display width, counting East Asian wide characters as 2 columns. */
export function width(str) {
  let w = 0;
  for (const ch of String(str)) {
    const c = ch.codePointAt(0);
    const wide =
      (c >= 0x1100 && c <= 0x115f) ||
      (c >= 0x2e80 && c <= 0xa4cf) ||
      (c >= 0xac00 && c <= 0xd7a3) ||
      (c >= 0xf900 && c <= 0xfaff) ||
      (c >= 0xfe30 && c <= 0xfe6f) ||
      (c >= 0xff00 && c <= 0xff60) ||
      (c >= 0xffe0 && c <= 0xffe6);
    w += wide ? 2 : 1;
  }
  return w;
}

export const pad = (str, len) => str + ' '.repeat(Math.max(0, len - width(str)));

/** ANSI dim. `isTTY` is threaded through explicitly so this is testable without a real TTY. */
export function dim(s, isTTY = process.stdout.isTTY) {
  return isTTY ? `\x1b[2m${s}\x1b[0m` : s;
}

/** ANSI bold. See `dim` for why `isTTY` is a parameter. */
export function bold(s, isTTY = process.stdout.isTTY) {
  return isTTY ? `\x1b[1m${s}\x1b[0m` : s;
}

export function renderTable(headers, rows, { isTTY = process.stdout.isTTY } = {}) {
  const widths = headers.map((h, i) => Math.max(width(h), ...rows.map((r) => width(r[i] ?? ''))));
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

/** `now` is a parameter (default `Date.now()`) so boundary days can be tested deterministically. */
export function relativeDate(iso, now = Date.now()) {
  if (!iso) return '-';
  const days = Math.floor((now - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}
