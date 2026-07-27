import {
  mkdtemp,
  copyFile,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import crypto from "node:crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");
const engineDistPath = path.join(
  repoRoot,
  "packages",
  "engine",
  "dist",
  "index.js",
);
const chessCoreDistPath = path.join(
  repoRoot,
  "packages",
  "chess-core",
  "dist",
  "index.js",
);
const coachDistPath = path.join(
  repoRoot,
  "packages",
  "coach",
  "dist",
  "index.js",
);
const stockfishPackagePath = path.join(
  repoRoot,
  "node_modules",
  ".pnpm",
  "stockfish@18.0.8",
  "node_modules",
  "stockfish",
);
const stockfishSourceDirectory = path.join(
  repoRoot,
  "apps",
  "web",
  "public",
  "stockfish",
);
const stockfishSourceJsPath = path.join(
  stockfishSourceDirectory,
  "stockfish-18-lite-single.js",
);
const stockfishSourceWasmPath = path.join(
  stockfishSourceDirectory,
  "stockfish-18-lite-single.wasm",
);
const stockfishLicensePath = path.join(stockfishSourceDirectory, "Copying.txt");
const reportPath = path.join(
  repoRoot,
  "output",
  "training",
  "verify-puzzles-v1-report.json",
);

const HASH_MEGABYTES = 16;
const USER_MOVE_MULTI_PV_LIMIT = 4;
const USER_MOVE_NODES = 50_000;
const REPLY_MOVE_NODES = 50_000;
const MATERIAL_ADVANTAGE_CENTIPAWNS = 150;

const require = createRequire(import.meta.url);

let applyUciMove;
let listLegalMoves;
let loadPosition;
let getMaterialSummary;
let createUciWorkerBroker;
let PUZZLES_V1;
let validatePuzzleV1;

function fail(message) {
  throw new Error(message);
}

function sha256Hex(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex").toUpperCase();
}

function scoreToJson(score) {
  return score.kind === "centipawns"
    ? { kind: score.kind, value: score.value }
    : { kind: score.kind, moves: score.moves };
}

function lineToJson(line) {
  return {
    rank: line.rank,
    score: scoreToJson(line.score),
    moves: [...line.moves],
    ...(line.wdl === undefined ? {} : { wdl: { ...line.wdl } }),
  };
}

function moveRank(lines, move) {
  const line = lines.find((candidate) => candidate.moves[0] === move);
  return line?.rank;
}

function materialBalance(fen, perspective) {
  const values = { p: 100, n: 300, b: 300, r: 500, q: 900, k: 0 };
  const summary = getMaterialSummary(fen);
  const white =
    summary.white.byType.p * values.p +
    summary.white.byType.n * values.n +
    summary.white.byType.b * values.b +
    summary.white.byType.r * values.r +
    summary.white.byType.q * values.q;
  const black =
    summary.black.byType.p * values.p +
    summary.black.byType.n * values.n +
    summary.black.byType.b * values.b +
    summary.black.byType.r * values.r +
    summary.black.byType.q * values.q;
  return perspective === "white" ? white - black : black - white;
}

function validateObjective(theme, fen, perspective, engineLine) {
  const position = loadPosition(fen);
  if (theme === "mate") {
    if (position.isCheckmate) {
      return { passed: true, reason: "terminal-checkmate" };
    }
    if (engineLine?.score.kind === "mate" && engineLine.score.moves > 0) {
      return {
        passed: true,
        reason: `engine-mate-in-${engineLine.score.moves}`,
      };
    }
    return {
      passed: false,
      reason: "mate-not-confirmed",
    };
  }

  if (theme === "material") {
    if (engineLine?.score.kind === "mate" && engineLine.score.moves > 0) {
      return { passed: true, reason: "engine-mate" };
    }
    const centipawns =
      engineLine?.score.kind === "centipawns"
        ? engineLine.score.value
        : undefined;
    const balance = materialBalance(fen, perspective);
    const passed =
      (centipawns !== undefined &&
        centipawns >= MATERIAL_ADVANTAGE_CENTIPAWNS) ||
      balance > 0;
    return {
      passed,
      reason: passed
        ? centipawns !== undefined &&
          centipawns >= MATERIAL_ADVANTAGE_CENTIPAWNS
          ? `engine-centipawns-${centipawns}`
          : `material-balance-${balance}`
        : `material-not-confirmed(cp=${centipawns ?? "n/a"},balance=${balance})`,
    };
  }

  if (engineLine?.score.kind === "mate" && engineLine.score.moves > 0) {
    return { passed: true, reason: "engine-mate" };
  }
  if (engineLine?.score.kind === "centipawns" && engineLine.score.value > 0) {
    return {
      passed: true,
      reason: `positive-eval-${engineLine.score.value}`,
    };
  }
  return {
    passed: false,
    reason: "objective-not-confirmed",
  };
}

