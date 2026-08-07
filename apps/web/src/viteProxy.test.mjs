import { createInitialGame } from "@chess-coach/chess-core";
import { EventEmitter, once } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { createServer as createViteServer } from "vite";
import { startBridge } from "../../../tools/maia3-bridge.mjs";
import { createMaiaProxyOptions } from "../vite.config";

class ScriptedUciProcess extends EventEmitter {
  constructor() {
    super();
    this.commands = [];
    this.stderr = new PassThrough();
    this.stdout = new PassThrough();
    this.stdin = {
      write: (command) => {
        this.commands.push(command.trim());
        this.respond(command.trim());
        return true;
      },
    };
  }

  respond(command) {
    if (command === "uci") {
      this.stdout.write("id name Maia test\nuciok\n");
      return;
    }
    if (command === "isready") {
      this.stdout.write("readyok\n");
      return;
    }
    if (command === "go nodes 1") {
      this.stdout.write(
        "info multipv 1 wdl 200 300 500 pv e2e4\nbestmove e2e4\n",
      );
    }
  }
}

const requestBody = {
  id: "proxy-opponent",
  fen: createInitialGame().fen,
  initialFen: createInitialGame().initialFen,
  moves: [],
  selfElo: 600,
  opponentElo: 600,
  temperature: 1,
  multiPv: 1,
};

describe("Vite Maia proxy", () => {
  const cleanups = [];

  afterEach(async () => {
    while (cleanups.length > 0) {
      await cleanups.pop()?.();
    }
  });

  it("rewrites Host to the bridge target while preserving browser Origin validation", async () => {
    const bridgeChild = new ScriptedUciProcess();
    const bridge = startBridge({
      enginePath: "fake",
      host: "127.0.0.1",
      port: 0,
      allowedWebPorts: [5173],
      processOptions: {
        spawnProcess: () => bridgeChild,
        log: () => undefined,
      },
    });
    cleanups.push(() => bridge.shutdown());
    await once(bridge.server, "listening");
    const bridgeAddress = bridge.server.address();
    if (!bridgeAddress || typeof bridgeAddress === "string") {
      throw new Error("Bridge did not expose a TCP port");
    }

    const vite = await createViteServer({
      appType: "custom",
      configFile: false,
      server: {
        host: "127.0.0.1",
        port: 5173,
        proxy: {
          "/maia3-api": createMaiaProxyOptions(
            `http://127.0.0.1:${bridgeAddress.port}`,
          ),
        },
        strictPort: true,
      },
    });
    cleanups.push(() => vite.close());
    await vite.listen();

    const allowedResponse = await fetch("http://127.0.0.1:5173/maia3-api/move", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://127.0.0.1:5173",
      },
      body: JSON.stringify(requestBody),
    });
    expect(allowedResponse.status).toBe(200);
    await expect(allowedResponse.json()).resolves.toMatchObject({
      id: "proxy-opponent",
      backend: "maia3-local",
      move: "e2e4",
    });

    const rejectedResponse = await fetch(
      "http://127.0.0.1:5173/maia3-api/move",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://127.0.0.1:5174",
        },
        body: JSON.stringify({ ...requestBody, id: "proxy-rejected-origin" }),
      },
    );
    expect(rejectedResponse.status).toBe(403);
    await expect(rejectedResponse.json()).resolves.toMatchObject({
      error: "Origin no permitido",
    });
  });
});
