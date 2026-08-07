import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { Chess } from "chess.js";

const HOST = "127.0.0.1";
const PORT = Number(process.env.MAIA3_BRIDGE_PORT ?? 8765);
const ENGINE_PATH = process.env.MAIA3_ENGINE_PATH;
const MAX_BODY_BYTES = 64 * 1024;
const MAX_UCI_INFO_LINE_LENGTH = 1024;
const MAX_MAIA_CANDIDATES = 20;
const DEFAULT_QUEUE_LIMIT = 1;
const DEFAULT_RETRY_AFTER_SECONDS = 30;

export const WARMUP_TIMEOUT_MS = 60_000;
export const MOVE_TIMEOUT_MS = 30_000;

const UCI_MOVE = /^[a-h][1-8][a-h][1-8][qrbn]?$/;
const FEN_PIECES = /^[prnbqkPRNBQK1-8]+$/;
const INITIAL_POSITION_LEGAL_MOVES = new Set([
  "a2a3",
  "a2a4",
  "b2b3",
  "b2b4",
  "c2c3",
  "c2c4",
  "d2d3",
  "d2d4",
  "e2e3",
  "e2e4",
  "f2f3",
  "f2f4",
  "g2g3",
  "g2g4",
  "h2h3",
  "h2h4",
  "b1a3",
  "b1c3",
  "g1f3",
  "g1h3",
]);

class HttpError extends Error {
  constructor(status, message, headers = {}) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.headers = headers;
  }
}

export function isValidFen(value) {
  if (typeof value !== "string" || /[\u0000-\u001f\u007f]/.test(value))
    return false;
  const fields = value.split(" ");
  if (fields.length !== 6) return false;
  const [placement, activeColor, castling, enPassant, halfmove, fullmove] =
    fields;
  const ranks = placement?.split("/") ?? [];
  if (
    ranks.length !== 8 ||
    ranks.some((rank) => {
      if (!FEN_PIECES.test(rank)) return true;
      const squares = [...rank].reduce(
        (total, symbol) => total + (/\d/.test(symbol) ? Number(symbol) : 1),
        0,
      );
      return squares !== 8;
    })
  ) {
    return false;
  }
  if (activeColor !== "w" && activeColor !== "b") return false;
  if (
    castling !== "-" &&
    (!/^[KQkq]+$/.test(castling ?? "") ||
      new Set(castling).size !== castling.length)
  ) {
    return false;
  }
  if (enPassant !== "-" && !/^[a-h][36]$/.test(enPassant ?? "")) return false;
  if (!/^\d+$/.test(halfmove ?? "") || !/^[1-9]\d*$/.test(fullmove ?? ""))
    return false;
  return true;
}

function parseUciMove(move) {
  if (typeof move !== "string" || !UCI_MOVE.test(move)) return undefined;
  return {
    from: move.slice(0, 2),
    to: move.slice(2, 4),
    ...(move.length === 5 ? { promotion: move[4] } : {}),
  };
}

function doesHistoryReproduceFen(initialFen, moves, expectedFen) {
  try {
    const game = new Chess(initialFen);
    for (const move of moves) {
      const parsed = parseUciMove(move);
      if (parsed === undefined || game.move(parsed) == null) return false;
    }
    return game.fen() === expectedFen;
  } catch {
    return false;
  }
}

