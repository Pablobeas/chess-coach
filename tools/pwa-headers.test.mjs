import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const requiredCspTokens = ["'wasm-unsafe-eval'", "worker-src 'self' blob:"];

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

test("Stockfish launcher resolves its engine next to the worker instead of from the origin root", () => {
  const launcher = readFileSync(
    "apps/web/public/stockfish/launcher.js",
    "utf8",
  );
  assert.doesNotMatch(launcher, /:\s*"\/stockfish\//);
  assert.match(launcher, /new URL\(engineFile, self\.location\.href\)/);
});
