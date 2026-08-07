import assert from "node:assert/strict";
import test from "node:test";
import {
  createBridgeSpawnEnv,
  DEFAULT_WEB_PORTS,
  createViteSpawnSpec,
  parseViteDevServerUrl,
  runDevSession,
  selectWebPort,
  waitForBridgeHealth,
} from "./dev-with-maia.mjs";

function createFakeProcess() {
  const listeners = new Map();
  return {
    on(event, listener) {
      listeners.set(event, listener);
    },
    off(event, listener) {
      if (listeners.get(event) === listener) listeners.delete(event);
    },
    emit(event, value = event) {
      listeners.get(event)?.(value);
    },
  };
}

function createFakeChild(pid) {
  return {
    pid,
    exitCode: null,
    terminated: 0,
  };
}

test("selects the first available dev port from the preferred list", async () => {
  const port = await selectWebPort(
    DEFAULT_WEB_PORTS,
    async (candidate) => candidate === 5174,
  );

  assert.equal(port, 5174);
});

test("extracts the actual Vite URL from launcher output", () => {
  assert.equal(
    parseViteDevServerUrl("  Local:   http://127.0.0.1:5175/"),
    "http://127.0.0.1:5175/",
  );
  assert.equal(parseViteDevServerUrl("ready in 250ms"), undefined);
});

test("uses Windows PowerShell for Vite when the target platform is win32", () => {
  const spec = createViteSpawnSpec({
    platform: "win32",
    pnpmCommand: "C:\\tools\\pnpm.cmd",
    port: 5173,
  });

  assert.equal(spec.command, "powershell.exe");
  assert.deepEqual(spec.args, [
    "-NoProfile",
    "-Command",
    "& 'C:\\tools\\pnpm.cmd' '--filter' '@chess-coach/web' 'exec' 'vite' '--host' '127.0.0.1' '--port' '5173' '--strictPort' '--force'",
  ]);
});

test("prefers the Node-adjacent corepack shim for Vite on Windows", () => {
  const spec = createViteSpawnSpec({
    platform: "win32",
    nodeExecutablePath: "C:\\Program Files\\nodejs\\node.exe",
    corepackExists: (pathname) =>
      pathname === "C:\\Program Files\\nodejs\\corepack.cmd",
    port: 5173,
  });

  assert.equal(spec.command.toLowerCase().endsWith("powershell.exe"), true);
  assert.deepEqual(spec.args, [
    "-NoProfile",
    "-Command",
    "& 'C:\\Program Files\\nodejs\\corepack.cmd' 'pnpm' '--filter' '@chess-coach/web' 'exec' 'vite' '--host' '127.0.0.1' '--port' '5173' '--strictPort' '--force'",
  ]);
});

test("always quotes the Windows package manager executable even without spaces", () => {
  const spec = createViteSpawnSpec({
    platform: "win32",
    nodeExecutablePath: "C:\\dev&tools\\node\\node.exe",
    corepackExists: (pathname) =>
      pathname === "C:\\dev&tools\\node\\corepack.cmd",
    port: 5173,
  });

  assert.deepEqual(spec.args, [
    "-NoProfile",
    "-Command",
    "& 'C:\\dev&tools\\node\\corepack.cmd' 'pnpm' '--filter' '@chess-coach/web' 'exec' 'vite' '--host' '127.0.0.1' '--port' '5173' '--strictPort' '--force'",
  ]);
});

test("waits until the bridge health endpoint is truly ready", async () => {
  const responses = [
    new Response(JSON.stringify({ status: "warming" }), { status: 200 }),
    new Response(JSON.stringify({ status: "ready", backend: "maia3-local" }), {
      status: 200,
    }),
  ];

  const ready = await waitForBridgeHealth({
    url: "http://127.0.0.1:8765/health",
    timeoutMs: 100,
    intervalMs: 0,
    fetchImpl: async () => {
      const response = responses.shift();
      if (!response) throw new Error("No more responses");
      return response;
    },
    isBridgeAlive: () => true,
  });

  assert.deepEqual(ready, { status: "ready", backend: "maia3-local" });
});

test("builds the bridge child env with exactly the selected web port allowlisted", () => {
  const env = createBridgeSpawnEnv(
    {
      maiaEngine: "C:\\runtime\\python.exe",
      runtimeRoot: "C:\\runtime",
    },
    8765,
    5179,
    {
      BASE: "1",
      MAIA3_ALLOWED_WEB_PORTS: "9999",
    },
  );

  assert.equal(env.MAIA3_ENGINE_PATH, "C:\\runtime\\python.exe");
  assert.equal(env.MAIA3_BRIDGE_HOST, "127.0.0.1");
  assert.equal(env.MAIA3_BRIDGE_PORT, "8765");
  assert.equal(env.MAIA3_ALLOWED_WEB_PORTS, "5179");
});

test("fails fast when the bridge process exits before health becomes ready", async () => {
  await assert.rejects(
    waitForBridgeHealth({
      url: "http://127.0.0.1:8765/health",
      timeoutMs: 100,
      intervalMs: 0,
      fetchImpl: async () =>
        new Response(JSON.stringify({ status: "warming" }), { status: 200 }),
      isBridgeAlive: () => false,
    }),
    /termino antes de responder health/i,
  );
});

