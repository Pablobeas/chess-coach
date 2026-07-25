import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HOST = "127.0.0.1";
const DEFAULT_BRIDGE_PORTS = Object.freeze([8765, 8766, 8767]);
export const DEFAULT_WEB_PORTS = Object.freeze([5173, 5174]);
const BRIDGE_HEALTH_TIMEOUT_MS = 75_000;
const SERVER_START_TIMEOUT_MS = 20_000;
const DEFAULT_HEALTH_INTERVAL_MS = 250;
const LOG_PREFIX = "[dev]";
const MOVE_REQUEST = Object.freeze({
  id: "launcher-smoke",
  fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
  initialFen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
  moves: [],
  selfElo: 600,
  opponentElo: 600,
  temperature: 1,
  multiPv: 1,
});

function log(message) {
  process.stdout.write(`${LOG_PREFIX} ${message}\n`);
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function normalizeErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

async function isPortAvailable(port, host = HOST) {
  return new Promise((resolve) => {
    const server = createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.listen(port, host, () => {
      server.close(() => resolve(true));
    });
  });
}

async function waitForPortRelease(port, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isPortAvailable(port, HOST)) return;
    await sleep(100);
  }
  throw new Error(`El puerto ${port} no se libero tras ${timeoutMs}ms`);
}

export async function selectWebPort(
  preferredPorts = DEFAULT_WEB_PORTS,
  checkAvailability = (candidate) => isPortAvailable(candidate, HOST),
) {
  for (const candidate of preferredPorts) {
    if (await checkAvailability(candidate)) return candidate;
  }
  let candidate = (preferredPorts.at(-1) ?? 5173) + 1;
  while (!(await checkAvailability(candidate))) candidate += 1;
  return candidate;
}

export function parseViteDevServerUrl(line) {
  const match = String(line).match(/\bhttps?:\/\/[^\s]+/);
  return match?.[0];
}

export function createViteSpawnSpec({
  platform = process.platform,
  pnpmCommand = platform === "win32" ? "pnpm.cmd" : "pnpm",
  host = HOST,
  port,
} = {}) {
  const viteArgs = [
    "--filter",
    "@chess-coach/web",
    "exec",
    "vite",
    "--host",
    host,
    "--port",
    String(port),
    "--strictPort",
    "--force",
  ];

  if (platform === "win32") {
    const shell = process.env.ComSpec ?? "cmd.exe";
    const commandLine = [pnpmCommand, ...viteArgs]
      .map((value) => (/\s/.test(value) ? `"${value}"` : value))
      .join(" ");
    return {
      command: shell,
      args: ["/d", "/s", "/c", commandLine],
    };
  }

  return {
    command: pnpmCommand,
    args: viteArgs,
  };
}

function createTailBuffer(maxEntries = 200) {
  const entries = [];
  return {
    push(chunk) {
      const text = String(chunk);
      for (const line of text.split(/\r?\n/)) {
        if (!line.trim()) continue;
        entries.push(line);
      }
      if (entries.length > maxEntries) {
        entries.splice(0, entries.length - maxEntries);
      }
    },
    read() {
      return entries.join("\n");
    },
  };
}

function pipeChildOutput(child, tailBuffer, onText) {
  for (const [stream, writer] of [
    [child.stdout, process.stdout],
    [child.stderr, process.stderr],
  ]) {
    if (!stream) continue;
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      tailBuffer.push(chunk);
      onText?.(String(chunk));
      writer.write(chunk);
    });
  }
}

function projectPaths() {
  const toolPath = fileURLToPath(import.meta.url);
  const projectRoot = resolve(dirname(toolPath), "..");
  const runtimeRoot = join(projectRoot, ".runtime", "maia3");
  return {
    projectRoot,
    runtimeRoot,
    logsRoot: join(runtimeRoot, "logs"),
    setupScript: join(projectRoot, "tools", "setup-maia3.ps1"),
    bridgeScript: join(projectRoot, "tools", "maia3-bridge.mjs"),
    maiaEngine: join(runtimeRoot, "venv", "Scripts", "python.exe"),
    webRoot: join(projectRoot, "apps", "web"),
  };
}

