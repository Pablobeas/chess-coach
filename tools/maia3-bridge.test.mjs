import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { once } from "node:events";
import { request as httpRequest } from "node:http";
import { PassThrough } from "node:stream";
import test from "node:test";
import {
  Maia3Process,
  MOVE_TIMEOUT_MS,
  WARMUP_TIMEOUT_MS,
  isValidFen,
  parseInfo,
  startBridge,
  validateRequest,
} from "./maia3-bridge.mjs";

class ScriptedUciProcess extends EventEmitter {
  constructor({
    goResponses,
    respond = true,
    responseDelayMs = 0,
    warmupMove = "e2e4",
  } = {}) {
    super();
    this.commands = [];
    this.goResponses = goResponses ? [...goResponses] : undefined;
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.stdin = {
      write: (command) => {
        this.commands.push(command.trim());
        if (respond) {
          const response = () => this.respond(command.trim(), warmupMove);
          if (responseDelayMs > 0) setTimeout(response, responseDelayMs);
          else response();
        }
        return true;
      },
    };
  }

  respond(command, warmupMove) {
    if (command === "uci") this.stdout.write("id name Maia test\nuciok\n");
    if (command === "isready") this.stdout.write("readyok\n");
    if (command === "go nodes 1") {
      const response = this.goResponses?.shift();
      if (response !== undefined) {
        this.stdout.write(response);
        return;
      }
      this.stdout.write(
        `info multipv 1 wdl 200 300 500 pv ${warmupMove}\nbestmove ${warmupMove}\n`,
      );
    }
  }
}

const validRequest = {
  id: "elo-600",
  fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
  initialFen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
  moves: [],
  selfElo: 600,
  opponentElo: 600,
  temperature: 1,
  multiPv: 5,
};

test("accepts Elo 600 and keeps WDL candidates", () => {
  assert.deepEqual(validateRequest(validRequest), validRequest);
  assert.deepEqual(parseInfo("info multipv 2 wdl 200 300 500 pv e2e4"), {
    move: "e2e4",
    probabilityRank: 2,
    wdl: { wins: 200, draws: 300, losses: 500 },
  });
});

test("rejects malformed FEN and UCI command injection", () => {
  assert.equal(isValidFen(validRequest.initialFen), true);
  assert.equal(isValidFen(`${validRequest.initialFen}\nquit`), false);
  assert.throws(
    () =>
      validateRequest({
        ...validRequest,
        initialFen: `${validRequest.initialFen}\nsetoption name MultiPV value 20`,
      }),
    /FEN inicial inválido/,
  );
  assert.throws(
    () => validateRequest({ ...validRequest, fen: "8/8/8 w - - 0 1" }),
    /FEN inválido/,
  );
});

test("rejects move histories that do not reproduce the requested FEN", () => {
  assert.throws(
    () =>
      validateRequest({
        ...validRequest,
        fen: validRequest.initialFen,
        moves: ["e2e4"],
      }),
    /Historial y FEN no coinciden/,
  );
  assert.throws(
    () =>
      validateRequest({
        ...validRequest,
        fen: validRequest.initialFen,
        initialFen: "8/8/8/8/8/8/8/K6k w - - 0 1",
        moves: ["e2e4"],
      }),
    /Historial y FEN no coinciden/,
  );
});

test("does not become ready until a legal warmup search and reset complete", async () => {
  const child = new ScriptedUciProcess();
  const engine = new Maia3Process("fake", {
    spawnProcess: () => child,
    log: () => undefined,
  });

  await engine.ready;
  assert.deepEqual(child.commands.slice(0, 7), [
    "uci",
    "isready",
    "ucinewgame",
    "position startpos",
    "go nodes 1",
    "ucinewgame",
    "isready",
  ]);
  const result = await engine.chooseMove(validRequest);
  assert.equal(result.move, "e2e4");
  assert.deepEqual(result.candidates, [
    {
      move: "e2e4",
      probabilityRank: 1,
      wdl: { wins: 200, draws: 300, losses: 500 },
    },
  ]);
  const optionCommands = child.commands.slice(7);
  assert.deepEqual(optionCommands, [
    "setoption name SelfElo value 600",
    "setoption name OppoElo value 600",
    "setoption name Temperature value 1",
    "setoption name MultiPV value 5",
    "ucinewgame",
    "isready",
    "position fen rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    "go nodes 1",
  ]);
  engine.close();
  assert.equal(engine.waiters.size, 0);
});