export function validateRequest(value) {
  if (!value || typeof value !== "object") throw new Error("JSON inválido");
  const {
    id,
    fen,
    initialFen,
    moves,
    selfElo,
    opponentElo,
    temperature,
    multiPv,
  } = value;
  if (typeof id !== "string" || id.length < 1 || id.length > 100)
    throw new Error("id inválido");
  if (typeof fen !== "string" || fen.length > 120 || !isValidFen(fen))
    throw new Error("FEN inválido");
  if (
    typeof initialFen !== "string" ||
    initialFen.length > 120 ||
    !isValidFen(initialFen)
  ) {
    throw new Error("FEN inicial inválido");
  }
  if (
    !Array.isArray(moves) ||
    moves.length > 1000 ||
    moves.some((move) => typeof move !== "string" || !UCI_MOVE.test(move))
  ) {
    throw new Error("Historial UCI inválido");
  }
  if (!doesHistoryReproduceFen(initialFen, moves, fen)) {
    throw new Error("Historial y FEN no coinciden");
  }
  if (!Number.isInteger(selfElo) || selfElo < 600 || selfElo > 2600)
    throw new Error("SelfElo debe estar entre 600 y 2600");
  if (!Number.isInteger(opponentElo) || opponentElo < 600 || opponentElo > 2600)
    throw new Error("OppoElo debe estar entre 600 y 2600");
  if (typeof temperature !== "number" || temperature < 0 || temperature > 2)
    throw new Error("Temperature debe estar entre 0 y 2");
  if (!Number.isInteger(multiPv) || multiPv < 1 || multiPv > 20)
    throw new Error("MultiPV debe estar entre 1 y 20");
  return {
    id,
    fen,
    initialFen,
    moves,
    selfElo,
    opponentElo,
    temperature,
    multiPv,
  };
}

export function parseInfo(line) {
  if (
    typeof line !== "string" ||
    !line.startsWith("info ") ||
    line.length > MAX_UCI_INFO_LINE_LENGTH
  ) {
    return undefined;
  }
  const move = line.match(/\bpv ([a-h][1-8][a-h][1-8][qrbn]?)/)?.[1];
  if (!move) return undefined;
  const rank = Number(line.match(/\bmultipv (\d+)/)?.[1] ?? 1);
  if (!Number.isInteger(rank) || rank < 1 || rank > MAX_MAIA_CANDIDATES)
    return undefined;
  const wdl = line.match(/\bwdl (\d+) (\d+) (\d+)/);
  const wdlValues = wdl?.slice(1).map(Number);
  if (wdlValues && wdlValues.some((value) => !Number.isSafeInteger(value)))
    return undefined;
  return {
    move,
    probabilityRank: rank,
    ...(wdlValues
      ? {
          wdl: {
            wins: wdlValues[0],
            draws: wdlValues[1],
            losses: wdlValues[2],
          },
        }
      : {}),
  };
}

function bestMoveFromLine(line) {
  return typeof line === "string"
    ? line.match(/^bestmove ([a-h][1-8][a-h][1-8][qrbn]?|0000)(?:\s|$)/)?.[1]
    : undefined;
}

function normalizePort(value) {
  const port = Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : undefined;
}

function isLoopbackHostname(hostname) {
  return hostname === "127.0.0.1" || hostname === "localhost";
}

function parseAuthority(authority) {
  if (typeof authority !== "string" || authority.trim().length === 0)
    return undefined;
  try {
    return new URL(`http://${authority.trim()}`);
  } catch {
    return undefined;
  }
}

function resolveServerPort(server) {
  const address = server.address();
  return address && typeof address !== "string" ? address.port : undefined;
}

function validateHostHeader(request, server) {
  const header = Array.isArray(request.headers.host)
    ? request.headers.host[0]
    : request.headers.host;
  const parsed = parseAuthority(header);
  const actualPort = resolveServerPort(server);
  const port = normalizePort(parsed?.port);
  if (
    parsed == null ||
    actualPort === undefined ||
    port !== actualPort ||
    !isLoopbackHostname(parsed.hostname)
  ) {
    throw new HttpError(403, "Host no permitido");
  }
}

