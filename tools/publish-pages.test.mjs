import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  PAGES_CSP_META_TAG,
  syncPublishTree,
  validatePublishTree,
} from "./publish-pages.mjs";

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

test("validatePublishTree rejects source maps and checkpoint artifacts", async () => {
  await withTempDir(async (projectRoot) => {
    await writeProjectFile(
      projectRoot,
      "dist-pages/index.html",
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

test("validatePublishTree rejects hidden runtime artifacts and unsupported file types", async () => {
  await withTempDir(async (projectRoot) => {
    await writeProjectFile(
      projectRoot,
      "dist-pages/index.html",
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
    await writeProjectFile(projectRoot, "dist-pages/cache/data.bin", "x");

    await assert.rejects(
      () => validatePublishTree(join(projectRoot, "dist-pages")),
      /Unexpected publish artifact type: cache\/data\.bin/,
    );
  });
});

test("syncPublishTree replaces the target worktree contents and preserves .git", async () => {
  await withTempDir(async (projectRoot) => {
    const sourceRoot = join(projectRoot, "source");
    const targetRoot = join(projectRoot, "target");

    await writeProjectFile(
      sourceRoot,
      "index.html",
      "<!doctype html>\n<html>\n  <head>\n    <!-- __CHESS_COACH_PAGES_CSP__ -->\n  </head>\n</html>\n",
    );
    await writeProjectFile(sourceRoot, "assets/app.js", "console.log('ok');\n");
    await writeProjectFile(targetRoot, ".git/HEAD", "ref: refs/heads/main\n");
    await writeProjectFile(targetRoot, "old.txt", "stale\n");
    await writeProjectFile(targetRoot, "nested/old.css", "stale\n");

    const syncedFiles = await syncPublishTree(sourceRoot, targetRoot);

    assert.deepEqual(syncedFiles, ["assets/app.js", "index.html"]);
    assert.deepEqual(await listRelativeFiles(targetRoot), [
      ".git/HEAD",
      "assets/app.js",
      "index.html",
    ]);
    assert.equal(
      await readFile(join(targetRoot, "assets/app.js"), "utf8"),
      "console.log('ok');\n",
    );
    assert.match(
      await readFile(join(targetRoot, "index.html"), "utf8"),
      new RegExp(PAGES_CSP_META_TAG.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
  });
});

test("syncPublishTree rejects nested source and target directories before mutating target", async () => {
  await withTempDir(async (projectRoot) => {
    const targetRoot = join(projectRoot, "public-repo");
    const sourceInsideTarget = join(targetRoot, "dist-pages");

    await writeProjectFile(
      sourceInsideTarget,
      "index.html",
      "<!doctype html>\n<html><head><!-- __CHESS_COACH_PAGES_CSP__ --></head></html>\n",
    );
    await writeProjectFile(targetRoot, ".git/HEAD", "ref: refs/heads/main\n");
    await writeProjectFile(targetRoot, "keep.txt", "keep\n");

    await assert.rejects(
      () => syncPublishTree(sourceInsideTarget, targetRoot),
      /Publish source cannot be inside the publish target/,
    );
    assert.equal(await readFile(join(targetRoot, "keep.txt"), "utf8"), "keep\n");
  });

  await withTempDir(async (projectRoot) => {
    const sourceRoot = projectRoot;
    const targetInsideSource = join(projectRoot, "public-repo");

    await writeProjectFile(
      sourceRoot,
      "dist-pages/index.html",
      "<!doctype html>\n<html><head><!-- __CHESS_COACH_PAGES_CSP__ --></head></html>\n",
    );
    await writeProjectFile(targetInsideSource, ".git/HEAD", "ref: refs/heads/main\n");
    await writeProjectFile(targetInsideSource, "keep.txt", "keep\n");

    await assert.rejects(
      () => syncPublishTree(sourceRoot, targetInsideSource),
      /Publish target cannot be inside the publish source/,
    );
    assert.equal(
      await readFile(join(targetInsideSource, "keep.txt"), "utf8"),
      "keep\n",
    );
  });
});

test("publish workflow keeps the expected trigger, validation, and SSH publish flow", async () => {
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
  assert.match(workflow, /corepack enable/);
  assert.doesNotMatch(workflow, /cache:\s*pnpm/);
  assert.match(workflow, /pnpm install --frozen-lockfile/);
  assert.match(workflow, /pnpm check/);
  assert.match(workflow, /pnpm build:pages/);
  assert.match(
    workflow,
    /node tools\/publish-pages\.mjs validate "\$PUBLISH_SOURCE"/,
  );
  assert.match(workflow, /PAGES_DEPLOY_KEY/);
  assert.doesNotMatch(
    workflow,
    /env:\n  TARGET_REPO: Pablobeas\/chess-coach-play\n  TARGET_BRANCH: main\n  PUBLISH_SOURCE: apps\/web\/dist-pages\n  PUBLISH_TARGET:/,
  );
  assert.match(
    workflow,
    /- name: Clone public Pages repository[\s\S]*?env:\n\s+PUBLISH_TARGET: \$\{\{ runner\.temp \}\}\/pages-repo/,
  );
  assert.match(
    workflow,
    /github\.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl/,
  );
  assert.match(
    workflow,
    /git clone --depth 1 --branch "\$TARGET_BRANCH" "git@github\.com:\$\{TARGET_REPO\}\.git" "\$PUBLISH_TARGET"/,
  );
  assert.match(
    workflow,
    /node tools\/publish-pages\.mjs sync "\$PUBLISH_SOURCE" "\$PUBLISH_TARGET"/,
  );
  assert.match(
    workflow,
    /git commit -m "Publish \$\{GITHUB_REPOSITORY\}@\$\{GITHUB_SHA\}"/,
  );
  assert.match(workflow, /git push origin "HEAD:\$TARGET_BRANCH"/);
});
