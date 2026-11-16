// parse.js — a faster drop-in for marked 18.1.3 (MIT).
//
// parse(markdown) returns exactly the HTML marked 18.1.3's marked.parse(markdown) returns with marked's
// default options (gfm true, breaks false, pedantic false, async false), byte for byte.
//
// How it is faster than the house baseline without changing a single byte of output: marked's block
// lexer tries up to twelve anchored block tokenizers on the text left at each block boundary, in a fixed
// order, and most of them are huge regexes that are guaranteed to fail. Their first character already
// settles it: an ATX heading needs `#`, a fence needs `` ` `` or `~`, an HTML block needs `<`, a link
// reference definition needs `[`, a thematic break needs `-`, `_` or `*`, a block quote needs `>`, a
// bullet or ordered list marker needs `*`, `+`, `-` or a digit. So this lexer reads that one character
// at the position the tokenizer's own ` {0,3}` prefix would land on, looks it up in a 128-entry byte
// table built at module load, and only calls the tokenizers the character cannot rule out — in marked's
// order, so first-match-wins is untouched. The two tokenizers that are line-based rather than
// first-character-based (the GFM table, whose delimiter row must start with `|`, `:` or `-`, and the
// setext heading, which needs a whole line of `=` or `-`) get a cheap necessary-condition test of their
// own before their regexes are run.
//
// Everything else — every tokenizer, the inline lexer, the parser, the renderer — is marked 18.1.3's own
// vendored code (vendor/marked/marked.esm.js, sha256 e76f3b37…9dae3, MIT), unchanged. This module only
// replaces Lexer#blockTokens with a guarded copy of it. The guards are necessary conditions only: when
// one passes, marked's own tokenizer still runs and still decides. `parse` instantiates a fresh lexer
// for every call and keeps nothing between calls.

import { Lexer, Parser, getDefaults } from './vendor/marked/marked.esm.js';

// marked's defaults, shared the way marked shares its own: the lexer and the parser fill in the
// tokenizer and the renderer on this object once and reuse them (marked does the same to its defaults).
const OPTIONS = getDefaults();

const NL = 10; // \n
const TAB = 9; // \t
const SP = 32; // ' '

// One character's worth of "which block tokenizers can still match here". The bits are in marked's own
// tokenizer order, so dispatching on the mask preserves first-match-wins.
const T_FENCES = 1;
const T_HEADING = 2;
const T_HR = 4;
const T_BLOCKQUOTE = 8;
const T_LIST = 16;
const T_HTML = 32;
const T_DEF = 64;

const FIRST = new Uint8Array(128);
FIRST[96] = T_FENCES; // `
FIRST[126] = T_FENCES; // ~
FIRST[35] = T_HEADING; // #
FIRST[45] = T_HR | T_LIST; // -
FIRST[95] = T_HR; // _
FIRST[42] = T_HR | T_LIST; // *
FIRST[62] = T_BLOCKQUOTE; // >
FIRST[43] = T_LIST; // +
for (let d = 48; d <= 57; d++) FIRST[d] = T_LIST; // 0-9
FIRST[60] = T_HTML; // <
FIRST[91] = T_DEF; // [

// A setext heading needs a line that is nothing but `=` or `-`. Its body cannot cross a blank line
// (marked's own content run excludes a newline followed by a whitespace-only line), so the scan for
// that line stops at the first blank one and stays proportional to the paragraph, not the document.
function hasSetextUnderline(text, firstNewline) {
  const len = text.length;
  if (firstNewline === -1) return false;
  let start = firstNewline + 1;
  while (start < len) {
    let end = text.indexOf('\n', start);
    if (end === -1) end = len;
    let first = -1;
    for (let e = start; e < end; e++) {
      const cc = text.charCodeAt(e);
      if (cc !== 32 && cc !== 9) {
        first = e;
        break;
      }
    }
    if (first === -1) return false; // blank line: no setext heading can reach past it
    const c = text.charCodeAt(first);
    if (c === CS_EQUALS || c === CS_DASH) {
      let e = first;
      while (e < end && text.charCodeAt(e) === c) e++;
      let only = true;
      for (let x = e; x < end; x++) {
        const cc = text.charCodeAt(x);
        if (cc !== CS_SP && cc !== CS_TAB) {
          only = false;
          break;
        }
      }
      if (only) return true;
    }
    start = end + 1;
  }
  return false;
}

const CS_NL = 10;
const CS_SP = 32;
const CS_TAB = 9;
const CS_PIPE = 124;
const CS_COLON = 58;
const CS_DASH = 45;
const CS_EQUALS = 61;

