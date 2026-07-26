// @vitest-environment jsdom
import {
  applyMove,
  createInitialGame,
  loadPosition,
} from "@chess-coach/chess-core";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PostgameReviewScreen } from "./PostgameReviewScreen";
import {
  createPostgameReviewStateV1,
  markPostgameReviewUnavailable,
} from "./postgameReview";

function terminalSession() {
  let game = createInitialGame();
  for (const move of [
    ["f2", "f3"],
    ["e7", "e5"],
    ["g2", "g4"],
    ["d8", "h4"],
  ] as const)
    game = applyMove(game, { from: move[0], to: move[1] });
  return game;
}

function reviewFor() {
  return createPostgameReviewStateV1({
    session: terminalSession(),
    lineId: "main",
    playerColor: "white",
    feedbackByPly: [],
  });
}

describe("PostgameReviewScreen", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("shows only the terminal line, phase states and original stability buckets", async () => {
    const onClose = vi.fn();
    await act(async () => {
      root.render(
        createElement(PostgameReviewScreen, {
          review: reviewFor(),
          onClose,
          onNewGame: vi.fn(),
        }),
      );
    });
    expect(container.textContent).toContain("Línea que terminó en jaque mate");
    expect(container.textContent).toContain("1. f3");
    expect(container.textContent).toContain("2... Qh4#");
    expect(container.textContent).toContain("Apertura");
    expect(container.textContent).toContain("Medio juego");
    expect(container.textContent).toContain("Desenlace");
    expect(container.textContent).toContain("No se alcanzó");
    expect(container.textContent).toContain("Firmes");
    expect(container.textContent).toContain("Críticas");
    expect(container.textContent).toContain("Sin margen");
    const userBuckets = container.querySelector(
      '[aria-label="Tú: decisiones por consistencia"]',
    );
    const opponentBuckets = container.querySelector(
      '[aria-label="Rival: decisiones por consistencia"]',
    );
    expect(userBuckets?.querySelectorAll("dt")).toHaveLength(6);
    expect(userBuckets?.querySelectorAll("dd")).toHaveLength(6);
    expect(opponentBuckets?.querySelectorAll("dt")).toHaveLength(6);
    expect(opponentBuckets?.querySelectorAll("dd")).toHaveLength(6);
    expect(container.textContent).not.toMatch(
      /precisi[oó]n|brillante|elo|probabilidad/i,
    );
    expect(container.textContent).not.toMatch(/Ã|Â|�/);
    expect(document.activeElement?.id).toBe("postgame-review-title");
    await act(async () =>
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("rerenders analysis state without losing actions and exposes unavailable coverage", async () => {
    const review = reviewFor();
    const onNewGame = vi.fn();
    await act(async () => {
      root.render(
        createElement(PostgameReviewScreen, {
          review,
          onClose: vi.fn(),
          onNewGame,
        }),
      );
    });
    expect(container.textContent).toContain("Estimación local en curso");
    const ready = {
      ...review,
      status: "ready" as const,
      progress: {
        completed: review.progress.total,
        total: review.progress.total,
      },
    };
    await act(async () => {
      root.render(
        createElement(PostgameReviewScreen, {
          review: ready,
          onClose: vi.fn(),
          onNewGame,
        }),
      );
    });
    expect(container.textContent).toContain("Estimación local terminada");
    await act(async () => {
      root.render(
        createElement(PostgameReviewScreen, {
          review: markPostgameReviewUnavailable(review),
          onClose: vi.fn(),
          onNewGame,
        }),
      );
    });
    expect(container.textContent).toContain("Estimación local incompleta");
    const newGame = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Nueva partida",
    );
    await act(async () => newGame?.click());
    expect(onNewGame).toHaveBeenCalledOnce();
  });

  it("marks a custom-start opening as not applicable", async () => {
    const game = applyMove(loadPosition("7k/5Q2/7K/8/8/8/8/8 w - - 0 1"), {
      from: "f7",
      to: "g7",
    });
    const review = createPostgameReviewStateV1({
      session: game,
      lineId: "main",
      playerColor: "white",
      feedbackByPly: [],
    });
    await act(async () => {
      root.render(
        createElement(PostgameReviewScreen, {
          review,
          onClose: vi.fn(),
          onNewGame: vi.fn(),
        }),
      );
    });
    expect(container.textContent).toContain("No aplicable");
  });
});
