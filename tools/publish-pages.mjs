import {
  copyFile,
  mkdir,
  readdir,
  rm,
  stat,
} from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const FORBIDDEN_PUBLISH_PATH_PATTERNS = Object.freeze([
  /(^|\/)\.git(\/|$)/i,
  /\.map$/i,
  /(^|\/)[^/]*checkpoint[^/]*(\/|$)/i,
]);

function normalizePath(pathname) {
  return pathname.split(sep).join("/");
}

async function assertDirectory(pathname, label) {
  let details;
  try {
    details = await stat(pathname);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : `Missing ${label}: ${pathname}`;
    throw new Error(`${label} is not accessible: ${message}`);
  }
  if (!details.isDirectory()) {
    throw new Error(`${label} must be a directory: ${pathname}`);
  }
}

async function listFiles(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const target = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(target)));
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(`Unsupported artifact entry type: ${target}`);
    }
    files.push(target);
  }
  return files;
}

function ensureRelativePathAllowed(relativePath) {
  for (const pattern of FORBIDDEN_PUBLISH_PATH_PATTERNS) {
    if (pattern.test(relativePath)) {
      throw new Error(`Forbidden publish artifact: ${relativePath}`);
    }
  }
}

export async function validatePublishTree(sourceRoot) {
  await assertDirectory(sourceRoot, "Publish source");
  const files = (
    await Promise.all(
      (await listFiles(sourceRoot)).map(async (file) => {
        const details = await stat(file);
        const relativePath = normalizePath(relative(sourceRoot, file));
        ensureRelativePathAllowed(relativePath);
        return {
          absolutePath: file,
          relativePath,
          size: details.size,
        };
      }),
    )
  ).sort((left, right) => left.relativePath.localeCompare(right.relativePath));

  if (files.length === 0) {
    throw new Error(`Publish source is empty: ${sourceRoot}`);
  }

  return files;
}

function assertSafeSyncRoots(sourceRoot, targetRoot) {
  const resolvedSource = resolve(sourceRoot);
  const resolvedTarget = resolve(targetRoot);
  if (resolvedSource === resolvedTarget) {
    throw new Error("Publish source and target must be different directories");
  }
  const sourcePrefix = `${resolvedSource}${sep}`;
  const targetPrefix = `${resolvedTarget}${sep}`;
  if (resolvedSource.startsWith(targetPrefix)) {
    throw new Error("Publish source cannot be inside the publish target");
  }
  if (resolvedTarget.startsWith(sourcePrefix)) {
    throw new Error("Publish target cannot be inside the publish source");
  }
}

async function assertGitWorktree(targetRoot) {
  await assertDirectory(targetRoot, "Publish target");
  await assertDirectory(join(targetRoot, ".git"), "Publish target .git");
}

async function clearTargetWorktree(targetRoot) {
  const entries = await readdir(targetRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === ".git") continue;
    await rm(join(targetRoot, entry.name), { force: true, recursive: true });
  }
}

async function copyPublishFiles(sourceRoot, targetRoot, files) {
  for (const file of files) {
    const target = join(targetRoot, file.relativePath);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(join(sourceRoot, file.relativePath), target);
  }
}

export async function syncPublishTree(sourceRoot, targetRoot) {
  assertSafeSyncRoots(sourceRoot, targetRoot);
  const files = await validatePublishTree(sourceRoot);
  await assertGitWorktree(targetRoot);
  await clearTargetWorktree(targetRoot);
  await copyPublishFiles(sourceRoot, targetRoot, files);
  return files.map((file) => file.relativePath);
}

async function main(argv = process.argv.slice(2)) {
  const [command, sourceArg, targetArg] = argv;
  if (command === "validate" && sourceArg) {
    const files = await validatePublishTree(resolve(sourceArg));
    process.stdout.write(`Validated ${files.length} publish artifacts.\n`);
    return;
  }
  if (command === "sync" && sourceArg && targetArg) {
    const files = await syncPublishTree(resolve(sourceArg), resolve(targetArg));
    process.stdout.write(`Synced ${files.length} publish artifacts.\n`);
    return;
  }

  const scriptPath = fileURLToPath(import.meta.url);
  const scriptName = normalizePath(relative(process.cwd(), scriptPath));
  throw new Error(
    `Usage: node ${scriptName} validate <source-dir> | sync <source-dir> <target-dir>`,
  );
}

const isMain =
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMain) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(1);
  });
}
