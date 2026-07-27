import {
  applyUciMove,
  listLegalMoves,
  loadPosition,
  type PlayerColor,
} from "@chess-coach/chess-core";
import type {
  ChessEngine,
  EngineBackend,
  EngineLine,
  EngineScore,
  SearchLimit,
} from "./index";

export interface OpeningEvidenceRequest {
  readonly id: string;
  readonly fen: string;
  readonly perspective: PlayerColor;
  readonly repertoireMoves: readonly string[];
  readonly limit: SearchLimit;
  readonly candidateLimit?: SearchLimit;
}

export interface OpeningCandidateEvidence {
  readonly move: string;
  readonly line: EngineLine;
}

export interface OpeningEvidence {
  readonly best: EngineLine;
  readonly candidates: readonly OpeningCandidateEvidence[];
  readonly engineBestMove: string;
}

export interface SkippedOpeningCandidate {
  readonly move: string;
  readonly reason: "analysis-error" | "invalid-line";
  readonly message: string;
}

export interface OpeningEvidenceSuccess {
  readonly kind: "ok";
  readonly id: string;
  readonly backend: EngineBackend;
  readonly evidence: OpeningEvidence;
  readonly skippedCandidates?: readonly SkippedOpeningCandidate[];
}

export interface OpeningEvidenceUnavailable {
  readonly kind: "unavailable";
  readonly id: string;
  readonly reason: string;
}

export type OpeningEvidenceResult =
  OpeningEvidenceSuccess | OpeningEvidenceUnavailable;

const MAXIMUM_REPERTOIRE_MOVES = 3;

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function cloneScore(score: EngineScore): EngineScore {
  return score.kind === "centipawns"
    ? Object.freeze({ kind: "centipawns" as const, value: score.value })
    : Object.freeze({ kind: "mate" as const, moves: score.moves });
}

function cloneLine(line: EngineLine): EngineLine {
  return Object.freeze({
    rank: line.rank,
    score: cloneScore(line.score),
    moves: Object.freeze([...line.moves]),
    ...(line.wdl === undefined
      ? {}
      : {
          wdl: Object.freeze({
            wins: line.wdl.wins,
            draws: line.wdl.draws,
            losses: line.wdl.losses,
          }),
        }),
  });
}

function validateRequest(request: OpeningEvidenceRequest): readonly string[] {
  if (request.id.trim().length === 0) {
    throw new RangeError("Opening evidence request ID must not be empty");
  }
  loadPosition(request.fen);
  if (
    request.repertoireMoves.length === 0 ||
    request.repertoireMoves.length > MAXIMUM_REPERTOIRE_MOVES
  ) {
    throw new RangeError(
      "Opening evidence requires between one and three repertoire moves",
    );
  }
  const legalMoves = new Set(
    listLegalMoves(request.fen).map((candidate) => candidate.uci),
  );
  const deduplicated = [...new Set(request.repertoireMoves)];
  if (deduplicated.length !== request.repertoireMoves.length) {
    throw new RangeError("Opening evidence repertoire moves must be unique");
  }
  for (const move of request.repertoireMoves) {
    if (!legalMoves.has(move)) {
      throw new RangeError(
        `Opening evidence move ${move} is illegal for the current FEN`,
      );
    }
  }
  return Object.freeze(deduplicated);
}

function isLegalLineFromFen(
  fen: string,
  line: EngineLine | undefined,
): line is EngineLine {
  if (line === undefined || line.moves.length === 0) return false;
  try {
    let position = loadPosition(fen);
    for (const move of line.moves) {
      position = applyUciMove(position, move);
    }
    return true;
  } catch {
    return false;
  }
}

function prependMove(move: string, line: EngineLine): EngineLine {
  return cloneLine({
    rank: line.rank,
    score: line.score,
    moves: [move, ...line.moves],
    ...(line.wdl === undefined ? {} : { wdl: line.wdl }),
  });
}

function freezeCandidate(
  candidate: OpeningCandidateEvidence,
): OpeningCandidateEvidence {
  return Object.freeze({
    move: candidate.move,
    line: cloneLine(candidate.line),
  });
}

export async function collectOpeningEvidence(
  engine: ChessEngine,
  request: OpeningEvidenceRequest,
  signal?: AbortSignal,
): Promise<OpeningEvidenceResult> {
  const repertoireMoves = validateRequest(request);
  const candidateLimit = request.candidateLimit ?? request.limit;
  let rootBackend: EngineBackend | undefined;

  try {
    const bestResult = await engine.analyze(
      {
        id: `${request.id}:root`,
        fen: request.fen,
        perspective: request.perspective,
        multiPv: 1,
        limit: request.limit,
      },
      signal,
    );
    rootBackend = bestResult.backend;
    const bestLine = bestResult.lines[0];
    if (!isLegalLineFromFen(request.fen, bestLine)) {
      return Object.freeze({
        kind: "unavailable" as const,
        id: request.id,
        reason:
          "Engine returned an illegal principal variation for the root position",
      });
    }

    const engineBestMove = bestLine.moves[0];
    if (engineBestMove === undefined) {
      return Object.freeze({
        kind: "unavailable" as const,
        id: request.id,
        reason: "Engine returned no best move for the root position",
      });
    }

    const candidates: OpeningCandidateEvidence[] = [];
    const skippedCandidates: SkippedOpeningCandidate[] = [];
    for (const move of repertoireMoves) {
      if (move === engineBestMove) {
        candidates.push(
          freezeCandidate({
            move,
            line: bestLine,
          }),
        );
        continue;
      }

      const childFen = applyUciMove(loadPosition(request.fen), move).fen;
      try {
        const childResult = await engine.analyze(
          {
            id: `${request.id}:candidate:${move}`,
            fen: childFen,
            perspective: request.perspective,
            multiPv: 1,
            limit: candidateLimit,
          },
          signal,
        );
        const childLine = childResult.lines[0];
        if (!isLegalLineFromFen(childFen, childLine)) {
          skippedCandidates.push(
            Object.freeze({
              move,
              reason: "invalid-line" as const,
              message:
                "Engine returned an illegal principal variation for the candidate move",
            }),
          );
          continue;
        }
        candidates.push(
          freezeCandidate({
            move,
            line: prependMove(move, childLine),
          }),
        );
      } catch (error) {
        if (isAbortError(error)) throw error;
        skippedCandidates.push(
          Object.freeze({
            move,
            reason: "analysis-error" as const,
            message:
              error instanceof Error
                ? error.message
                : "Candidate analysis failed",
          }),
        );
      }
    }

    return Object.freeze({
      kind: "ok" as const,
      id: request.id,
      backend: bestResult.backend,
      evidence: Object.freeze({
        best: cloneLine(bestLine),
        candidates: Object.freeze(candidates),
        engineBestMove,
      }),
      ...(skippedCandidates.length === 0
        ? {}
        : { skippedCandidates: Object.freeze(skippedCandidates) }),
    });
  } catch (error) {
    if (isAbortError(error)) throw error;
    return Object.freeze({
      kind: "unavailable" as const,
      id: request.id,
      reason:
        error instanceof Error
          ? error.message
          : rootBackend === undefined
            ? "Engine evidence is unavailable"
            : `Engine evidence is unavailable on ${rootBackend}`,
    });
  }
}