async function main() {
  const tempDirectory = await mkdtemp(
    path.join(os.tmpdir(), "chess-coach-stockfish-verify-"),
  );
  const tempJsPath = path.join(tempDirectory, "stockfish-18-lite-single.cjs");
  const tempWasmPath = path.join(
    tempDirectory,
    "stockfish-18-lite-single.wasm",
  );
  const stagedChessCoreDirectory = path.join(tempDirectory, "chess-core");
  const stagedEngineDirectory = path.join(tempDirectory, "engine");
  const stagedCoachDirectory = path.join(tempDirectory, "coach");
  const stagedChessCoreNodeModulesDirectory = path.join(
    stagedChessCoreDirectory,
    "node_modules",
  );
  const stagedChessCoreIndexPath = path.join(
    stagedChessCoreDirectory,
    "index.js",
  );
  const stagedChessCoreTrainingPositionPath = path.join(
    stagedChessCoreDirectory,
    "trainingPosition.js",
  );
  const stagedEngineIndexPath = path.join(stagedEngineDirectory, "index.js");
  const stagedEngineOpeningEvidencePath = path.join(
    stagedEngineDirectory,
    "openingEvidence.js",
  );
  const startedAt = new Date().toISOString();
  const totalTimerStart = performance.now();
  const performanceStats = {
    analyses: 0,
    totalElapsedMs: 0,
    totalNodes: 0,
  };
  const transcript = [];
  let broker;
  let worker;

  try {
    await mkdir(stagedChessCoreDirectory, { recursive: true });
    await mkdir(stagedEngineDirectory, { recursive: true });
    await mkdir(stagedChessCoreNodeModulesDirectory, { recursive: true });
    await symlink(
      path.join(
        repoRoot,
        "node_modules",
        ".pnpm",
        "chess.js@1.4.0",
        "node_modules",
        "chess.js",
      ),
      path.join(stagedChessCoreNodeModulesDirectory, "chess.js"),
      "junction",
    );

    const [coreIndexSource, coreTrainingPositionSource] = await Promise.all([
      readFile(chessCoreDistPath, "utf8"),
      readFile(
        path.join(
          repoRoot,
          "packages",
          "chess-core",
          "dist",
          "trainingPosition.js",
        ),
        "utf8",
      ),
    ]);

    await Promise.all([
      writeFile(
        stagedChessCoreIndexPath,
        coreIndexSource.replaceAll(
          '"./trainingPosition"',
          '"./trainingPosition.js"',
        ),
        "utf8",
      ),
      writeFile(
        stagedChessCoreTrainingPositionPath,
        coreTrainingPositionSource.replaceAll('"./index"', '"./index.js"'),
        "utf8",
      ),
    ]);

    const engineImportSpecifier = pathToFileURL(stagedChessCoreIndexPath).href;
    await Promise.all([
      writeFile(
        stagedEngineIndexPath,
        (await readFile(engineDistPath, "utf8")).replaceAll(
          "@chess-coach/chess-core",
          engineImportSpecifier,
        ),
        "utf8",
      ),
      writeFile(
        stagedEngineOpeningEvidencePath,
        (
          await readFile(
            path.join(
              repoRoot,
              "packages",
              "engine",
              "dist",
              "openingEvidence.js",
            ),
            "utf8",
          )
        ).replaceAll("@chess-coach/chess-core", engineImportSpecifier),
        "utf8",
      ),
    ]);

    ({ applyUciMove, listLegalMoves, loadPosition, getMaterialSummary } =
      await import(pathToFileURL(stagedChessCoreIndexPath).href));

    ({ createUciWorkerBroker } = await import(
      pathToFileURL(stagedEngineIndexPath).href
    ));

    const stagedCoachFiles = [
      ["index.js", "index.js"],
      ["postgame.js", "postgame.js"],
      ["training/index.js", path.join("training", "index.js")],
      ["training/puzzles.js", path.join("training", "puzzles.js")],
      ["training/openings.js", path.join("training", "openings.js")],
      ["training-content/mvp.js", path.join("training-content", "mvp.js")],
    ];
    const coreImportSpecifier = pathToFileURL(stagedChessCoreIndexPath).href;
    await Promise.all(
      stagedCoachFiles.map(async ([sourceRelativePath, targetRelativePath]) => {
        const sourcePath = path.join(
          repoRoot,
          "packages",
          "coach",
          "dist",
          sourceRelativePath,
        );
        const targetPath = path.join(stagedCoachDirectory, targetRelativePath);
        await mkdir(path.dirname(targetPath), { recursive: true });
        const sourceText = await readFile(sourcePath, "utf8");
        await writeFile(
          targetPath,
          sourceText.replaceAll("@chess-coach/chess-core", coreImportSpecifier),
          "utf8",
        );
      }),
    );

    ({ PUZZLES_V1, validatePuzzleV1 } = await import(
      pathToFileURL(path.join(stagedCoachDirectory, "index.js")).href
    ));

    const [sourceJs, sourceWasm, stockfishPackageJson, licenseText] =
      await Promise.all([
        readFile(stockfishSourceJsPath),
        readFile(stockfishSourceWasmPath),
        readFile(path.join(stockfishPackagePath, "package.json"), "utf8"),
        readFile(stockfishLicensePath, "utf8"),
      ]);

    await copyFile(stockfishSourceJsPath, tempJsPath);
    await copyFile(stockfishSourceWasmPath, tempWasmPath);

    const stockfishMetadata = JSON.parse(stockfishPackageJson);
    const initStockfish = require(stockfishPackagePath);
    const engine = await initStockfish(tempJsPath);

    class NodeStockfishWorker {
      constructor(instance) {
        this.instance = instance;
        this.messageListeners = new Set();
        this.errorListeners = new Set();
        this.terminated = false;
        this.instance.listener = (line) => {
          if (this.terminated) return;
          transcript.push(line);
          const event = new MessageEvent("message", { data: line });
          for (const listener of this.messageListeners) listener(event);
        };
      }

      postMessage(message) {
        if (this.terminated) return;
        try {
          this.instance.sendCommand(message);
        } catch (error) {
          const event = new ErrorEvent("error", {
            message: error instanceof Error ? error.message : String(error),
          });
          for (const listener of this.errorListeners) listener(event);
        }
      }

      addEventListener(type, listener) {
        if (type === "message") {
          this.messageListeners.add(listener);
          return;
        }
        this.errorListeners.add(listener);
      }

      removeEventListener(type, listener) {
        if (type === "message") {
          this.messageListeners.delete(listener);
          return;
        }
        this.errorListeners.delete(listener);
      }

      terminate() {
        this.terminated = true;
        this.instance.listener = undefined;
        this.instance.terminate?.();
      }
    }

    worker = new NodeStockfishWorker(engine);
    broker = createUciWorkerBroker(worker, "stockfish-wasm", {
      hashMegabytes: HASH_MEGABYTES,
    });

    async function analyzePosition(fen, perspective, nodes, multiPv) {
      const legalMoveCount = listLegalMoves(fen).length;
      const normalizedMultiPv = Math.max(
        1,
        Math.min(multiPv, USER_MOVE_MULTI_PV_LIMIT, legalMoveCount),
      );
      const started = performance.now();
      const result = await broker.analyze({
        id: `verify:${performanceStats.analyses + 1}`,
        fen,
        perspective,
        multiPv: normalizedMultiPv,
        limit: { kind: "nodes", nodes },
      });
      const elapsedMs = performance.now() - started;
      performanceStats.analyses += 1;
      performanceStats.totalElapsedMs += elapsedMs;
      performanceStats.totalNodes += result.nodes;
      return {
        result,
        elapsedMs,
      };
    }

    await broker.ready();

    const idName =
      transcript.find((line) => line.startsWith("id name "))?.slice(8) ?? null;
    const idAuthor =
      transcript.find((line) => line.startsWith("id author "))?.slice(10) ??
      null;
    const sawUciOk = transcript.includes("uciok");

    if (idName === null || idAuthor === null || !sawUciOk) {
      fail(
        `Stockfish handshake incomplete: name=${idName}, author=${idAuthor}, uciok=${sawUciOk}`,
      );
    }

    const policy = {
      userMoveMustMatch: "engine-best-line-in-node",
      replyMoveMustMatch: "engine-best-defense-in-child-node",
      objectiveValidation:
        "terminal mate requires checkmate; material requires positive engine or material proof",
    };

    async function verifyBranches(
      puzzle,
      fen,
      branches,
      pathMoves,
      branchSetIndex,
    ) {
      const nodeAnalysis = await analyzePosition(
        fen,
        puzzle.sideToMove,
        USER_MOVE_NODES,
        branches.length,
      );
      const nodeBestMove = nodeAnalysis.result.lines[0]?.moves[0] ?? null;
      const reports = [];

      for (const [index, branch] of branches.entries()) {
        const branchPath = `${branchSetIndex}.${index + 1}`;
        const userMoveLegal = listLegalMoves(fen).some(
          (candidate) => candidate.uci === branch.userMove,
        );
        const userMoveRank =
          moveRank(nodeAnalysis.result.lines, branch.userMove) ?? null;
        const afterUser = applyUciMove(loadPosition(fen), branch.userMove);
        const edgeReport = {
          path: branchPath,
          history: [...pathMoves, branch.userMove],
          beforeFen: fen,
          userMove: branch.userMove,
          userMoveLegal,
          userMoveMatchesEngineBest: nodeBestMove === branch.userMove,
          userMoveRank,
          nodeBestMove,
          nodeAnalysis: {
            elapsedMs: nodeAnalysis.elapsedMs,
            nodes: nodeAnalysis.result.nodes,
            depth: nodeAnalysis.result.depth,
            lines: nodeAnalysis.result.lines.map(lineToJson),
          },
        };

        let replyCheck;
        let objectiveCheck;
        let continuationReports = [];

        if (branch.reply !== undefined) {
          const replyAnalysis = await analyzePosition(
            afterUser.fen,
            puzzle.sideToMove,
            REPLY_MOVE_NODES,
            1,
          );
          const engineReply = replyAnalysis.result.lines[0]?.moves[0] ?? null;
          const afterReply = applyUciMove(afterUser, branch.reply);
          replyCheck = {
            reply: branch.reply,
            matchesEngineBestReply: engineReply === branch.reply,
            engineBestReply: engineReply,
            analysis: {
              elapsedMs: replyAnalysis.elapsedMs,
              nodes: replyAnalysis.result.nodes,
              depth: replyAnalysis.result.depth,
              lines: replyAnalysis.result.lines.map(lineToJson),
            },
          };

          if (branch.next !== undefined && branch.next.length > 0) {
            continuationReports = await verifyBranches(
              puzzle,
              afterReply.fen,
              branch.next,
              [...pathMoves, branch.userMove, branch.reply],
              Number(`${branchSetIndex}${index + 1}`),
            );
          }
        } else {
          const objective = validateObjective(
            puzzle.theme,
            afterUser.fen,
            puzzle.sideToMove,
            undefined,
          );
          objectiveCheck = {
            ...objective,
            finalFen: afterUser.fen,
          };
        }

        if (
          branch.reply !== undefined &&
          (!branch.next || branch.next.length === 0)
        ) {
          const afterReply = applyUciMove(afterUser, branch.reply);
          const terminalAnalysis = await analyzePosition(
            afterReply.fen,
            puzzle.sideToMove,
            REPLY_MOVE_NODES,
            1,
          );
          const objective = validateObjective(
            puzzle.theme,
            afterReply.fen,
            puzzle.sideToMove,
            terminalAnalysis.result.lines[0],
          );
          objectiveCheck = {
            ...objective,
            finalFen: afterReply.fen,
            analysis: {
              elapsedMs: terminalAnalysis.elapsedMs,
              nodes: terminalAnalysis.result.nodes,
              depth: terminalAnalysis.result.depth,
              lines: terminalAnalysis.result.lines.map(lineToJson),
            },
          };
        }

        reports.push({
          ...edgeReport,
          ...(replyCheck === undefined ? {} : { replyCheck }),
          ...(objectiveCheck === undefined ? {} : { objectiveCheck }),
          ...(continuationReports.length === 0 ? {} : { continuationReports }),
        });
      }

      return reports;
    }

    const puzzles = [];
    const failures = [];

    for (const rawPuzzle of PUZZLES_V1) {
      const puzzle = validatePuzzleV1(rawPuzzle);
      const reports = await verifyBranches(
        puzzle,
        puzzle.fen,
        puzzle.solution,
        [],
        puzzles.length + 1,
      );

      function collectFailures(branchReports, output = []) {
        for (const branch of branchReports) {
          if (!branch.userMoveMatchesEngineBest) {
            output.push({
              puzzleId: puzzle.id,
              path: branch.path,
              kind: "user-move",
              message: `Expected engine best move ${branch.nodeBestMove ?? "none"}, found ${branch.userMove}`,
            });
          }
          if (
            branch.replyCheck !== undefined &&
            !branch.replyCheck.matchesEngineBestReply
          ) {
            output.push({
              puzzleId: puzzle.id,
              path: branch.path,
              kind: "reply-move",
              message: `Expected engine best reply ${branch.replyCheck.engineBestReply ?? "none"}, found ${branch.replyCheck.reply}`,
            });
          }
          if (
            branch.objectiveCheck !== undefined &&
            branch.objectiveCheck.passed !== true
          ) {
            output.push({
              puzzleId: puzzle.id,
              path: branch.path,
              kind: "objective",
              message: branch.objectiveCheck.reason,
            });
          }
          if (branch.continuationReports !== undefined) {
            collectFailures(branch.continuationReports, output);
          }
        }
        return output;
      }

      const puzzleFailures = collectFailures(reports);
      failures.push(...puzzleFailures);
      puzzles.push({
        id: puzzle.id,
        theme: puzzle.theme,
        objective: puzzle.objective,
        difficulty: puzzle.difficulty,
        verificationStatus: puzzleFailures.length === 0 ? "passed" : "failed",
        reports,
      });
    }

    const totalElapsedMs = performance.now() - totalTimerStart;
    const report = {
      schemaVersion: 1,
      generatedAt: startedAt,
      verifier: "verify-puzzles-v1.mjs",
      status: failures.length === 0 ? "passed" : "failed",
      engine: {
        packagePath: stockfishPackagePath,
        packageVersion: stockfishMetadata.version,
        buildVersion: stockfishMetadata.buildVersion,
        name: idName,
        author: idAuthor,
        license: stockfishMetadata.license,
        licensePath: stockfishLicensePath,
        source:
          "Local browser Stockfish bundle copied byte-for-byte into a temporary Node-compatible .cjs/.wasm pair before analysis.",
        originalJsPath: stockfishSourceJsPath,
        originalWasmPath: stockfishSourceWasmPath,
        tempJsPath,
        tempWasmPath,
        jsSha256: sha256Hex(sourceJs),
        wasmSha256: sha256Hex(sourceWasm),
        transcriptSample: transcript.slice(0, 32),
        copyNoticeFirstLine: licenseText.split(/\r?\n/u)[0] ?? "",
      },
      budget: {
        hashMegabytes: HASH_MEGABYTES,
        userMoveNodes: USER_MOVE_NODES,
        replyMoveNodes: REPLY_MOVE_NODES,
        userMoveMultiPvLimit: USER_MOVE_MULTI_PV_LIMIT,
        materialAdvantageCentipawns: MATERIAL_ADVANTAGE_CENTIPAWNS,
        policy,
      },
      performance: {
        analyses: performanceStats.analyses,
        totalElapsedMs,
        averageElapsedMs:
          performanceStats.analyses === 0
            ? 0
            : performanceStats.totalElapsedMs / performanceStats.analyses,
        totalNodes: performanceStats.totalNodes,
      },
      failures,
      puzzles,
    };

    await mkdir(path.dirname(reportPath), { recursive: true });
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(`verify-puzzles-v1 report: ${reportPath}`);
    console.log(
      `status=${report.status} analyses=${report.performance.analyses} failures=${failures.length}`,
    );

    if (failures.length > 0) {
      process.exitCode = 1;
    }
  } finally {
    try {
      await broker?.dispose();
    } finally {
      worker?.terminate();
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

await main();
