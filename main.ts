// main.ts — the program the harness runs: `node /bot/main.ts` on Node 22, which strips the types
// natively (erasable syntax only). It reads every case from /input/cases.json (a JSON array of
// {id, markdown}), renders each one alone with parse() from parse.js, and writes /output/html.json:
// a JSON array of the HTML strings, one per case and in the cases' order.
//
// Outside a container MAKEFUN_INPUT_DIR and MAKEFUN_OUTPUT_DIR stand in for /input and /output.
// One pass, one array, no per-case state kept: parse() is called once per case and its answer is
// written straight into the output array.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from './parse.js';

interface Case {
  id: string;
  markdown: string;
}

const inputDir = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const cases = JSON.parse(readFileSync(join(inputDir, 'cases.json'), 'utf8')) as Case[];

const html: string[] = [];
for (const c of cases) {
  html.push(parse(c.markdown));
}

writeFileSync(join(outputDir, 'html.json'), JSON.stringify(html));
