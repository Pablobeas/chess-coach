import { listLegalMoves, type PlayerColor } from "@chess-coach/chess-core";

export type EngineScore =
  | { readonly kind: "centipawns"; readonly value: number }
  | { readonly kind: "mate"; readonly moves: number };

export interface EngineLine {
  readonly rank: number;
  readonly score: EngineScore;
  readonly moves: readonly string[];
  readonly wdl?: {
    readonly wins: number;
    readonly draws: number;
    readonly losses: number;
  };
}

export interface AnalysisRequest {
  readonly id: string;
  readonly fen: string;
  readonly perspective: PlayerColor;
  readonly multiPv: number;
  readonly limit:
    | { readonly kind: "time"; readonly milliseconds: number }
    | { readonly kind: "nodes"; readonly nodes: number };
}

export interface AnalysisResult {
  readonly id: string;
  readonly perspective: PlayerColor;
  readonly depth: number;
  readonly nodes: number;
  readonly lines: readonly EngineLine[];
}

export interface ChessEngine {
  analyze(
    request: AnalysisRequest,
    signal?: AbortSignal,
  ): Promise<AnalysisResult>;
  dispose(): Promise<void>;
}

export class InvalidAnalysisRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidAnalysisRequestError";
  }
}

const SIMULATED_DEPTH = 1;
const CENTIPAWN_STEP_PER_RANK = 10;
const OPENING_AFTER_E4_FEN =
  "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";
const OPENING_AFTER_E4_RESPONSE = "e7e5";

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new DOMException("Analysis was cancelled", "AbortError");
  }
}

function validateRequest(request: AnalysisRequest): void {
  if (request.id.trim().length === 0) {
    throw new InvalidAnalysisRequestError(
      "Analysis request ID must not be empty",
    );
  }

  if (!Number.isInteger(request.multiPv) || request.multiPv < 1) {
    throw new InvalidAnalysisRequestError("multiPv must be a positive integer");
  }

  const budget =
    request.limit.kind === "time"
      ? request.limit.milliseconds
      : request.limit.nodes;

  if (!Number.isInteger(budget) || budget < 1) {
    throw new InvalidAnalysisRequestError(
      "Analysis limit must be a positive integer",
    );
  }
}

function compareLegalMoves(
  fen: string,
  left: { readonly uci: string },
  right: { readonly uci: string },
): number {
  const preferredMove =
    fen === OPENING_AFTER_E4_FEN ? OPENING_AFTER_E4_RESPONSE : undefined;

  if (left.uci === preferredMove) {
    return -1;
  }

  if (right.uci === preferredMove) {
    return 1;
  }

  if (left.uci < right.uci) {
    return -1;
  }

  return left.uci > right.uci ? 1 : 0;
}

export function createDeterministicEngine(): ChessEngine {
  let disposed = false;

  return {
    async analyze(
      request: AnalysisRequest,
      signal?: AbortSignal,
    ): Promise<AnalysisResult> {
      if (disposed) {
        throw new Error("Engine has been disposed");
      }

      throwIfAborted(signal);
      validateRequest(request);
      const legalMoves = [...listLegalMoves(request.fen)].sort((left, right) =>
        compareLegalMoves(request.fen, left, right),
      );

      await Promise.resolve();
      throwIfAborted(signal);

      return Object.freeze({
        id: request.id,
        perspective: request.perspective,
        depth: SIMULATED_DEPTH,
        nodes: legalMoves.length,
        lines: Object.freeze(
          legalMoves.slice(0, request.multiPv).map((move, index) =>
            Object.freeze({
              rank: index + 1,
              score: Object.freeze({
                kind: "centipawns" as const,
                value: index === 0 ? 0 : -index * CENTIPAWN_STEP_PER_RANK,
              }),
              moves: Object.freeze([move.uci]),
            }),
          ),
        ),
      });
    },

    async dispose(): Promise<void> {
      disposed = true;
    },
  };
}
