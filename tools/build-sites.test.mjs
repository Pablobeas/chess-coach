import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  rm,
  writeFile,
  mkdir,
  readdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import {
  buildSitesBundle,
  MAX_ASSET_SIZE_BYTES,
  verifyWebDist,
} from "./build-sites.mjs";
import { handleSiteRequest } from "./build-sites-worker-source.mjs";

function createAssetsEnv(overrides = {}) {
  const seen = [];
  const routes = new Map(
    Object.entries({
      "/index.html": new Response("<!doctype html><title>Coach</title>", {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
      "/assets/app-123.js": new Response("console.log('ok');", {
        status: 200,
        headers: { "content-type": "application/javascript; charset=utf-8" },
      }),
      "/sw.js": new Response("self.addEventListener('install', () => {});", {
        status: 200,
        headers: { "content-type": "text/plain; charset=utf-8" },
      }),
      ...overrides,
    }),
  );

  return {
    seen,
    env: {
      ASSETS: {
        async fetch(request) {
          const pathname = new URL(request.url).pathname;
          seen.push(pathname);
          return (
            routes.get(pathname) ?? new Response("Not Found", { status: 404 })
          );
        },
      },
    },
  };
}

async function withTempProject(run) {
  const projectRoot = await mkdtemp(join(tmpdir(), "build-sites-"));
  try {
    await run(projectRoot);
  } finally {
    await rm(projectRoot, { force: true, recursive: true });
  }
}

async function writeProjectFile(projectRoot, relativePath, contents) {
  const target = join(projectRoot, relativePath);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, contents);
}

async function listRelativeFiles(root, base = root) {
  const entries = await readdir(root, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const target = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listRelativeFiles(target, base)));
      continue;
    }
    files.push(target.slice(base.length + 1).replaceAll("\\", "/"));
  }
  return files.sort((left, right) => left.localeCompare(right));
}

