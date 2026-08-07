import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { PAGES_META_CSP } from "./publish-pages.mjs";

const requiredCspTokens = [
  "'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  "form-action 'self'",
  "frame-src 'none'",
  "frame-ancestors 'none'",
];

function assertCompatibleHeaders(path) {
  const headers = readFileSync(path, "utf8");
  for (const token of requiredCspTokens) {
    assert.match(
      headers,
      new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
  }
}

test("PWA headers permit local Worker and WASM execution", () => {
  assertCompatibleHeaders("apps/web/public/_headers");
  if (existsSync("apps/web/dist/_headers")) {
    assertCompatibleHeaders("apps/web/dist/_headers");
  }
});

test("Pages meta CSP keeps the static policy compatible without pretending to enforce framing headers", () => {
  assert.match(PAGES_META_CSP, /script-src 'self' 'wasm-unsafe-eval'/);
  assert.match(PAGES_META_CSP, /worker-src 'self' blob:/);
  assert.match(PAGES_META_CSP, /form-action 'self'/);
  assert.match(PAGES_META_CSP, /frame-src 'none'/);
  assert.doesNotMatch(PAGES_META_CSP, /frame-ancestors/i);
  assert.doesNotMatch(PAGES_META_CSP, /x-frame-options/i);
});

test("Stockfish launcher resolves its engine next to the worker instead of from the origin root", () => {
  const launcher = readFileSync(
    "apps/web/public/stockfish/launcher.js",
    "utf8",
  );
  assert.doesNotMatch(launcher, /:\s*"\/stockfish\//);
  assert.match(launcher, /new URL\(engineFile, self\.location\.href\)/);
});
