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
      const legalMoves = [...listLegalMoves(request.fen)].sort(
        (left, right) => {
          if (left.uci < right.uci) {
            return -1;
          }

          return left.uci > right.uci ? 1 : 0;
        },
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
