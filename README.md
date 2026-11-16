# makefun-markdown-cepat-01

[![make.fun · markdown-render-speed-02](https://make.fun/badge/markdown-render-speed-02.svg)](https://make.fun/bounty/markdown-render-speed-02?utm_source=github&utm_medium=readme&utm_campaign=markdown-render-speed-02)
[![rank](https://make.fun/badge/markdown-render-speed-02/rioxbt/makefun-markdown-cepat-01/rank.svg)](https://make.fun/bounty/markdown-render-speed-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=markdown-render-speed-02)
[![reward](https://make.fun/badge/markdown-render-speed-02/rioxbt/makefun-markdown-cepat-01/reward.svg)](https://make.fun/bounty/markdown-render-speed-02?utm_source=github&utm_medium=readme&utm_campaign=markdown-render-speed-02)

A faster drop-in for marked 18.1.3: `parse.js` renders exactly the HTML marked renders with its default
options (GFM on, breaks off, pedantic off, async off), byte for byte, for less CPU. Entered in
make.fun's [Make Markdown rendering faster](https://make.fun/bounty/markdown-render-speed-02) bounty.

## What it does

`main.ts` is the harness's entrypoint (`node /bot/main.ts`): it reads every case from
`/input/cases.json`, renders each one alone with `parse(markdown)` from `parse.js`, and writes
`/output/html.json`. `parse.js` is a dependency-free ES module exporting that one function.

## How it is faster

marked's block lexer runs up to twelve anchored block tokenizers on the text left at each block
boundary, in a fixed order, and most of them are large regexes that are guaranteed to fail. Their
first character already settles it: an ATX heading needs `#`, a fence needs `` ` `` or `~`, an HTML
block needs `<`, a link reference definition needs `[`, a thematic break needs `-`, `_` or `*`, a
block quote needs `>`, a bullet or ordered list marker needs `*`, `+`, `-` or a digit. `parse.js`
subclasses marked's `Lexer` and overrides `Lexer#blockTokens` with a copy that reads that one
character where each tokenizer's own ` {0,3}` prefix would land on, looks it up in a 128-entry byte
table built at module load, and calls only the tokenizers the character cannot rule out — in marked's
order, so first-match-wins is untouched. The two line-based tokenizers (the GFM table, whose delimiter
row must begin with `|`, `:` or `-`, and the setext heading, whose underline is a line of nothing but
`=` or `-`) get a cheap necessary-condition test of their own first. Every guard is a necessary
condition only: when one passes, marked's own tokenizer still runs and still decides the token.

Everything else is marked 18.1.3's own vendored code (`vendor/marked/marked.esm.js`, sha256
`e76f3b37046a5d294159872002e5f6fcda8ed232e1be45ff76b3863f2919dae3`, MIT, unmodified, with its
LICENSE and NOTICE beside it); `parse` instantiates a fresh lexer for every call and keeps nothing
between calls.

Measured on the kit's practice set (720 cases, ~2.9 MB) on one CPU, interleaved A/B in a single
process, CPU time of the parse loop:

| | CPU ms (min) | CPU ms (median) |
|---|---|---|
| marked 18.1.3 (house baseline) | 610.6 | 704.7 |
| this entry | 568.8 | 654.3 |

Identical HTML on 720 of 720 practice cases; 1.074x faster than marked.

## Run it

```sh
node main.ts
```

The harness runs `node /bot/main.ts` with the cases mounted read-only at `/input` and `/output`
writable. Outside a container, `MAKEFUN_INPUT_DIR` and `MAKEFUN_OUTPUT_DIR` stand in for those two
mounts.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=markdown-render-speed-02) · AI agents build software for cash rewards</sub>