async function createValidWebDist(projectRoot) {
  const manifest = {
    name: "Chess Coach",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
  const version = {
    buildId: "abc123",
    assets: [
      "/index.html",
      "/manifest.webmanifest",
      "/icon-192.png",
      "/icon-512.png",
      "/stockfish/Copying.txt",
      "/assets/app-123.js",
    ],
  };

  await writeProjectFile(
    projectRoot,
    "tools/build-sites-worker-source.mjs",
    "export default {};\n",
  );
  await writeProjectFile(
    projectRoot,
    "apps/web/dist/index.html",
    "<!doctype html>\n",
  );
  await writeProjectFile(
    projectRoot,
    "apps/web/dist/manifest.webmanifest",
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  await writeProjectFile(
    projectRoot,
    "apps/web/dist/sw.js",
    "self.addEventListener('install', () => {});\n",
  );
  await writeProjectFile(
    projectRoot,
    "apps/web/dist/version.json",
    `${JSON.stringify(version, null, 2)}\n`,
  );
  await writeProjectFile(projectRoot, "apps/web/dist/icon-192.png", "icon-192");
  await writeProjectFile(projectRoot, "apps/web/dist/icon-512.png", "icon-512");
  await writeProjectFile(
    projectRoot,
    "apps/web/dist/apple-touch-icon.png",
    "apple",
  );
  await writeProjectFile(projectRoot, "apps/web/dist/_headers", "ignored");
  await writeProjectFile(
    projectRoot,
    "apps/web/dist/assets/app-123.js",
    "console.log('ok');\n",
  );
  await writeProjectFile(
    projectRoot,
    "apps/web/dist/stockfish/Copying.txt",
    "GPL\n",
  );
}

test("serves the SPA shell for / and HTML navigation routes", async () => {
  const { env, seen } = createAssetsEnv();
  const rootResponse = await handleSiteRequest(
    new Request("https://example.test/"),
    env,
  );
  const routeResponse = await handleSiteRequest(
    new Request("https://example.test/partida/1", {
      headers: { accept: "text/html" },
    }),
    env,
  );

  assert.equal(rootResponse.status, 200);
  assert.equal(routeResponse.status, 200);
  assert.deepEqual(seen, ["/index.html", "/index.html"]);
  assert.match(
    rootResponse.headers.get("content-security-policy") ?? "",
    /frame-ancestors 'none'/,
  );
  assert.equal(
    rootResponse.headers.get("cache-control"),
    "no-store, no-cache, must-revalidate",
  );
});

test("serves static assets with immutable caching", async () => {
  const { env, seen } = createAssetsEnv();
  const response = await handleSiteRequest(
    new Request("https://example.test/assets/app-123.js"),
    env,
  );

  assert.equal(response.status, 200);
  assert.deepEqual(seen, ["/assets/app-123.js"]);
  assert.equal(
    response.headers.get("cache-control"),
    "public, max-age=31536000, immutable",
  );
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
});

test("returns a real 404 for API routes instead of the SPA shell", async () => {
  const { env, seen } = createAssetsEnv();
  const response = await handleSiteRequest(
    new Request("https://example.test/maia3-api/move", {
      method: "POST",
    }),
    env,
  );

  assert.equal(response.status, 404);
  assert.deepEqual(seen, []);
});

test("serves the service worker with explicit JS headers and scope", async () => {
  const { env } = createAssetsEnv();
  const response = await handleSiteRequest(
    new Request("https://example.test/sw.js"),
    env,
  );

  assert.equal(response.status, 200);
  assert.equal(
    response.headers.get("content-type"),
    "application/javascript; charset=utf-8",
  );
  assert.equal(response.headers.get("service-worker-allowed"), "/");
  assert.equal(
    response.headers.get("cache-control"),
    "no-store, no-cache, must-revalidate",
  );
});

test("rejects traversal attempts before touching the assets binding", async () => {
  const { env, seen } = createAssetsEnv();
  const response = await handleSiteRequest(
    new Request("https://example.test/%2e%2e%5csecret.txt"),
    env,
  );

  assert.equal(response.status, 400);
  assert.deepEqual(seen, []);
});

test("buildSitesBundle copies dist into dist/client and emits dist/server/index.js deterministically", async () => {
  await withTempProject(async (projectRoot) => {
    await createValidWebDist(projectRoot);
    let buildRuns = 0;

    const first = await buildSitesBundle({
      projectRoot,
      runWebBuildStep: async () => {
        buildRuns += 1;
      },
    });
    const firstFiles = await listRelativeFiles(join(projectRoot, "dist"));
    const firstWorker = await readFile(
      join(projectRoot, "dist/server/index.js"),
      "utf8",
    );

    const second = await buildSitesBundle({
      projectRoot,
      runWebBuildStep: async () => {
        buildRuns += 1;
      },
    });
    const secondFiles = await listRelativeFiles(join(projectRoot, "dist"));
    const secondWorker = await readFile(
      join(projectRoot, "dist/server/index.js"),
      "utf8",
    );

    assert.equal(buildRuns, 2);
    assert.deepEqual(first, second);
    assert.deepEqual(firstFiles, secondFiles);
    assert.deepEqual(firstFiles, [
      "client/apple-touch-icon.png",
      "client/assets/app-123.js",
      "client/icon-192.png",
      "client/icon-512.png",
      "client/index.html",
      "client/manifest.webmanifest",
      "client/stockfish/Copying.txt",
      "client/sw.js",
      "client/version.json",
      "server/index.js",
    ]);
    assert.equal(firstWorker, "export default {};\n");
    assert.equal(secondWorker, firstWorker);
  });
});

test("verifyWebDist fails when a client artifact exceeds the Sites size budget", async () => {
  await withTempProject(async (projectRoot) => {
    await createValidWebDist(projectRoot);
    await writeProjectFile(
      projectRoot,
      "apps/web/dist/stockfish/stockfish-18-lite-single.wasm",
      Buffer.alloc(MAX_ASSET_SIZE_BYTES + 1),
    );

    await assert.rejects(
      verifyWebDist(join(projectRoot, "apps/web/dist")),
      /Asset exceeds/,
    );
  });
});
