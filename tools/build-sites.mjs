import { spawn } from "node:child_process";
import {
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
  copyFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const MAX_ASSET_SIZE_BYTES = 25 * 1024 * 1024;
export const REQUIRED_CLIENT_FILES = Object.freeze([
  "index.html",
  "manifest.webmanifest",
  "sw.js",
  "version.json",
  "stockfish/Copying.txt",
]);
export const OMITTED_CLIENT_FILES = new Set(["_headers"]);
const FORBIDDEN_FILE_PATTERNS = Object.freeze([
  /\.map$/i,
  /stockfish-smoke\.html$/i,
  /\.log$/i,
]);

function normalizePath(pathname) {
  return pathname.split(sep).join("/");
}

async function listFiles(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const target = join(root, entry.name);
      if (entry.isDirectory()) return listFiles(target);
      return [target];
    }),
  );
  return files.flat();
}

function createProjectPaths(
  projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), ".."),
) {
  return {
    projectRoot,
    webDistRoot: join(projectRoot, "apps", "web", "dist"),
    siteDistRoot: join(projectRoot, "dist"),
    siteClientRoot: join(projectRoot, "dist", "client"),
    siteServerRoot: join(projectRoot, "dist", "server"),
    workerSourcePath: join(
      projectRoot,
      "tools",
      "build-sites-worker-source.mjs",
    ),
  };
}

function assertSafeSiteDist(projectRoot, siteDistRoot, webDistRoot) {
  const expected = join(projectRoot, "dist");
  if (resolve(siteDistRoot) !== resolve(expected)) {
    throw new Error(
      `Refusing to clean unexpected dist directory: ${siteDistRoot}`,
    );
  }
  if (resolve(siteDistRoot) === resolve(webDistRoot)) {
    throw new Error("Site dist and web dist must stay separate");
  }
}

function isForbiddenFile(relativePath) {
  return FORBIDDEN_FILE_PATTERNS.some((pattern) => pattern.test(relativePath));
}

async function validateManifest(webDistRoot, fileSet) {
  const manifestPath = join(webDistRoot, "manifest.webmanifest");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (!Array.isArray(manifest.icons) || manifest.icons.length === 0) {
    throw new Error("manifest.webmanifest must declare at least one icon");
  }
  for (const icon of manifest.icons) {
    if (typeof icon?.src !== "string" || icon.src.length === 0) {
      throw new Error("manifest.webmanifest contains an icon without src");
    }
    const iconPath = icon.src.replace(/^\/+/, "");
    if (!fileSet.has(iconPath)) {
      throw new Error(
        `manifest icon is missing from apps/web/dist: ${icon.src}`,
      );
    }
  }
}

async function validateVersionFile(webDistRoot, fileSet) {
  const versionPath = join(webDistRoot, "version.json");
  const version = JSON.parse(await readFile(versionPath, "utf8"));
  if (typeof version.buildId !== "string" || version.buildId.length === 0) {
    throw new Error("version.json must contain a buildId");
  }
  if (!Array.isArray(version.assets) || version.assets.length === 0) {
    throw new Error("version.json must contain a non-empty assets list");
  }
  for (const asset of version.assets) {
    if (typeof asset !== "string" || !asset.startsWith("/")) {
      throw new Error(`Invalid version asset entry: ${JSON.stringify(asset)}`);
    }
    const relativeAsset = asset.slice(1);
    if (!fileSet.has(relativeAsset)) {
      throw new Error(`version.json references a missing asset: ${asset}`);
    }
  }
}

export async function verifyWebDist(webDistRoot) {
  const fileRecords = (
    await Promise.all(
      (await listFiles(webDistRoot)).map(async (file) => ({
        absolutePath: file,
        relativePath: normalizePath(relative(webDistRoot, file)),
        details: await stat(file),
      })),
    )
  ).sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  const relatives = fileRecords.map((record) => record.relativePath);
  const fileSet = new Set(relatives);

  for (const required of REQUIRED_CLIENT_FILES) {
    if (!fileSet.has(required)) {
      throw new Error(`Missing required web build artifact: ${required}`);
    }
  }

  for (const { relativePath, details } of fileRecords) {
    if (isForbiddenFile(relativePath)) {
      throw new Error(`Forbidden file in apps/web/dist: ${relativePath}`);
    }
    if (details.size > MAX_ASSET_SIZE_BYTES) {
      throw new Error(
        `Asset exceeds ${MAX_ASSET_SIZE_BYTES} bytes: ${relativePath} (${details.size})`,
      );
    }
  }

  await validateManifest(webDistRoot, fileSet);
  await validateVersionFile(webDistRoot, fileSet);

  return relatives;
}

async function copyClientArtifacts(webDistRoot, siteClientRoot, files) {
  for (const relativePath of files) {
    if (OMITTED_CLIENT_FILES.has(relativePath)) continue;
    const source = join(webDistRoot, relativePath);
    const target = join(siteClientRoot, relativePath);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(source, target);
  }
}

async function writeWorkerEntry(workerSourcePath, siteServerRoot) {
  const source = await readFile(workerSourcePath, "utf8");
  await mkdir(siteServerRoot, { recursive: true });
  await writeFile(join(siteServerRoot, "index.js"), source);
}

function pnpmCommand(platform = process.platform) {
  return platform === "win32" ? "pnpm.cmd" : "pnpm";
}

function createPnpmSpawnSpec(args, platform = process.platform) {
  const command = pnpmCommand(platform);
  if (platform === "win32") {
    const shell = process.env.ComSpec ?? "cmd.exe";
    const commandLine = [command, ...args]
      .map((value) => (/\s/.test(value) ? `"${value}"` : value))
      .join(" ");
    return {
      command: shell,
      args: ["/d", "/s", "/c", commandLine],
    };
  }
  return { command, args };
}

export async function runWebBuild(projectRoot) {
  await new Promise((resolvePromise, rejectPromise) => {
    const spec = createPnpmSpawnSpec(["--filter", "@chess-coach/web", "build"]);
    const child = spawn(spec.command, spec.args, {
      cwd: projectRoot,
      stdio: "inherit",
      windowsHide: true,
    });
    child.once("error", rejectPromise);
    child.once("exit", (code) => {
      if (code === 0) {
        resolvePromise(undefined);
        return;
      }
      rejectPromise(new Error(`Web build failed with exit code ${code}`));
    });
  });
}

export async function buildSitesBundle({
  projectRoot,
  runWebBuildStep = runWebBuild,
  paths = createProjectPaths(projectRoot),
} = {}) {
  await runWebBuildStep(paths.projectRoot);
  const webFiles = await verifyWebDist(paths.webDistRoot);

  assertSafeSiteDist(paths.projectRoot, paths.siteDistRoot, paths.webDistRoot);
  await rm(paths.siteDistRoot, { force: true, recursive: true });
  await mkdir(paths.siteClientRoot, { recursive: true });

  await copyClientArtifacts(paths.webDistRoot, paths.siteClientRoot, webFiles);
  await writeWorkerEntry(paths.workerSourcePath, paths.siteServerRoot);

  return {
    clientFiles: webFiles.filter((file) => !OMITTED_CLIENT_FILES.has(file)),
    serverEntry: "server/index.js",
  };
}

async function main() {
  const result = await buildSitesBundle();
  process.stdout.write(
    `Built Sites bundle with ${result.clientFiles.length} client files and ${result.serverEntry}.\n`,
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
