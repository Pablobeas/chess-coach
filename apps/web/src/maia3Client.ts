import { listLegalMoves } from "@chess-coach/chess-core";
import {
  EngineUnavailableError,
  type OpponentEngine,
  type OpponentRequest,
  type OpponentResult,
  type OpponentStatus,
} from "@chess-coach/engine";

const ENDPOINT = "/maia3-api/move";

type FetchLike = typeof fetch;

function errorDetail(body: string, status: number): string {
  if (body) {
    try {
      const parsed: unknown = JSON.parse(body);
      if (
        parsed &&
        typeof parsed === "object" &&
        typeof (parsed as { error?: unknown }).error === "string" &&
        (parsed as { error: string }).error.trim()
      )
        return (parsed as { error: string }).error;
    } catch {
      // Plain text errors are also supported by the companion process.
    }
    return body;
  }
  return `Maia-3 respondió con HTTP ${status}`;
}

function isOpponentResult(value: unknown): value is OpponentResult {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<OpponentResult>;
  return (
    typeof candidate.id === "string" &&
    candidate.backend === "maia3-local" &&
    typeof candidate.move === "string" &&
    Array.isArray(candidate.candidates)
  );
}

export function createLocalMaia3Opponent(
  fetcher: FetchLike = fetch,
): OpponentEngine {
  let disposed = false;
  let status: OpponentStatus = {
    backend: "maia3-local",
    availability: "ready",
  };

  return {
    async chooseMove(
      request: OpponentRequest,
      signal?: AbortSignal,
    ): Promise<OpponentResult> {
      if (disposed) throw new EngineUnavailableError("Maia-3 ha sido cerrado");
      status = { backend: "maia3-local", availability: "analyzing" };
      try {
        const response = await fetcher(ENDPOINT, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(request),
          ...(signal ? { signal } : {}),
        });
        if (!response.ok) {
          throw new EngineUnavailableError(
            errorDetail(await response.text(), response.status),
          );
        }
        const result: unknown = await response.json();
        if (!isOpponentResult(result) || result.id !== request.id)
          throw new EngineUnavailableError("Respuesta inválida de Maia-3");
        const legalMoves = new Set(
          listLegalMoves(request.fen).map((move) => move.uci),
        );
        if (!legalMoves.has(result.move))
          throw new EngineUnavailableError(
            `Maia-3 devolvió una jugada ilegal: ${result.move}`,
          );
        status = { backend: "maia3-local", availability: "ready" };
        return result;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          status = { backend: "maia3-local", availability: "ready" };
          throw error;
        }
        status = {
          backend: "maia3-local",
          availability: "error",
          message: error instanceof Error ? error.message : String(error),
        };
        throw error;
      }
    },
    async dispose() {
      disposed = true;
      status = { backend: "maia3-local", availability: "disposed" };
    },
    getStatus() {
      return status;
    },
  };
}
