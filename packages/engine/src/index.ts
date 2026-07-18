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
  readonly multiPv: number;
  readonly limit:
    | { readonly kind: "time"; readonly milliseconds: number }
    | { readonly kind: "nodes"; readonly nodes: number };
}

export interface AnalysisResult {
  readonly id: string;
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
