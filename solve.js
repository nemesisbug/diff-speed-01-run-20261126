// Fast drop-in for makefun-diff 1.0.0 (make.fun's own line diff).
//
// Returns exactly what makefun-diff 1.0.0 returns for every { old, new }:
// the same common-prefix / common-suffix trim, the same Myers greedy search
// (furthest into the old text on each diagonal, deletion wins a tie, no edge
// pruning, every equal run followed as far as it goes, first path to reach
// both ends wins), and the same patch grammar (makefun-diff/1 header, 3
// context lines, "%" after a line with no trailing newline).
//
// Speed comes from three changes over the reference, none of which changes
// an answer: lines are interned once to small integer codes (one integer per
// line, its text id doubled plus its newline flag, so every line comparison
// in the search is one integer compare), the search keeps its furthest-x
// table in one typed-array row per edit distance (no per-step object
// allocation, no copying as it grows), and the edit script is rebuilt by
// walking that table backwards with the same tie-break the forward pass used
// (no linked-list path history). The hot loop holds no closures, so its
// locals stay on the stack.
//
// Pure and deterministic: no clock, no environment reads, nothing cached
// from one case to the next; every structure is built fresh inside run().

const FORMAT = 'makefun-diff/1';
const CONTEXT = 3;
const KEEP = 0;
const DELETE = 1;
const INSERT = 2;