test("rejects an invalid warmup bestmove and cleans all UCI listeners", async () => {
  const child = new ScriptedUciProcess({ warmupMove: "e2e5" });
  const engine = new Maia3Process("fake", {
    spawnProcess: () => child,
    log: () => undefined,
  });

  await assert.rejects(engine.ready, /calentamiento inválida/);
  assert.equal(engine.waiters.size, 0);
  assert.equal(engine.closed, true);
});

test("rejects malformed UCI bestmove output instead of waiting for a timeout", async () => {
  const child = new ScriptedUciProcess({ warmupMove: "e2e9" });
  const engine = new Maia3Process("fake", {
    spawnProcess: () => child,
    log: () => undefined,
  });

  await assert.rejects(engine.ready, /bestmove inválido/);
  assert.equal(engine.waiters.size, 0);
  assert.equal(engine.closed, true);
});

test("uses named production timeouts and rejects a genuine UCI timeout", async () => {
  assert.equal(WARMUP_TIMEOUT_MS, 60_000);
  assert.equal(MOVE_TIMEOUT_MS, 30_000);
  const child = new ScriptedUciProcess({ respond: false });
  const engine = new Maia3Process("fake", {
    spawnProcess: () => child,
    warmupTimeoutMs: 10,
    log: () => undefined,
  });

  await assert.rejects(
    engine.ready,
    /Tiempo de espera agotado esperando uciok/,
  );
  assert.equal(engine.waiters.size, 0);
  assert.equal(engine.closed, true);
});

test("allows warmup to outlive the normal move budget", async () => {
  const child = new ScriptedUciProcess({ responseDelayMs: 15 });
  const engine = new Maia3Process("fake", {
    spawnProcess: () => child,
    warmupTimeoutMs: 50,
    moveTimeoutMs: 5,
    log: () => undefined,
  });

  await engine.ready;
  assert.equal(engine.waiters.size, 0);
  engine.close();
});

test("bounds Maia candidate accumulation and ignores oversized info lines", async () => {
  const oversizedInfo = `info multipv 1 pv ${"e2e4 ".repeat(600)}\n`;
  const child = new ScriptedUciProcess({
    goResponses: [
      "info multipv 1 wdl 200 300 500 pv e2e4\nbestmove e2e4\n",
      `${oversizedInfo}${Array.from({ length: 30 }, (_, index) => {
        const rank = index + 1;
        const move = rank === 1 ? "e2e4" : "g1f3";
        return `info multipv ${rank} wdl 200 300 500 pv ${move}\n`;
      }).join("")}bestmove e2e4\n`,
    ],
  });
  const engine = new Maia3Process("fake", {
    spawnProcess: () => child,
    log: () => undefined,
  });

  await engine.ready;
  const result = await engine.chooseMove(validRequest);

  assert.equal(result.move, "e2e4");
  assert.equal(result.candidates.length, 20);
  assert.deepEqual(result.candidates[0], {
    move: "e2e4",
    probabilityRank: 1,
    wdl: { wins: 200, draws: 300, losses: 500 },
  });
  assert.ok(
    result.candidates.every(
      (candidate) => candidate.probabilityRank >= 1 && candidate.probabilityRank <= 20,
    ),
  );
  engine.close();
});

function sendHttpRequest({ body, headers = {}, method = "GET", path = "/", port }) {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        host: "127.0.0.1",
        port,
        path,
        method,
        headers,
      },
      (response) => {
        let responseBody = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          responseBody += chunk;
        });
        response.on("end", () => {
          resolve({
            statusCode: response.statusCode ?? 0,
            headers: response.headers,
            body: responseBody,
          });
        });
      },
    );
    request.on("error", reject);
    if (body !== undefined) request.end(body);
    else request.end();
  });
}