function validateOriginHeader(originHeader, allowedWebPorts) {
  if (originHeader == null || originHeader === "") return undefined;
  let parsed;
  try {
    parsed = new URL(originHeader);
  } catch {
    throw new HttpError(403, "Origin no permitido");
  }
  const port = normalizePort(parsed.port);
  if (
    parsed.protocol !== "http:" ||
    port === undefined ||
    !isLoopbackHostname(parsed.hostname)
  ) {
    throw new HttpError(403, "Origin no permitido");
  }
  if (
    allowedWebPorts !== undefined &&
    allowedWebPorts.length > 0 &&
    !allowedWebPorts.includes(port)
  ) {
    throw new HttpError(403, "Origin no permitido");
  }
  return parsed.origin;
}

function corsHeaders(origin) {
  if (origin === undefined) return {};
  return {
    "access-control-allow-origin": origin,
    vary: "Origin, Access-Control-Request-Method, Access-Control-Request-Headers",
  };
}

function isJsonContentType(header) {
  const value = Array.isArray(header) ? header[0] : header;
  return (
    typeof value === "string" &&
    value.split(";")[0].trim().toLowerCase() === "application/json"
  );
}

export class Maia3Process {
  constructor(enginePath, options = {}) {
    const spawnProcess = options.spawnProcess ?? spawn;
    this.warmupTimeoutMs = options.warmupTimeoutMs ?? WARMUP_TIMEOUT_MS;
    this.moveTimeoutMs = options.moveTimeoutMs ?? MOVE_TIMEOUT_MS;
    this.log =
      options.log ?? ((line) => process.stderr.write(`[maia3] ${line}\n`));
    this.process = spawnProcess(
      enginePath,
      options.args ?? ["--use-uci-history", "--local-files-only"],
      { stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
    );
    this.waiters = new Set();
    this.closed = false;
    this.failure = undefined;
    this.stdout = createInterface({ input: this.process.stdout });
    this.stderr = createInterface({ input: this.process.stderr });
    this.stdout.on("line", (line) => this.notify(String(line).trim()));
    this.stderr.on("line", (line) => this.log(String(line)));
    this.process.once("error", (error) => this.fail(error));
    this.process.once("exit", (code, signal) =>
      this.fail(
        new Error(
          `Maia-3 terminó con código ${code ?? "nulo"}${signal ? ` (${signal})` : ""}`,
        ),
      ),
    );
    this.ready = this.initialize().catch((error) => {
      this.fail(error, true);
      throw error;
    });
    this.ready.catch(() => undefined);
  }

  notify(line) {
    for (const waiter of [...this.waiters]) waiter.receive(line);
  }

  fail(error, terminate = false) {
    if (this.failure) return;
    this.failure = error instanceof Error ? error : new Error(String(error));
    this.closed = true;
    for (const waiter of [...this.waiters]) waiter.reject(this.failure);
    this.waiters.clear();
    this.stdout.close();
    this.stderr.close();
    if (terminate && typeof this.process.kill === "function")
      this.process.kill();
  }

  write(line) {
    if (this.closed)
      throw this.failure ?? new Error("Maia-3 no está disponible");
    this.process.stdin.write(`${line}\n`);
  }

  waitFor(predicate, timeoutMs, description) {
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => {
      const waiter = {
        receive: (line) => {
          const result = predicate(line);
          if (result instanceof Error) {
            finish(reject, result);
            return;
          }
          if (!result) return;
          finish(resolve, line);
        },
        reject: (error) => finish(reject, error),
      };
      const timeout = setTimeout(
        () =>
          finish(
            reject,
            new Error(`Tiempo de espera agotado esperando ${description}`),
          ),
        timeoutMs,
      );
      const finish = (settle, value) => {
        clearTimeout(timeout);
        this.waiters.delete(waiter);
        settle(value);
      };
      this.waiters.add(waiter);
    });
  }