/** makefun-diff 1.0.0's answer for one case's input. */
export function run(input) {
  if (input === null || typeof input !== 'object' || typeof input.old !== 'string' || typeof input.new !== 'string') {
    throw new TypeError('makefun-diff: the input is { old, new }, two strings');
  }

  // ---- lines: split once, intern each distinct line text to a code ----
  // A line's code is its text's id doubled, plus 1 when the line ends in
  // '\n': two lines are equal only when their codes match (a last line with
  // no '\n' is a different line from the same text with one). One shared
  // table for both texts, so equal lines share a code.
  const aParts = input.old.split('\n');
  const bParts = input.new.split('\n');
  const aLast = aParts.length - 1;
  const bLast = bParts.length - 1;
  const n = aLast + (aParts[aLast] !== '' ? 1 : 0);
  const m = bLast + (bParts[bLast] !== '' ? 1 : 0);
  const ids = new Map();
  const aC = new Int32Array(n);
  const bC = new Int32Array(m);
  for (let i = 0; i < n; i++) {
    const s = aParts[i];
    let id = ids.get(s);
    if (id === undefined) { id = ids.size; ids.set(s, id); }
    aC[i] = id * 2 + (i < aLast ? 1 : 0);
  }
  for (let j = 0; j < m; j++) {
    const s = bParts[j];
    let id = ids.get(s);
    if (id === undefined) { id = ids.size; ids.set(s, id); }
    bC[j] = id * 2 + (j < bLast ? 1 : 0);
  }

  // ---- common prefix, then common suffix of what is left ----
  let prefix = 0;
  while (prefix < n && prefix < m && aC[prefix] === bC[prefix]) prefix++;
  let suffix = 0;
  while (suffix < n - prefix && suffix < m - prefix && aC[n - 1 - suffix] === bC[m - 1 - suffix]) suffix++;

  // ---- Myers greedy search over the middle ----
  const N = n - prefix - suffix;
  const M = m - prefix - suffix;
  // Views over the middle, so the hot loop indexes them directly.
  const aS = aC.subarray(prefix, prefix + N);
  const bS = bC.subarray(prefix, prefix + M);
  // V[d] is one row of 2d+1 entries, index j = k + d: it holds the old lines
  // consumed after d edits and the snake on diagonal k; NONE means
  // unreachable. One row per d, so the table costs exactly what the search
  // writes and never copies. Rows are Uint16 (an old-line count here is at
  // most the generator's 40,000 lines) with an Int32 fallback for safety;
  // only even indexes are ever read or written, so no fill is needed.
  const Row = N < 65535 ? Uint16Array : Int32Array;
  const NONE = N < 65535 ? 0xFFFF : -1;
  const rows = [];
  let x = 0;
  let y = 0;
  while (x < N && y < M && aS[x] === bS[y]) { x++; y++; }
  const row0 = new Row(1);
  row0[0] = x;
  rows.push(row0);
  let D = 0;
  let kF = 0;
  if (!(x >= N && y >= M)) {
    outer: for (let d = 1; ; d++) {
      const prev = rows[d - 1];
      const cur = new Row(2 * d + 1);
      rows.push(cur);
      // k = -d: deletion impossible, insertion only (predecessor k+1 = -(d-1), at index 0 of prev).
      {
        const xi = prev[0];
        let xv = NONE;
        if (xi !== NONE && xi + d <= M) {
          xv = xi;
          let yv = xv + d;
          while (xv < N && yv < M && aS[xv] === bS[yv]) { xv++; yv++; }
          if (xv >= N && yv >= M) { D = d; kF = -d; break outer; }
        }
        cur[0] = xv;
      }
      // Interior diagonals: both predecessors exist.
      // j = k + d runs 2, 4, ... 2d-2; prev index for k-1 is j-2, for k+1 is j.
      for (let j = 2, k = -d + 2; k <= d - 2; j += 2, k += 2) {
        const xd = prev[j - 2];
        const xi = prev[j];
        let xv;
        if (xd !== NONE && xd < N) {
          // Deletion is possible; it wins unless the insertion alone reaches further.
          xv = (xi !== NONE && xi - k <= M && xi - 1 > xd) ? xi : xd + 1;
        } else if (xi !== NONE && xi - k <= M) {
          xv = xi;
        } else {
          cur[j] = NONE;
          continue;
        }
        let yv = xv - k;
        while (xv < N && yv < M && aS[xv] === bS[yv]) { xv++; yv++; }
        cur[j] = xv;
        if (xv >= N && yv >= M) { D = d; kF = k; break outer; }
      }
      // k = d: insertion impossible, deletion only (predecessor k-1 = d-1, at index 2d-2 of prev).
      {
        const xd = prev[2 * d - 2];
        let xv = NONE;
        if (xd !== NONE && xd < N) {
          xv = xd + 1;
          let yv = xv - d;
          while (xv < N && yv < M && aS[xv] === bS[yv]) { xv++; yv++; }
          if (xv >= N && yv >= M) { D = d; kF = d; break outer; }
        }
        cur[2 * d] = xv;
      }
    }
  }

  // ---- rebuild the middle's runs by walking V backwards ----
  // Reversed: each step contributes its snake (KEEP) then its one edit.
  const rev = [];
  {
    let cx = N;
    let k = kF;
    for (let d = D; d >= 1; d--) {
      const prev = rows[d - 1];
      let xd = NONE;
      let xi = NONE;
      if (k - 1 >= -(d - 1)) xd = prev[(k - 1) + (d - 1)];
      if (k + 1 <= d - 1) xi = prev[(k + 1) + (d - 1)];
      const canDel = xd !== NONE && xd < N;
      const canIns = xi !== NONE && xi - k <= M;
      // The same tie-break as the forward pass: deletion wins unless the
      // insertion alone reaches strictly further into the old text.
      const del = canDel && (!canIns || xd >= xi - 1);
      const xPre = del ? xd + 1 : xi;
      const keep = cx - xPre;
      if (keep > 0) rev.push([KEEP, keep]);
      rev.push([del ? DELETE : INSERT, 1]);
      if (del) { cx = xPre - 1; k = k - 1; }
      else { cx = xPre; k = k + 1; }
    }
    if (cx > 0) rev.push([KEEP, cx]);
  }
  // Forward order, merging neighbouring runs of one kind.
  const runs = [];
  if (prefix > 0) runs.push([KEEP, prefix]);
  for (let i = rev.length - 1; i >= 0; i--) {
    const r = rev[i];
    const last = runs[runs.length - 1];
    if (last !== undefined && last[0] === r[0]) last[1] += r[1];
    else runs.push([r[0], r[1]]);
  }
  if (suffix > 0) {
    const last = runs[runs.length - 1];
    if (last !== undefined && last[0] === KEEP) last[1] += suffix;
    else runs.push([KEEP, suffix]);
  }

  // ---- the patch: change runs, then hunks of at most 6 kept lines apart ----
  const changes = [];
  let o = 0;
  let p = 0;
  let deleted = 0;
  let inserted = 0;
  for (let t = 0; t < runs.length; t++) {
    const r = runs[t];
    if (r[0] === KEEP) { o += r[1]; p += r[1]; continue; }
    let c = changes[changes.length - 1];
    if (c === undefined || c.o + c.dels !== o || c.p + c.ins !== p) {
      c = { o, p, dels: 0, ins: 0 };
      changes.push(c);
    }
    if (r[0] === DELETE) { c.dels += r[1]; o += r[1]; deleted += r[1]; }
    else { c.ins += r[1]; p += r[1]; inserted += r[1]; }
  }
  const hunks = [];
  for (let t = 0; t < changes.length; t++) {
    const c = changes[t];
    const h = hunks[hunks.length - 1];
    const prev = h !== undefined ? h[h.length - 1] : undefined;
    if (prev !== undefined && c.o - (prev.o + prev.dels) <= 2 * CONTEXT) h.push(c);
    else hunks.push([c]);
  }

  const out = [`${FORMAT} old=${n} new=${m} hunks=${hunks.length} deleted=${deleted} inserted=${inserted}\n`];
  for (let hi = 0; hi < hunks.length; hi++) {
    const h = hunks[hi];
    const first = h[0];
    const last = h[h.length - 1];
    const oldStart = Math.max(0, first.o - CONTEXT);
    const newStart = first.p - (first.o - oldStart);
    const after = Math.min(CONTEXT, n - (last.o + last.dels));
    const oldEnd = last.o + last.dels + after;
    const newEnd = last.p + last.ins + after;
    out.push(`@ ${oldStart + 1} ${oldEnd - oldStart} ${newStart + 1} ${newEnd - newStart}\n`);
    let at = oldStart;
    for (let ci = 0; ci < h.length; ci++) {
      const c = h[ci];
      for (; at < c.o; at++) out.push('=', aParts[at], at < aLast ? '\n' : '\n%\n');
      for (let i = 0; i < c.dels; i++) { const li = c.o + i; out.push('-', aParts[li], li < aLast ? '\n' : '\n%\n'); }
      for (let i = 0; i < c.ins; i++) { const li = c.p + i; out.push('+', bParts[li], li < bLast ? '\n' : '\n%\n'); }
      at = c.o + c.dels;
    }
    for (; at < oldEnd; at++) out.push('=', aParts[at], at < aLast ? '\n' : '\n%\n');
  }
  return out.join('');
}
