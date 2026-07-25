const NO_STORE_CACHE_CONTROL = "no-store, no-cache, must-revalidate";
const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";
const STATIC_CACHE_CONTROL = "public, max-age=3600, must-revalidate";

const SECURITY_HEADERS = Object.freeze({
  "content-security-policy":
    "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
  "permissions-policy":
    "accelerometer=(), autoplay=(), camera=(), geolocation=(), gyroscope=(), microphone=(), payment=(), usb=()",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
});

const NO_STORE_PATHS = new Set([
  "/index.html",
  "/manifest.webmanifest",
  "/sw.js",
  "/version.json",
]);

function withSecurityHeaders(headers) {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    headers.set(name, value);
  }
}

function isApiRequest(pathname) {
  return pathname === "/maia3-api" || pathname.startsWith("/maia3-api/");
}

function hasFileExtension(pathname) {
  const lastSegment = pathname.split("/").at(-1) ?? "";
  return lastSegment.includes(".");
}

function containsPathTraversal(pathname) {
  for (const rawSegment of pathname.split("/")) {
    if (!rawSegment) continue;
    let segment;
    try {
      segment = decodeURIComponent(rawSegment);
    } catch {
      return true;
    }
    if (
      segment === "." ||
      segment === ".." ||
      segment.includes("/") ||
      segment.includes("\\") ||
      segment.includes("\0")
    ) {
      return true;
    }
  }
  return false;
}

function extractRawPath(requestUrl) {
  const withoutOrigin = requestUrl.replace(/^[a-z]+:\/\/[^/]+/i, "");
  if (!withoutOrigin) return "/";
  return withoutOrigin.split(/[?#]/u, 1)[0] || "/";
}

function isHtmlNavigation(request, pathname) {
  if (isApiRequest(pathname) || hasFileExtension(pathname)) return false;

  const mode = request.headers.get("sec-fetch-mode");
  if (mode === "navigate") return true;

  const destination = request.headers.get("sec-fetch-dest");
  if (destination === "document" || destination === "iframe") return true;

  const accept = request.headers.get("accept") ?? "";
  return (
    accept.includes("text/html") || accept.includes("application/xhtml+xml")
  );
}

function selectCacheControl(pathname) {
  if (NO_STORE_PATHS.has(pathname)) return NO_STORE_CACHE_CONTROL;
  if (pathname.startsWith("/assets/") || pathname.startsWith("/stockfish/")) {
    return IMMUTABLE_CACHE_CONTROL;
  }
  return STATIC_CACHE_CONTROL;
}

function createAssetRequest(request, pathname) {
  const url = new URL(request.url);
  url.pathname = pathname;
  url.search = "";
  return new Request(url, {
    method: request.method,
    headers: request.headers,
    redirect: request.redirect,
  });
}

function createErrorResponse(status, statusText, method = "GET") {
  const headers = new Headers({
    "cache-control": NO_STORE_CACHE_CONTROL,
    "content-type": "text/plain; charset=utf-8",
  });
  withSecurityHeaders(headers);
  return new Response(method === "HEAD" ? null : statusText, {
    status,
    headers,
  });
}

function finalizeAssetResponse(response, pathname) {
  const headers = new Headers(response.headers);
  withSecurityHeaders(headers);
  headers.set("cache-control", selectCacheControl(pathname));

  if (pathname === "/sw.js") {
    headers.set("content-type", "application/javascript; charset=utf-8");
    headers.set("service-worker-allowed", "/");
  }

  if (pathname.endsWith(".wasm") && !headers.has("content-type")) {
    headers.set("content-type", "application/wasm");
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export async function handleSiteRequest(request, env) {
  const method = request.method.toUpperCase();
  const rawPath = extractRawPath(request.url);
  const url = new URL(request.url);

  if (containsPathTraversal(rawPath) || containsPathTraversal(url.pathname)) {
    return createErrorResponse(400, "Bad Request", method);
  }

  if (isApiRequest(url.pathname)) {
    return createErrorResponse(404, "Not Found", method);
  }

  if (method !== "GET" && method !== "HEAD") {
    return createErrorResponse(405, "Method Not Allowed", method);
  }

  const pathname =
    url.pathname === "/" || isHtmlNavigation(request, url.pathname)
      ? "/index.html"
      : url.pathname;
  const assetResponse = await env.ASSETS.fetch(
    createAssetRequest(request, pathname),
  );

  if (assetResponse.status === 404 && pathname === "/index.html") {
    return createErrorResponse(404, "Not Found", method);
  }

  return finalizeAssetResponse(assetResponse, pathname);
}

export function createSiteWorker() {
  return {
    fetch(request, env) {
      return handleSiteRequest(request, env);
    },
  };
}

export default createSiteWorker();