  async initialize() {
    const uciok = this.waitFor(
      (line) => line === "uciok",
      this.warmupTimeoutMs,
      "uciok",
    );
    this.write("uci");
    await uciok;
    await this.waitUntilReady(this.warmupTimeoutMs);

    this.write("ucinewgame");
    this.write("position startpos");
    const { move } = await this.search(
      this.warmupTimeoutMs,
      "la jugada de calentamiento",
    );
    if (!INITIAL_POSITION_LEGAL_MOVES.has(move)) {
      throw new Error(`Maia-3 devolvió una jugada de calentamiento inválida: ${move}`);
    }

    this.write("ucinewgame");
    await this.waitUntilReady(this.warmupTimeoutMs);
  }

  async waitUntilReady(timeoutMs) {
    const readyok = this.waitFor(
      (line) => line === "readyok",
      timeoutMs,
      "readyok",
    );
    this.write("isready");
    await readyok;
  }

  search(timeoutMs, description) {
    const candidates = [];
    const bestmove = this.waitFor(
      (line) => {
        const info = parseInfo(line);
        if (info && candidates.length < MAX_MAIA_CANDIDATES) candidates.push(info);
        if (typeof line === "string" && line.startsWith("bestmove ")) {
          if (!bestMoveFromLine(line)) {
            return new Error(`Maia-3 devolvió bestmove inválido: ${line}`);
          }
          return true;
        }
        return false;
      },
      timeoutMs,
      description,
    ).then((line) => bestMoveFromLine(line));
    this.write("go nodes 1");
    return bestmove.then((move) => {
      if (!move || move === "0000") {
        throw new Error("La posición no tiene una jugada disponible");
      }
      if (!UCI_MOVE.test(move)) {
        throw new Error(`Maia-3 devolvió bestmove inválido: ${move}`);
      }
      return { move, candidates };
    });
  }

  async chooseMove(request) {
    await this.ready;
    this.write(`setoption name SelfElo value ${request.selfElo}`);
    this.write(`setoption name OppoElo value ${request.opponentElo}`);
    this.write(`setoption name Temperature value ${request.temperature}`);
    this.write(`setoption name MultiPV value ${request.multiPv}`);
    this.write("ucinewgame");
    await this.waitUntilReady(this.moveTimeoutMs);
    const moveList = request.moves.length ? ` moves ${request.moves.join(" ")}` : "";
    this.write(`position fen ${request.initialFen}${moveList}`);
    const { move, candidates } = await this.search(
      this.moveTimeoutMs,
      "bestmove de Maia-3",
    );
    return { id: request.id, backend: "maia3-local", move, candidates };
  }

  close() {
    if (this.closed) return;
    try {
      this.write("quit");
    } finally {
      this.fail(new Error("Maia-3 ha sido cerrado"));
    }
  }
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
        reject(new HttpError(413, "Solicitud demasiado grande"));
        request.destroy();
      }
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("JSON inválido"));
      }
    });
    request.on("error", reject);
  });
}

function sendJson(response, status, value, headers = {}) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...headers,
  });
  response.end(JSON.stringify(value));
}

function sendEmpty(response, status, headers = {}) {
  response.writeHead(status, {
    "cache-control": "no-store",
    ...headers,
  });
  response.end();
}

function parseAllowedWebPorts(value) {
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const ports = value
    .split(",")
    .map((entry) => normalizePort(entry.trim()))
    .filter((entry) => entry !== undefined);
  return ports.length > 0 ? ports : undefined;
}

