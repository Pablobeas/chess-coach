import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, extname, join, relative, resolve, sep } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const PAGES_CSP_DIRECTIVES = Object.freeze([
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  "connect-src 'self'",
  "img-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-src 'none'",
]);
export const PAGES_META_CSP = PAGES_CSP_DIRECTIVES.join("; ");
export const PAGES_CSP_META_TAG = `<meta http-equiv="Content-Security-Policy" content="${PAGES_META_CSP}" />`;
export const PAGES_CSP_MARKER = "<!-- __CHESS_COACH_PAGES_CSP__ -->";
export const FORBIDDEN_PUBLISH_PATH_PATTERNS = Object.freeze([
  /(^|\/)\.git(\/|$)/i,
  /(^|\/)\.env(?:\.[^/]+)?$/i,
  /(^|\/)\.runtime(\/|$)/i,
  /\.map$/i,
  /(^|\/)[^/]*checkpoint[^/]*(\/|$)/i,
  /(^|\/)(?:id_(?:rsa|dsa|ecdsa|ed25519)|known_hosts|authorized_keys)(?:\.[^/]+)?$/i,
  /(^|\/)[^/]*(?:credential|secret)[^/]*(\.[^/]+)?$/i,
  /\.(?:pem|key|p12|pfx)$/i,
]);
const ALLOWED_EXTENSIONLESS_ARTIFACTS = new Set(["_headers", ".nojekyll", "CNAME"]);
const ALLOWED_PUBLISH_EXTENSIONS = new Set([
  ".avif",
  ".css",
  ".gif",
  ".html",
  ".ico",
  ".jpeg",
  ".jpg",
  ".js",
  ".json",
  ".mjs",
  ".ogg",
  ".png",
  ".svg",
  ".txt",
  ".wasm",
  ".wav",
  ".webm",
  ".webmanifest",
  ".webp",
  ".woff",
  ".woff2",
  ".xml",
]);
const REQUIRED_PUBLISH_HTML_FILES = Object.freeze(["index.html", "404.html"]);

function normalizePath(pathname) {
  return pathname.split(sep).join("/");
}

function isAllowedPublishArtifact(relativePath) {
  const filename = basename(relativePath);
  if (ALLOWED_EXTENSIONLESS_ARTIFACTS.has(filename)) {
    return true;
  }
  return ALLOWED_PUBLISH_EXTENSIONS.has(extname(filename).toLowerCase());
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
  if (!isAllowedPublishArtifact(relativePath)) {
    throw new Error(`Unexpected publish artifact type: ${relativePath}`);
  }
}

async function preparePublishHtmlArtifact(sourceRoot, relativePath) {
  const absolutePath = join(sourceRoot, relativePath);
  let html;
  try {
    html = await readFile(absolutePath, "utf8");
  } catch (error) {
    const message =
      error instanceof Error ? error.message : `Missing publish artifact: ${relativePath}`;
    throw new Error(`Publish artifact ${relativePath} is not accessible: ${message}`);
  }
  const hasMarker = html.includes(PAGES_CSP_MARKER);
  const hasMeta = html.includes(PAGES_CSP_META_TAG);

  if (!hasMarker && !hasMeta) {
    throw new Error(
      `Publish artifact ${relativePath} must include ${PAGES_CSP_MARKER} or ${PAGES_CSP_META_TAG}`,
    );
  }

  if (hasMarker) {
    const nextHtml = html.replace(PAGES_CSP_MARKER, PAGES_CSP_META_TAG);
    if (nextHtml !== html) {
      await writeFile(absolutePath, nextHtml);
    }
  }
}

async function preparePublishTree(sourceRoot) {
  for (const relativePath of REQUIRED_PUBLISH_HTML_FILES) {
    await preparePublishHtmlArtifact(sourceRoot, relativePath);
  }
}

export async function validatePublishTree(sourceRoot) {
  await assertDirectory(sourceRoot, "Publish source");
  await preparePublishTree(sourceRoot);
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

async function main(argv = process.argv.slice(2)) {
  const [command, sourceArg] = argv;
  if (command === "validate" && sourceArg) {
    const files = await validatePublishTree(resolve(sourceArg));
    process.stdout.write(`Validated ${files.length} publish artifacts.\n`);
    return;
  }

  const scriptPath = fileURLToPath(import.meta.url);
  const scriptName = normalizePath(relative(process.cwd(), scriptPath));
  throw new Error(
    `Usage: node ${scriptName} validate <source-dir>`,
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