function createProcessExitPromise(child, label) {
  return new Promise((resolve) => {
    child.once("exit", (code, signal) =>
      resolve({
        label,
        code: code ?? null,
        signal: signal ?? null,
      }),
    );
  });
}

function processDescription(result) {
  return `${result.label} exited with code ${result.code ?? "null"}${result.signal ? ` (${signalToString(result.signal)})` : ""}`;
}

function signalToString(signal) {
  return signal ?? "";
}

class SignalExitError extends Error {
  constructor(exit) {
    super(`Launcher interrupted by ${exit.signal}`);
    this.name = "SignalExitError";
    this.exit = exit;
  }
}

function raceWithSignal(promise, signalExit) {
  return Promise.race([
    promise,
    signalExit.then((exit) => {
      throw new SignalExitError(exit);
    }),
  ]);
}

async function terminateProcessTree(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === "win32") {
    await new Promise((resolve) => {
      const killer = spawn(
        "taskkill",
        ["/pid", String(child.pid), "/t", "/f"],
        {
          stdio: "ignore",
          windowsHide: true,
        },
      );
      killer.once("exit", () => resolve(undefined));
      killer.once("error", () => resolve(undefined));
    });
    return;
  }
  child.kill("SIGTERM");
  await Promise.race([
    createProcessExitPromise(child, "child"),
    sleep(2_000).then(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
    }),
  ]);
}

export function createChildCleanup({
  terminateProcess = terminateProcessTree,
} = {}) {
  const ownedChildren = [];
  let cleaningUp = false;

  return {
    track(child) {
      if (!child) return child;
      ownedChildren.push(child);
      return child;
    },
    async cleanup() {
      if (cleaningUp) return;
      cleaningUp = true;
      await Promise.allSettled(
        ownedChildren.map((child) => terminateProcess(child)),
      );
    },
  };
}

function powershellCommand() {
  return process.platform === "win32" ? "powershell.exe" : "pwsh";
}

async function runSetupScript(
  paths,
  { registerChild = (child) => child } = {},
) {
  log("Preparando el runtime local de Maia-3.");
  await new Promise((resolve, reject) => {
    const child = registerChild(
      spawn(
        powershellCommand(),
        [
          "-NoProfile",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          paths.setupScript,
        ],
        {
          cwd: paths.projectRoot,
          stdio: "inherit",
          windowsHide: true,
        },
      ),
    );
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve(undefined);
        return;
      }
      reject(new Error(`setup-maia3.ps1 failed with exit code ${code}`));
    });
  });
}

async function waitForHttpServer(
  url,
  isAlive,
  timeoutMs = SERVER_START_TIMEOUT_MS,
) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    if (!isAlive()) {
      throw new Error(`El servidor termino antes de responder en ${url}`);
    }
    try {
      const response = await fetch(url, { method: "GET" });
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(150);
  }
  throw new Error(
    `No se pudo abrir ${url}. Ultimo error: ${normalizeErrorMessage(lastError)}`,
  );
}

export async function waitForBridgeHealth({
  url,
  timeoutMs = BRIDGE_HEALTH_TIMEOUT_MS,
  intervalMs = DEFAULT_HEALTH_INTERVAL_MS,
  fetchImpl = fetch,
  isBridgeAlive = () => true,
}) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    if (!isBridgeAlive()) {
      throw new Error(
        `El bridge de Maia-3 termino antes de responder health en ${url}`,
      );
    }
    try {
      const response = await fetchImpl(url, {
        headers: { accept: "application/json" },
      });
      if (response.ok) {
        const body = await response.json();
        if (body?.status === "ready") return body;
        lastError = new Error(`health=${JSON.stringify(body)}`);
      } else {
        lastError = new Error(`HTTP ${response.status}`);
      }
    } catch (error) {
      lastError = error;
    }
    await sleep(intervalMs);
  }
  throw new Error(
    `Maia-3 no estuvo listo tras ${timeoutMs}ms. Ultimo error: ${normalizeErrorMessage(lastError)}`,
  );
}

