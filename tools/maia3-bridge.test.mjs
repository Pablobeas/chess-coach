import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";
import {
  Maia3Process,
  MOVE_TIMEOUT_MS,
  WARMUP_TIMEOUT_MS,
  isValidFen,
  parseInfo,
  validateRequest,
} from "./maia3-bridge.mjs";

class ScriptedUciProcess extends EventEmitter {
  constructor({
    warmupMove = "e2e4",
    respond = true,
    responseDelayMs = 0,
  } = {}) {
    super();
    this.commands = [];
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
    if (command === "go nodes 1")
      this.stdout.write(
        `info multipv 1 wdl 200 300 500 pv ${warmupMove}\nbestmove ${warmupMove}\n`,
      );
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