export function startBridge({
  allowedWebPorts = parseAllowedWebPorts(process.env.MAIA3_ALLOWED_WEB_PORTS),
  enginePath = ENGINE_PATH,
  port = PORT,
  host = HOST,
  processOptions,
  queueLimit = DEFAULT_QUEUE_LIMIT,
  retryAfterSeconds = DEFAULT_RETRY_AFTER_SECONDS,
} = {}) {
  if (!enginePath) throw new Error("Falta MAIA3_ENGINE_PATH");
  const engine = new Maia3Process(enginePath, processOptions);
  let queue = Promise.resolve();
  let scheduledMoves = 0;

  const server = createServer(async (request, response) => {
    let responseHeaders = {};
    try {
      validateHostHeader(request, server);

      if (request.method === "GET" && request.url === "/health") {
        await engine.ready;
        return sendJson(response, 200, {
          status: "ready",
          backend: "maia3-local",
        });
      }

      if (request.url !== "/move") {
        return sendJson(response, 404, { error: "Ruta no encontrada" });
      }

      const originHeader = Array.isArray(request.headers.origin)
        ? request.headers.origin[0]
        : request.headers.origin;
      const origin = validateOriginHeader(originHeader, allowedWebPorts);
      responseHeaders = corsHeaders(origin);

      if (request.method === "OPTIONS") {
        if (
          request.headers["access-control-request-method"] !== "POST" ||
          !String(request.headers["access-control-request-headers"] ?? "")
            .toLowerCase()
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean)
            .every((value) => value === "content-type")
        ) {
          throw new HttpError(405, "Preflight no permitido", responseHeaders);
        }
        return sendEmpty(response, 204, {
          ...responseHeaders,
          "access-control-allow-methods": "POST, OPTIONS",
          "access-control-allow-headers": "content-type",
        });
      }

      if (request.method !== "POST") {
        return sendJson(response, 404, { error: "Ruta no encontrada" }, responseHeaders);
      }

      if (!isJsonContentType(request.headers["content-type"])) {
        throw new HttpError(
          415,
          "Content-Type debe ser application/json",
          responseHeaders,
        );
      }

      if (scheduledMoves >= queueLimit + 1) {
        throw new HttpError(429, "Cola de Maia-3 llena", {
          ...responseHeaders,
          "retry-after": String(retryAfterSeconds),
        });
      }

      const input = validateRequest(await readJson(request));
      scheduledMoves += 1;
      const task = queue.then(async () => {
        try {
          return await engine.chooseMove(input);
        } finally {
          scheduledMoves -= 1;
        }
      });
      queue = task.catch(() => undefined);
      sendJson(response, 200, await task, responseHeaders);
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 400;
      const headers =
        error instanceof HttpError ? error.headers : responseHeaders;
      sendJson(
        response,
        status,
        {
          error: error instanceof Error ? error.message : String(error),
        },
        headers,
      );
    }
  });

  engine.ready
    .then(() => {
      const actualPort = resolveServerPort(server) ?? port;
      process.stdout.write(`Maia-3 bridge ready at http://${host}:${actualPort}\n`);
    })
    .catch((error) => {
      process.stderr.write(
        `[maia3] El calentamiento falló: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      server.close();
    });

  server.listen(port, host, () => {
    const actualPort = resolveServerPort(server) ?? port;
    process.stdout.write(
      `Maia-3 bridge listening at http://${host}:${actualPort}; warming up...\n`,
    );
  });

  const shutdown = () => {
    server.close();
    engine.close();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  return { engine, server, shutdown };
}

function selfTest() {
  const parsed = parseInfo(
    "info depth 1 multipv 2 score cp 0 wdl 200 300 500 pv e2e4",
  );
  if (parsed?.move !== "e2e4" || parsed.probabilityRank !== 2)
    process.exitCode = 1;
  validateRequest({
    id: "test",
    fen: "8/8/8/8/8/8/8/K6k w - - 0 1",
    initialFen: "8/8/8/8/8/8/8/K6k w - - 0 1",
    moves: [],
    selfElo: 600,
    opponentElo: 600,
    temperature: 1,
    multiPv: 5,
  });
  process.stdout.write("maia3 bridge self-test: ok\n");
}

const isMain =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain && process.argv.includes("--self-test")) selfTest();
else if (isMain)
  startBridge({
    processOptions:
      process.env.MAIA3_ENGINE_MODE === "python-entrypoint"
        ? {
            args: ["-c", "from maia3.presets import main_5m; main_5m()"],
          }
        : undefined,
  });