async function createTestBridge(options = {}) {
  const child = new ScriptedUciProcess();
  const bridge = startBridge({
    enginePath: "fake",
    host: "127.0.0.1",
    port: 0,
    processOptions: {
      spawnProcess: () => child,
      log: () => undefined,
    },
    ...options,
  });
  await once(bridge.server, "listening");
  const address = bridge.server.address();
  if (!address || typeof address === "string")
    throw new Error("Bridge did not expose a TCP port");
  return {
    ...bridge,
    child,
    port: address.port,
  };
}

test("accepts /move only as application/json and keeps /health available", async (t) => {
  const bridge = await createTestBridge({ allowedWebPorts: [5173] });
  t.after(() => bridge.shutdown());

  const health = await sendHttpRequest({
    port: bridge.port,
    path: "/health",
    headers: { host: `127.0.0.1:${bridge.port}` },
  });
  assert.equal(health.statusCode, 200);
  assert.match(health.body, /"status":"ready"/);

  const invalidType = await sendHttpRequest({
    port: bridge.port,
    method: "POST",
    path: "/move",
    headers: {
      host: `127.0.0.1:${bridge.port}`,
      "content-type": "text/plain",
    },
    body: JSON.stringify(validRequest),
  });
  assert.equal(invalidType.statusCode, 415);
  assert.match(invalidType.body, /Content-Type/);
});

test("rejects disallowed host and origin, but answers allowed preflight requests", async (t) => {
  const bridge = await createTestBridge({ allowedWebPorts: [5173] });
  t.after(() => bridge.shutdown());

  const badHost = await sendHttpRequest({
    port: bridge.port,
    method: "POST",
    path: "/move",
    headers: {
      host: "evil.example:5173",
      "content-type": "application/json",
      origin: "http://127.0.0.1:5173",
    },
    body: JSON.stringify(validRequest),
  });
  assert.equal(badHost.statusCode, 403);

  const badOrigin = await sendHttpRequest({
    port: bridge.port,
    method: "POST",
    path: "/move",
    headers: {
      host: `127.0.0.1:${bridge.port}`,
      "content-type": "application/json",
      origin: "http://127.0.0.1:6000",
    },
    body: JSON.stringify(validRequest),
  });
  assert.equal(badOrigin.statusCode, 403);

  const preflight = await sendHttpRequest({
    port: bridge.port,
    method: "OPTIONS",
    path: "/move",
    headers: {
      host: `127.0.0.1:${bridge.port}`,
      origin: "http://127.0.0.1:5173",
      "access-control-request-method": "POST",
      "access-control-request-headers": "content-type",
    },
  });
  assert.equal(preflight.statusCode, 204);
  assert.equal(
    preflight.headers["access-control-allow-origin"],
    "http://127.0.0.1:5173",
  );
  assert.match(
    String(preflight.headers["access-control-allow-methods"] ?? ""),
    /POST/,
  );
});

test("returns 429 with Retry-After when the bounded move queue is full", async (t) => {
  const child = new ScriptedUciProcess({ responseDelayMs: 50 });
  const bridge = startBridge({
    enginePath: "fake",
    host: "127.0.0.1",
    port: 0,
    allowedWebPorts: [5173],
    queueLimit: 0,
    processOptions: {
      spawnProcess: () => child,
      log: () => undefined,
    },
  });
  t.after(() => bridge.shutdown());
  await once(bridge.server, "listening");
  const address = bridge.server.address();
  if (!address || typeof address === "string")
    throw new Error("Bridge did not expose a TCP port");
  const port = address.port;

  const firstRequest = sendHttpRequest({
    port,
    method: "POST",
    path: "/move",
    headers: {
      host: `127.0.0.1:${port}`,
      origin: "http://127.0.0.1:5173",
      "content-type": "application/json",
    },
    body: JSON.stringify(validRequest),
  });

  const queuedRequest = await sendHttpRequest({
    port,
    method: "POST",
    path: "/move",
    headers: {
      host: `127.0.0.1:${port}`,
      origin: "http://127.0.0.1:5173",
      "content-type": "application/json",
    },
    body: JSON.stringify({ ...validRequest, id: "queue-overflow" }),
  });

  assert.equal(queuedRequest.statusCode, 429);
  assert.equal(queuedRequest.headers["retry-after"], "30");

  const completed = await firstRequest;
  assert.equal(completed.statusCode, 200);
});
