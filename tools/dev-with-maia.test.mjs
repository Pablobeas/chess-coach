import assert from "node:assert/strict";
import test from "node:test";
import {
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

test("uses cmd.exe indirection for Vite on Windows", () => {
  const spec = createViteSpawnSpec({
    platform: "win32",
    pnpmCommand: "C:\\tools\\pnpm.cmd",
    port: 5173,
  });

  assert.equal(spec.command.toLowerCase().endsWith("cmd.exe"), true);
  assert.deepEqual(spec.args, [
    "/d",
    "/s",
    "/c",
    "C:\\tools\\pnpm.cmd --filter @chess-coach/web exec vite --host 127.0.0.1 --port 5173 --strictPort --force",
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
  assert.deepEqual(releasedPorts, [8765]);
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
