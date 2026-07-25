import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const scriptPath = join(scriptDirectory, "generate-pwa.mjs");

async function withTempWebDist(run) {
  const projectRoot = await mkdtemp(join(tmpdir(), "generate-pwa-"));
  const webRoot = join(projectRoot, "apps", "web");
  const distRoot = join(webRoot, "dist");

  try {
    await mkdir(distRoot, { recursive: true });
    await writeDistFile(
      distRoot,
      "index.html",
      "<!doctype html><meta name=\"chess-coach-build-id\" content=\"__CHESS_COACH_BUILD_ID__\" />\n",
    );
    await writeDistFile(
      distRoot,
      "assets/app-123.js",
      "console.log('app');\n",
    );
    await writeDistFile(distRoot, "manifest.webmanifest", "{}\n");
    await writeDistFile(distRoot, "stockfish/launcher.js", "launcher();\n");
    await writeDistFile(
      distRoot,
      "stockfish/stockfish-18-asm.js",
      "engine();\n",
    );
    await writeDistFile(distRoot, "stockfish-smoke.html", "<!doctype html>\n");
    await run({ projectRoot, webRoot, distRoot });
  } finally {
    await rm(projectRoot, { force: true, recursive: true });
  }
}

async function writeDistFile(distRoot, relativePath, contents) {
  const target = join(distRoot, relativePath);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, contents);
}

test("precache includes the Stockfish ASM fallback launcher assets", async () => {
  await withTempWebDist(async ({ webRoot, distRoot }) => {
    await execFileAsync(process.execPath, [scriptPath], {
      cwd: webRoot,
      env: { ...process.env },
    });

    const version = JSON.parse(
      await readFile(join(distRoot, "version.json"), "utf8"),
    );
    const worker = await readFile(join(distRoot, "sw.js"), "utf8");

    assert.deepEqual(version.assets, [
      "/assets/app-123.js",
      "/index.html",
      "/manifest.webmanifest",
      "/stockfish/launcher.js",
      "/stockfish/stockfish-18-asm.js",
    ]);
    assert.match(worker, /"\/stockfish\/launcher\.js"/);
    assert.match(worker, /"\/stockfish\/stockfish-18-asm\.js"/);
    assert.doesNotMatch(worker, /ON_DEMAND/);
  });
});

test("precache still skips generated and smoke-test artifacts", async () => {
  await withTempWebDist(async ({ webRoot, distRoot }) => {
    await execFileAsync(process.execPath, [scriptPath], {
      cwd: webRoot,
      env: { ...process.env },
    });

    const version = JSON.parse(
      await readFile(join(distRoot, "version.json"), "utf8"),
    );

    assert(!version.assets.includes("/sw.js"));
    assert(!version.assets.includes("/version.json"));
    assert(!version.assets.includes("/stockfish-smoke.html"));
  });
});