test("cleans a registered bridge child when startup fails before ready", async () => {
  const bridgeChild = createFakeChild(101);
  const releasedPorts = [];

  await assert.rejects(
    runDevSession(
      {},
      {
        paths: { logsRoot: ".runtime/dev-with-maia-test-bridge-timeout" },
        runSetupScript: async () => undefined,
        selectBridgePort: async () => 8765,
        startBridge: async (_paths, _port, { registerChild }) => {
          registerChild(bridgeChild);
          throw new Error("bridge timeout");
        },
        terminateProcess: async (child) => {
          child.terminated += 1;
          child.exitCode = 1;
        },
        waitForPortRelease: async (port) => {
          releasedPorts.push(port);
        },
        processLike: createFakeProcess(),
        log: () => undefined,
      },
    ),
    /bridge timeout/,
  );

  assert.equal(bridgeChild.terminated, 1);
  assert.deepEqual(releasedPorts, [8765, 5173]);
});

test("cleans bridge and vite exactly once when Vite startup fails", async () => {
  const bridgeChild = createFakeChild(201);
  const viteChild = createFakeChild(202);
  const releasedPorts = [];

  await assert.rejects(
    runDevSession(
      {},
      {
        paths: { logsRoot: ".runtime/dev-with-maia-test-vite-failure" },
        runSetupScript: async () => undefined,
        selectBridgePort: async () => 8765,
        selectWebPort: async () => 5173,
        startBridge: async (_paths, _port, { registerChild }) => ({
          child: registerChild(bridgeChild),
          readyMs: 1,
        }),
        startVite: async (_paths, _bridgePort, _webPort, { registerChild }) => {
          registerChild(viteChild);
          throw new Error("vite startup failed");
        },
        terminateProcess: async (child) => {
          child.terminated += 1;
          child.exitCode = 1;
        },
        waitForPortRelease: async (port) => {
          releasedPorts.push(port);
        },
        processLike: createFakeProcess(),
        log: () => undefined,
      },
    ),
    /vite startup failed/,
  );

  assert.equal(bridgeChild.terminated, 1);
  assert.equal(viteChild.terminated, 1);
  assert.deepEqual(releasedPorts, [8765, 5173]);
});

test("signal during setup kills only the setup child and never starts bridge or vite", async () => {
  const setupChild = createFakeChild(301);
  const fakeProcess = createFakeProcess();
  let bridgeStarted = false;
  let viteStarted = false;

  const result = await runDevSession(
    {},
    {
      paths: { logsRoot: ".runtime/dev-with-maia-test-setup-signal" },
      runSetupScript: async (_paths, { registerChild }) => {
        registerChild(setupChild);
        queueMicrotask(() => fakeProcess.emit("SIGINT", "SIGINT"));
        return new Promise(() => undefined);
      },
      startBridge: async () => {
        bridgeStarted = true;
        throw new Error("bridge should not start");
      },
      startVite: async () => {
        viteStarted = true;
        throw new Error("vite should not start");
      },
      terminateProcess: async (child) => {
        child.terminated += 1;
        child.exitCode = 1;
      },
      waitForPortRelease: async () => undefined,
      processLike: fakeProcess,
      log: () => undefined,
    },
  );

  assert.equal(result.mode, "serve");
  assert.deepEqual(result.exit, {
    label: "signal",
    code: 0,
    signal: "SIGINT",
  });
  assert.equal(setupChild.terminated, 1);
  assert.equal(bridgeStarted, false);
  assert.equal(viteStarted, false);
});

test("selects the web port before starting the bridge and passes only that port", async () => {
  const fakeProcess = createFakeProcess();
  const calls = [];

  const result = await runDevSession(
    {},
    {
      paths: { logsRoot: ".runtime/dev-with-maia-test-allowed-web-port" },
      runSetupScript: async () => undefined,
      selectWebPort: async (preferredPorts) => {
        calls.push(`selectWeb:${preferredPorts.join(",")}`);
        return 5179;
      },
      selectBridgePort: async (preferredPorts) => {
        calls.push(`selectBridge:${preferredPorts.join(",")}`);
        return 8765;
      },
      startBridge: async (_paths, _bridgePort, options) => {
        calls.push(`startBridge:${options.allowedWebPort}`);
        return {
          child: options.registerChild(createFakeChild(401)),
          readyMs: 1,
        };
      },
      startVite: async (_paths, bridgePort, webPort, { registerChild }) => {
        calls.push(`startVite:${bridgePort}:${webPort}`);
        const child = registerChild(createFakeChild(402));
        setTimeout(() => {
          child.exitCode = 0;
          child.onceExit?.({ code: 0, signal: null });
        }, 0);
        return {
          child,
          url: `http://127.0.0.1:${webPort}/`,
          readyMs: 1,
          logs: { read: () => "" },
        };
      },
      waitForChildExit: (child, label) =>
        new Promise((resolve) => {
          child.onceExit = (exit) => resolve({ label, ...exit });
        }),
      terminateProcess: async (child) => {
        child.terminated += 1;
        child.exitCode = 0;
      },
      waitForPortRelease: async () => undefined,
      processLike: fakeProcess,
      log: () => undefined,
    },
  );

  assert.equal(result.mode, "serve");
  assert.deepEqual(calls, [
    "selectWeb:5173,5174",
    "selectBridge:8765,8766,8767",
    "startBridge:5179",
    "startVite:8765:5179",
  ]);
});