function openBrowser(url) {
  if (process.platform === "win32") {
    const child = spawn("cmd.exe", ["/c", "start", "", url], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
    return;
  }
  const command = process.platform === "darwin" ? "open" : "xdg-open";
  const child = spawn(command, [url], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

async function startBridge(
  paths,
  bridgePort,
  { registerChild = (child) => child } = {},
) {
  const tail = createTailBuffer();
  const child = registerChild(
    spawn(process.execPath, [paths.bridgeScript], {
      cwd: paths.projectRoot,
      env: {
        ...process.env,
        MAIA3_ENGINE_PATH: paths.maiaEngine,
        MAIA3_BRIDGE_HOST: HOST,
        MAIA3_BRIDGE_PORT: String(bridgePort),
        HF_HOME: join(paths.runtimeRoot, "huggingface"),
        MAIA3_ENGINE_MODE: "python-entrypoint",
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    }),
  );
  pipeChildOutput(child, tail);
  const healthUrl = `http://${HOST}:${bridgePort}/health`;
  const startedAt = Date.now();
  try {
    await waitForBridgeHealth({
      url: healthUrl,
      isBridgeAlive: () => child.exitCode === null,
    });
  } catch (error) {
    const diagnostics = tail.read();
    throw new Error(
      `${normalizeErrorMessage(error)}${
        diagnostics ? `\n--- bridge logs ---\n${diagnostics}` : ""
      }`,
    );
  }
  return {
    child,
    healthUrl,
    readyMs: Date.now() - startedAt,
  };
}

async function startVite(
  paths,
  bridgePort,
  webPort,
  { registerChild = (child) => child } = {},
) {
  const tail = createTailBuffer();
  let resolvedUrl;
  const viteSpawn = createViteSpawnSpec({ port: webPort });
  const child = registerChild(
    spawn(viteSpawn.command, viteSpawn.args, {
      cwd: paths.projectRoot,
      env: {
        ...process.env,
        MAIA3_BRIDGE_HOST: HOST,
        MAIA3_BRIDGE_PORT: String(bridgePort),
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    }),
  );
  pipeChildOutput(child, tail, (text) => {
    const parsedUrl = parseViteDevServerUrl(text);
    if (parsedUrl) resolvedUrl = parsedUrl;
  });
  const startedAt = Date.now();
  const fallbackUrl = `http://${HOST}:${webPort}/`;
  await waitForHttpServer(fallbackUrl, () => child.exitCode === null);
  return {
    child,
    url: resolvedUrl ?? fallbackUrl,
    readyMs: Date.now() - startedAt,
    logs: tail,
  };
}

async function smokeTest(baseUrl) {
  const baseStartedAt = Date.now();
  const home = await fetch(baseUrl, { method: "GET" });
  if (!home.ok) {
    throw new Error(`La web devolvio HTTP ${home.status} en ${baseUrl}`);
  }
  const moveStartedAt = Date.now();
  const move = await fetch(new URL("/maia3-api/move", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(MOVE_REQUEST),
  });
  if (!move.ok) {
    throw new Error(
      `El proxy Maia devolvio HTTP ${move.status}: ${await move.text()}`,
    );
  }
  const result = await move.json();
  if (typeof result?.move !== "string") {
    throw new Error(
      `La respuesta de Maia-3 no contiene move: ${JSON.stringify(result)}`,
    );
  }
  return {
    homeMs: Date.now() - baseStartedAt,
    moveMs: Date.now() - moveStartedAt,
    move: result.move,
  };
}

export async function runDevSession(options = {}, deps = {}) {
  const resolvedOptions = {
    open: false,
    smokeTest: false,
    ...options,
  };
  const processLike = deps.processLike ?? process;
  const logMessage = deps.log ?? log;
  const paths = deps.paths ?? projectPaths();
  const childCleanup = createChildCleanup({
    terminateProcess: deps.terminateProcess ?? terminateProcessTree,
  });
  let bridgePort;
  let webPort;
  let resolveSignalExit;
  const signalExit = new Promise((resolve) => {
    resolveSignalExit = resolve;
  });
  const onSignal = (signal) => {
    logMessage(`Recibida senal ${signal}; cerrando Vite y Maia-3.`);
    resolveSignalExit({ label: "signal", code: 0, signal });
  };

  processLike.on?.("SIGINT", onSignal);
  processLike.on?.("SIGTERM", onSignal);

  try {
    mkdirSync(paths.logsRoot, { recursive: true });
    await raceWithSignal(
      (deps.runSetupScript ?? runSetupScript)(paths, {
        registerChild: (child) => childCleanup.track(child),
      }),
      signalExit,
    );

    bridgePort = await raceWithSignal(
      (deps.selectBridgePort ?? selectWebPort)(DEFAULT_BRIDGE_PORTS),
      signalExit,
    );
    logMessage(`Levantando Maia-3 en ${HOST}:${bridgePort}.`);
    const bridge = await raceWithSignal(
      (deps.startBridge ?? startBridge)(paths, bridgePort, {
        registerChild: (child) => childCleanup.track(child),
      }),
      signalExit,
    );
    logMessage(`Maia-3 listo en ${bridge.readyMs} ms.`);

    webPort = await raceWithSignal(
      (deps.selectWebPort ?? selectWebPort)(DEFAULT_WEB_PORTS),
      signalExit,
    );
    logMessage(`Levantando Vite en ${HOST}:${webPort}.`);
    const vite = await raceWithSignal(
      (deps.startVite ?? startVite)(paths, bridgePort, webPort, {
        registerChild: (child) => childCleanup.track(child),
      }),
      signalExit,
    );
    logMessage(`Vite listo en ${vite.readyMs} ms.`);
    logMessage(`URL activa: ${vite.url}`);

    if (resolvedOptions.open) {
      (deps.openBrowser ?? openBrowser)(vite.url);
    }

    if (resolvedOptions.smokeTest) {
      const result = await raceWithSignal(
        (deps.smokeTest ?? smokeTest)(vite.url),
        signalExit,
      );
      logMessage(
        `Smoke test OK: home=${result.homeMs} ms, move=${result.moveMs} ms, move=${result.move}.`,
      );
      return {
        mode: "smoke",
        bridgePort,
        webPort,
        result,
      };
    }

    const waitForChildExit = deps.waitForChildExit ?? createProcessExitPromise;
    const exit = await Promise.race([
      waitForChildExit(vite.child, "vite"),
      waitForChildExit(bridge.child, "maia3-bridge"),
      signalExit,
    ]);
    logMessage(processDescription(exit));
    return {
      mode: "serve",
      bridgePort,
      webPort,
      exit,
    };
  } catch (error) {
    if (error instanceof SignalExitError) {
      return {
        mode: "serve",
        bridgePort,
        webPort,
        exit: error.exit,
      };
    }
    throw error;
  } finally {
    processLike.off?.("SIGINT", onSignal);
    processLike.off?.("SIGTERM", onSignal);
    await childCleanup.cleanup();
    if (bridgePort !== undefined) {
      await (deps.waitForPortRelease ?? waitForPortRelease)(bridgePort);
    }
    if (webPort !== undefined) {
      await (deps.waitForPortRelease ?? waitForPortRelease)(webPort);
    }
    if (bridgePort !== undefined || webPort !== undefined) {
      logMessage(
        `Puertos liberados: web=${webPort ?? "n/a"}, bridge=${bridgePort ?? "n/a"}.`,
      );
    }
  }
}

async function main() {
  const options = {
    open: process.argv.includes("--open"),
    smokeTest: process.argv.includes("--smoke-test"),
  };
  const result = await runDevSession(options);
  if (result.mode === "serve") {
    process.exit(result.exit.code ?? 1);
  }
}

const isMain =
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMain) {
  main().catch((error) => {
    process.stderr.write(`${LOG_PREFIX} ${normalizeErrorMessage(error)}\n`);
    process.exit(1);
  });
}
