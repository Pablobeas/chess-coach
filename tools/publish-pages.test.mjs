import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PAGES_CSP_META_TAG, validatePublishTree } from "./publish-pages.mjs";

const CONFIGURE_PAGES_SHA = "45bfe0192ca1faeb007ade9deae92b16b8254a0d";
const UPLOAD_PAGES_ARTIFACT_SHA = "fc324d3547104276b827a68afc52ff2a11cc49c9";
const DEPLOY_PAGES_SHA = "cd2ce8fcbc39b97be8ca5fce6e763baed58fa128";

async function withTempDir(run) {
  const root = await mkdtemp(join(tmpdir(), "publish-pages-"));
  try {
    await run(root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

async function writeProjectFile(projectRoot, relativePath, contents) {
  const target = join(projectRoot, relativePath);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, contents);
}

test("validatePublishTree rejects source maps and checkpoint artifacts", async () => {
  await withTempDir(async (projectRoot) => {
    await writeProjectFile(
      projectRoot,
      "dist-pages/index.html",
      "<!doctype html><html><head><!-- __CHESS_COACH_PAGES_CSP__ --></head></html>",
    );
    await writeProjectFile(
      projectRoot,
      "dist-pages/404.html",
      "<!doctype html><html><head><!-- __CHESS_COACH_PAGES_CSP__ --></head></html>",
    );
    await writeProjectFile(projectRoot, "dist-pages/assets/app.js.map", "{}");

    await assert.rejects(
      () => validatePublishTree(join(projectRoot, "dist-pages")),
      /Forbidden publish artifact: assets\/app\.js\.map/,
    );
  });

  await withTempDir(async (projectRoot) => {
    await writeProjectFile(
      projectRoot,
      "dist-pages/index.html",
      "<!doctype html><html><head><!-- __CHESS_COACH_PAGES_CSP__ --></head></html>",
    );
    await writeProjectFile(
      projectRoot,
      "dist-pages/404.html",
      "<!doctype html><html><head><!-- __CHESS_COACH_PAGES_CSP__ --></head></html>",
    );
    await writeProjectFile(projectRoot, "dist-pages/models/checkpoint.bin", "x");

    await assert.rejects(
      () => validatePublishTree(join(projectRoot, "dist-pages")),
      /Forbidden publish artifact: models\/checkpoint\.bin/,
    );
  });
});

test("validatePublishTree injects a Pages CSP meta tag into index and 404 artifacts", async () => {
  await withTempDir(async (projectRoot) => {
    const html = [
      "<!doctype html>",
      "<html>",
      "  <head>",
      "    <meta charset=\"UTF-8\" />",
      "    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\" />",
      "    <!-- __CHESS_COACH_PAGES_CSP__ -->",
      "    <meta name=\"chess-coach-build-id\" content=\"__CHESS_COACH_BUILD_ID__\" />",
      "  </head>",
      "</html>",
      "",
    ].join("\n");
    await writeProjectFile(projectRoot, "dist-pages/index.html", html);
    await writeProjectFile(projectRoot, "dist-pages/404.html", html);
    await writeProjectFile(projectRoot, "dist-pages/assets/app.js", "console.log('ok');\n");

    const files = await validatePublishTree(join(projectRoot, "dist-pages"));
    assert.deepEqual(
      files.map((file) => file.relativePath),
      ["404.html", "assets/app.js", "index.html"],
    );

    const indexHtml = await readFile(join(projectRoot, "dist-pages/index.html"), "utf8");
    const notFoundHtml = await readFile(join(projectRoot, "dist-pages/404.html"), "utf8");
    for (const output of [indexHtml, notFoundHtml]) {
      assert.match(output, new RegExp(PAGES_CSP_META_TAG.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      assert.doesNotMatch(output, /__CHESS_COACH_PAGES_CSP__/);
      assert.doesNotMatch(output, /frame-ancestors/i);
      assert.ok(
        output.indexOf(PAGES_CSP_META_TAG) < output.indexOf("chess-coach-build-id"),
      );
    }
  });
});

test("validatePublishTree requires the SPA fallback artifact", async () => {
  await withTempDir(async (projectRoot) => {
    await writeProjectFile(
      projectRoot,
      "dist-pages/index.html",
      "<!doctype html><html><head><!-- __CHESS_COACH_PAGES_CSP__ --></head></html>",
    );
    await writeProjectFile(projectRoot, "dist-pages/assets/app.js", "console.log('ok');\n");

    await assert.rejects(
      () => validatePublishTree(join(projectRoot, "dist-pages")),
      /Publish artifact 404\.html is not accessible/,
    );
  });
});

test("validatePublishTree rejects hidden runtime artifacts and unsupported file types", async () => {
  await withTempDir(async (projectRoot) => {
    await writeProjectFile(
      projectRoot,
      "dist-pages/index.html",
      "<!doctype html><html><head><!-- __CHESS_COACH_PAGES_CSP__ --></head></html>",
    );
    await writeProjectFile(
      projectRoot,
      "dist-pages/404.html",
      "<!doctype html><html><head><!-- __CHESS_COACH_PAGES_CSP__ --></head></html>",
    );
    await writeProjectFile(projectRoot, "dist-pages/.env.production", "SECRET=1\n");

    await assert.rejects(
      () => validatePublishTree(join(projectRoot, "dist-pages")),
      /Forbidden publish artifact: \.env\.production/,
    );
  });

  await withTempDir(async (projectRoot) => {
    await writeProjectFile(
      projectRoot,
      "dist-pages/index.html",
      "<!doctype html><html><head><!-- __CHESS_COACH_PAGES_CSP__ --></head></html>",
    );
    await writeProjectFile(
      projectRoot,
      "dist-pages/404.html",
      "<!doctype html><html><head><!-- __CHESS_COACH_PAGES_CSP__ --></head></html>",
    );
    await writeProjectFile(projectRoot, "dist-pages/secrets.pem", "pem\n");

    await assert.rejects(
      () => validatePublishTree(join(projectRoot, "dist-pages")),
      /Forbidden publish artifact: secrets\.pem/,
    );
  });

  await withTempDir(async (projectRoot) => {
    await writeProjectFile(
      projectRoot,
      "dist-pages/index.html",
      "<!doctype html><html><head><!-- __CHESS_COACH_PAGES_CSP__ --></head></html>",
    );
    await writeProjectFile(
      projectRoot,
      "dist-pages/404.html",
      "<!doctype html><html><head><!-- __CHESS_COACH_PAGES_CSP__ --></head></html>",
    );
    await writeProjectFile(projectRoot, "dist-pages/cache/data.bin", "x");

    await assert.rejects(
      () => validatePublishTree(join(projectRoot, "dist-pages")),
      /Unexpected publish artifact type: cache\/data\.bin/,
    );
  });
});

test("publish workflow uses the official GitHub Pages artifact flow", async () => {
  const workflowPath = fileURLToPath(
    new URL("../.github/workflows/publish-pages.yml", import.meta.url),
  );
  const workflow = await readFile(workflowPath, "utf8");

  assert.match(workflow, /push:\n    branches:\n      - main/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /permissions:\n  contents: read/);
  assert.match(
    workflow,
    /concurrency:\n  group: publish-pages\n  cancel-in-progress: false/,
  );
  assert.match(
    workflow,
    /actions\/checkout@11d5960a326750d5838078e36cf38b85af677262/,
  );
  assert.match(
    workflow,
    /actions\/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020/,
  );
  assert.match(
    workflow,
    new RegExp(`actions/configure-pages@${CONFIGURE_PAGES_SHA}`),
  );
  assert.match(
    workflow,
    new RegExp(`actions/upload-pages-artifact@${UPLOAD_PAGES_ARTIFACT_SHA}`),
  );
  assert.match(
    workflow,
    new RegExp(`actions/deploy-pages@${DEPLOY_PAGES_SHA}`),
  );
  assert.match(workflow, /corepack enable/);
  assert.doesNotMatch(workflow, /cache:\s*pnpm/);
  assert.match(workflow, /pnpm install --frozen-lockfile/);
  assert.match(workflow, /pnpm check/);
  assert.match(workflow, /pnpm build:pages/);
  assert.match(
    workflow,
    /node tools\/publish-pages\.mjs validate "\$PUBLISH_SOURCE"/,
  );
  assert.match(
    workflow,
    /permissions:\n  contents: read\n  pages: write\n  id-token: write/,
  );
  assert.match(
    workflow,
    /environment:\n\s+name: github-pages\n\s+url: \$\{\{\s*steps\.deployment\.outputs\.page_url\s*\}\}/,
  );
  assert.match(
    workflow,
    /needs: build/,
  );
  assert.match(
    workflow,
    /with:\n\s+path: \$\{\{\s*env\.PUBLISH_SOURCE\s*\}\}/,
  );
  assert.doesNotMatch(workflow, /PAGES_DEPLOY_KEY/);
  assert.doesNotMatch(workflow, /TARGET_REPO|TARGET_BRANCH|PUBLISH_TARGET/);
  assert.doesNotMatch(workflow, /git@github\.com/);
  assert.doesNotMatch(workflow, /git clone --depth 1/);
  assert.doesNotMatch(workflow, /node tools\/publish-pages\.mjs sync /);
});