/** marked's Lexer#blockTokens with the necessary-condition guards described above. */
class FastLexer extends Lexer {
  blockTokens(src, tokens = [], lastIsText = false) {
    // Never guess outside marked's defaults: anything else goes straight to marked's own lexer.
    if (this.options.pedantic || this.options.extensions) {
      return super.blockTokens(src, tokens, lastIsText);
    }

    const tokenizer = this.tokenizer;
    const queue = this.inlineQueue;
    tokenizer.lexer = this;

    let shortestSeen = Infinity;
    let text = src;
    let prev;
    let token;

    while (text.length > 0) {
      // marked's own runaway guard: a pass that reaches no shorter text is a tokenizer bug, not a block.
      if (text.length < shortestSeen) shortestSeen = text.length;
      else {
        this.infiniteLoopError(text.charCodeAt(0));
        break;
      }

      const c0 = text.charCodeAt(0);

      // newline (blank line)
      if (c0 === CS_NL || c0 === CS_SP || c0 === CS_TAB) {
        token = tokenizer.space(text);
        if (token) {
          text = text.substring(token.raw.length);
          prev = tokens.length > 0 ? tokens[tokens.length - 1] : undefined;
          if (token.raw.length === 1 && prev !== undefined) prev.raw += '\n';
          else tokens.push(token);
          continue;
        }
      }

      // indented code: four spaces, or up to three then a tab
      const c1 = text.charCodeAt(1);
      if (
        c0 === CS_TAB ||
        (c0 === CS_SP && c1 === CS_TAB) ||
        (c0 === CS_SP && c1 === CS_SP && text.charCodeAt(2) === CS_TAB) ||
        (c0 === CS_SP && c1 === CS_SP && text.charCodeAt(2) === CS_SP && (text.charCodeAt(3) === CS_TAB || text.charCodeAt(3) === CS_SP))
      ) {
        token = tokenizer.code(text);
        if (token) {
          text = text.substring(token.raw.length);
          prev = tokens.length > 0 ? tokens[tokens.length - 1] : undefined;
          if (prev !== undefined && (prev.type === 'paragraph' || prev.type === 'text')) {
            prev.raw += (prev.raw.endsWith('\n') ? '' : '\n') + token.raw;
            prev.text += '\n' + token.text;
            queue[queue.length - 1].src = prev.text;
          } else tokens.push(token);
          continue;
        }
      }

      // The character marked's own ` {0,3}` prefix would land on, and what it still allows.
      let skip = 0;
      while (skip < 3 && text.charCodeAt(skip) === CS_SP) skip++;
      const ch = text.charCodeAt(skip);
      const allowed = ch < 128 ? FIRST[ch] : 0;

      if (allowed & T_FENCES) {
        token = tokenizer.fences(text);
        if (token) {
          text = text.substring(token.raw.length);
          tokens.push(token);
          continue;
        }
      }

      if (allowed & T_HEADING) {
        token = tokenizer.heading(text);
        if (token) {
          text = text.substring(token.raw.length);
          tokens.push(token);
          continue;
        }
      }

      if (allowed & T_HR) {
        token = tokenizer.hr(text);
        if (token) {
          text = text.substring(token.raw.length);
          tokens.push(token);
          continue;
        }
      }

      if (allowed & T_BLOCKQUOTE) {
        token = tokenizer.blockquote(text);
        if (token) {
          text = text.substring(token.raw.length);
          tokens.push(token);
          continue;
        }
      }

      if (allowed & T_LIST) {
        token = tokenizer.list(text);
        if (token) {
          text = text.substring(token.raw.length);
          tokens.push(token);
          continue;
        }
      }

      if (allowed & T_HTML) {
        token = tokenizer.html(text);
        if (token) {
          text = text.substring(token.raw.length);
          tokens.push(token);
          continue;
        }
      }

      if (allowed & T_DEF) {
        token = tokenizer.def(text);
        if (token) {
          text = text.substring(token.raw.length);
          prev = tokens.length > 0 ? tokens[tokens.length - 1] : undefined;
          if (prev !== undefined && (prev.type === 'paragraph' || prev.type === 'text')) {
            prev.raw += (prev.raw.endsWith('\n') ? '' : '\n') + token.raw;
            prev.text += '\n' + token.raw;
            queue[queue.length - 1].src = prev.text;
          } else {
            if (!this.tokens.links[token.tag]) this.tokens.links[token.tag] = { href: token.href, title: token.title };
            tokens.push(token);
          }
          continue;
        }
      }

      // the table's delimiter row is the second line and starts with `|`, `:` or `-`; the setext
      // heading's underline is a later line of only `=` or `-`. Both need the first newline anyway.
      const firstNewline = text.indexOf('\n');
      if (firstNewline > 0) {
        let j = firstNewline + 1;
        while (j - firstNewline <= 3 && text.charCodeAt(j) === CS_SP) j++;
        const second = text.charCodeAt(j);
        if (second === CS_PIPE || second === CS_COLON || second === CS_DASH) {
          token = tokenizer.table(text);
          if (token) {
            text = text.substring(token.raw.length);
            tokens.push(token);
            continue;
          }
        }

        // setext heading
        if (hasSetextUnderline(text, firstNewline)) {
          token = tokenizer.lheading(text);
          if (token) {
            text = text.substring(token.raw.length);
            tokens.push(token);
            continue;
          }
        }
      }

      if (this.state.top && c0 !== CS_NL) {
        token = tokenizer.paragraph(text);
        if (token) {
          prev = tokens.length > 0 ? tokens[tokens.length - 1] : undefined;
          if (lastIsText && prev !== undefined && prev.type === 'paragraph') {
            prev.raw += (prev.raw.endsWith('\n') ? '' : '\n') + token.raw;
            prev.text += '\n' + token.text;
            queue.pop();
            queue[queue.length - 1].src = prev.text;
          } else tokens.push(token);
          lastIsText = text.length !== token.raw.length;
          text = text.substring(token.raw.length);
          continue;
        }
      }

      token = tokenizer.text(text);
      if (token) {
        text = text.substring(token.raw.length);
        prev = tokens.length > 0 ? tokens[tokens.length - 1] : undefined;
        if (prev !== undefined && prev.type === 'text') {
          prev.raw += (prev.raw.endsWith('\n') ? '' : '\n') + token.raw;
          prev.text += '\n' + token.text;
          queue.pop();
          queue[queue.length - 1].src = prev.text;
        } else tokens.push(token);
        continue;
      }

      this.infiniteLoopError(c0);
      break;
    }

    this.state.top = true;
    return tokens;
  }
}

/** The HTML marked 18.1.3 renders for `markdown`, with marked's default options. */
export function parse(markdown) {
  return Parser.parse(new FastLexer(OPTIONS).lex(markdown), OPTIONS);
}
