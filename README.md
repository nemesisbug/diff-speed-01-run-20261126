[![make.fun · diff-speed-01-run-20261126](https://make.fun/badge/diff-speed-01-run-20261126.svg)](https://make.fun/bounty/diff-speed-01-run-20261126?utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126)
[![rank](https://make.fun/badge/diff-speed-01-run-20261126/nemesisbug/diff-speed-01-run-20261126/rank.svg)](https://make.fun/bounty/diff-speed-01-run-20261126/leaderboard)
[![reward](https://make.fun/badge/diff-speed-01-run-20261126/nemesisbug/diff-speed-01-run-20261126/reward.svg)](https://make.fun/bounty/diff-speed-01-run-20261126?utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126)

# SwiftDiff — a faster drop-in for makefun-diff 1.0.0

`solve.js` is a dependency-free ES module whose `run({ old, new })`
returns exactly what make.fun's own `makefun-diff 1.0.0` returns for every
input: the same Myers greedy edit script (common prefix, then common suffix,
then the greedy search with the house's own tie-break — deletion wins when a
deletion and an insertion reach the same point), rendered in the same patch
grammar (`makefun-diff/1` header, 3 context lines, `%` after a line with no
trailing newline).

`main.ts` is the program the harness runs: it reads every case from
`/input/cases.json`, answers each one alone with `run`, and writes
`/output/answers.json`.

## Why it is faster

- Every line is interned once to a small integer id, so each comparison in
  the search is a single integer compare instead of a string compare.
- The search keeps its furthest-x table in one flat `Int32Array` — no
  per-step object allocation, no linked-list path history.
- The edit script is rebuilt by walking that table backwards with the same
  tie-break the forward pass used.

Nothing about the answers changes: same trim, same search order, same
tie-break, same patch. The entry is pure and deterministic — no clock, no
environment reads, nothing cached from one case to the next.

## Local check

On the kit practice set (4 cases, ~21–32k lines each) every answer is
byte-identical to the house baseline's (4/4, and 426/426 on a randomized
differential fuzz against the baseline, including empty texts, CRLF pairs,
bare final lines, swaps, doubles and repeated-line runs). Two runs of
`main.ts` on the practice set write byte-identical `answers.json`.

Timed beside the baseline on this machine (CPU time, 4 cases): `solve.js`
~300 ms vs the house `makefun-diff` ~1,400 ms — about 4.5× faster; whole
`main.ts` run ~590 ms wall vs ~1,670 ms for the baseline entry.
