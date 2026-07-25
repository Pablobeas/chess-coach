import { createInitialGame } from "@chess-coach/chess-core";
import { describe, expect, it, vi } from "vitest";
import {
  BRIDGE_UNAVAILABLE_MESSAGE,
  createLocalMaia3Opponent,
} from "./maia3Client";

const request = {
  id: "opponent-1",
  fen: createInitialGame().fen,
  initialFen: createInitialGame().initialFen,
  moves: [],
  selfElo: 600,
  opponentElo: 600,
  temperature: 1,
  multiPv: 5,
} as const;

describe("local Maia-3 client", () => {
  it("returns a legal move from the local bridge", async () => {
    let requestBody: string | undefined;
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        requestBody = init?.body as string | undefined;
        return new Response(
          JSON.stringify({
            id: request.id,
            backend: "maia3-local",
            move: "e2e4",
            candidates: [{ move: "e2e4", probabilityRank: 1 }],
          }),
          { status: 200 },
        );
      },
    );
    const opponent = createLocalMaia3Opponent(fetcher as typeof fetch);

    await expect(opponent.chooseMove(request)).resolves.toMatchObject({
      move: "e2e4",
      backend: "maia3-local",
    });
    expect(fetcher).toHaveBeenCalledWith(
      "/maia3-api/move",
      expect.objectContaining({ method: "POST" }),
    );
    expect(JSON.parse(requestBody ?? "")).toMatchObject({
      selfElo: 600,
      opponentElo: 600,
    });
  });

  it("rejects illegal moves returned by the bridge", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            id: request.id,
            backend: "maia3-local",
            move: "e2e5",
            candidates: [],
          }),
          { status: 200 },
        ),
    );
    const opponent = createLocalMaia3Opponent(fetcher as typeof fetch);

    await expect(opponent.chooseMove(request)).rejects.toThrow("ilegal");
    expect(opponent.getStatus().availability).toBe("error");
  });

  it("forwards cancellation and returns to the ready state", async () => {
    const fetcher = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    );
    const opponent = createLocalMaia3Opponent(fetcher as typeof fetch);
    const controller = new AbortController();
    const pending = opponent.chooseMove(request, controller.signal);

    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(opponent.getStatus().availability).toBe("ready");
  });

  it("uses the structured bridge error message", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: "Maia-3 sigue calentando" }), {
          status: 503,
        }),
    );
    const opponent = createLocalMaia3Opponent(fetcher as typeof fetch);

    await expect(opponent.chooseMove(request)).rejects.toThrow(
      "Maia-3 sigue calentando",
    );
  });

  it("treats a 502 proxy failure as an unavailable local bridge", async () => {
    const fetcher = vi.fn(
      async () => new Response("El proceso UCI termino", { status: 502 }),
    );
    const opponent = createLocalMaia3Opponent(fetcher as typeof fetch);

    await expect(opponent.chooseMove(request)).rejects.toThrow(
      BRIDGE_UNAVAILABLE_MESSAGE,
    );
  });

  it("reports a missing local bridge when fetch fails before receiving a response", async () => {
    const fetcher = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const opponent = createLocalMaia3Opponent(fetcher as typeof fetch);

    await expect(opponent.chooseMove(request)).rejects.toThrow(
      BRIDGE_UNAVAILABLE_MESSAGE,
    );
  });

  it("reports an invalid bridge payload when JSON parsing fails", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response("not-json", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const opponent = createLocalMaia3Opponent(fetcher as typeof fetch);

    await expect(opponent.chooseMove(request)).rejects.toThrow(
      "Respuesta invalida de Maia-3",
    );
  });
});
