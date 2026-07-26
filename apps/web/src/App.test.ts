// @vitest-environment jsdom
import {
  applyMove,
  createInitialGame,
  loadPgn,
  loadPosition,
} from "@chess-coach/chess-core";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GameTurnStatus,
  AdvicePanel,
  MobileEvaluationBar,
  browserOpponentModeForBuild,
  canPlayBoard,
  describeGameTurnStatus,
  initialOpponentNameForMode,
  isCurrentCoachRequest,
  opponentNameForBackend,
  readCurrentBuildId,
  workspaceTransitionNotice,
} from "./App";
import { createSessionWorkspace, createTrialLine } from "./sessionWorkspace";
import { syncActiveLineSession } from "./lineTransitions";

describe("opponent backend labels", () => {
  it("never represents Stockfish as an exact Elo opponent", () => {
    expect(opponentNameForBackend("stockfish-wasm")).toBe("Stockfish local");
    expect(opponentNameForBackend("stockfish-asmjs")).toBe("Stockfish local");
  });

  it("shows the local Maia backend by its real name", () => {
    expect(opponentNameForBackend("maia3-local")).toBe("Maia-3 local");
  });

  it("forces hosted mode in production even when the deployed host is localhost", () => {
    expect(browserOpponentModeForBuild(true)).toBe("hosted");
    expect(browserOpponentModeForBuild(false)).toBe("auto");
    expect(initialOpponentNameForMode("hosted")).toBe("Stockfish local");
    expect(initialOpponentNameForMode("auto")).toBe("Maia-3 local");
  });

  it("keeps the active shell build id when a newer version manifest exists", () => {
    document.head.innerHTML =
      '<meta name="chess-coach-build-id" content="build-n" />';
    expect(readCurrentBuildId()).toBe("build-n");
    // A fetched version.json is deliberately not an input to this reader:
    // N+1 stays an available update until the active controller changes.
    expect(readCurrentBuildId()).not.toBe("build-n1");
  });
});

describe("terminal turn status", () => {
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

  it("replaces the stale turn label with a checkmate result in the live status", async () => {
    const game = loadPgn("1. f3 e5 2. g4 Qh4# 0-1");

    await act(async () => {
      root.render(
        createElement(GameTurnStatus, {
          status: describeGameTurnStatus(game, "white"),
        }),
      );
    });

    const status = container.querySelector('[role="status"]');
    expect(status?.textContent).toContain("Jaque mate");
    expect(status?.textContent).toContain("Ganan negras");
    expect(status?.textContent).toContain("Tú juegas con blancas");
    expect(status?.textContent).not.toContain("Turno de");
    expect(status?.getAttribute("aria-live")).toBe("polite");
    expect(status?.querySelector(".turn-indicator")).toBeNull();
  });

  it("announces drawn terminal positions without reusing the turn label", async () => {
    const game = loadPosition("7k/5Q2/7K/8/8/8/8/8 b - - 0 1");

    await act(async () => {
      root.render(
        createElement(GameTurnStatus, {
          status: describeGameTurnStatus(game, "black"),
        }),
      );
    });

    const status = container.querySelector('[role="status"]');
    expect(status?.textContent).toContain("Tablas");
    expect(status?.textContent).toContain("Empate");
    expect(status?.textContent).toContain("Tú juegas con negras");
    expect(status?.textContent).not.toContain("Turno de");
  });
});

describe("workspace transition announcements", () => {
  it("announces automatic promotion after an opponent response", () => {
    const initial = createInitialGame();
    const trial = createTrialLine(
      createSessionWorkspace(initial),
      "variation-1",
    );
    const d4 = applyMove(initial, { from: "d2", to: "d4" });
    const d4d5 = applyMove(d4, { from: "d7", to: "d5" });
    const promoted = syncActiveLineSession(trial, d4d5);
    expect(workspaceTransitionNotice(trial, promoted)).toContain("promovió");
  });

  it("announces a merge and automatic pruning", () => {
    const initial = createSessionWorkspace(createInitialGame());
    const first = createTrialLine(initial, "v1");
    const merged = {
      ...first,
      activeLineId: "main",
      lines: first.lines.filter((line) => line.id !== "v1"),
    };
    expect(workspaceTransitionNotice(first, merged)).toContain("fusionó");
    const pruned = { ...first, lines: first.lines.slice(0, 1) };
    expect(workspaceTransitionNotice(first, pruned)).toContain(
      "eliminó automáticamente",
    );
  });
});

describe("historical board interaction", () => {
  it("keeps a historical player-turn position playable when only browsing", () => {
    expect(canPlayBoard(false, false, "white", "white")).toBe(true);
    expect(canPlayBoard(true, false, "white", "white")).toBe(false);
    expect(canPlayBoard(false, false, "black", "white")).toBe(false);
  });
});

describe("coach feedback states", () => {
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

  it("exposes an actionable retry when a local analysis is unavailable", async () => {
    const onRetry = vi.fn();
    await act(async () => {
      root.render(
        createElement(AdvicePanel, {
          feedbackEntry: {
            historyIndex: 0,
            uci: "e2e4",
            actor: "user",
            beforeFen: "before",
            afterFen: "after",
            status: "unavailable",
          },
          helpLevel: "normal",
          selectedMaia: false,
          lineVisible: false,
          onToggleLine: vi.fn(),
          slow: false,
          onRetry,
        }),
      );
    });
    const retry = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Reintentar"),
    );
    expect(retry).toBeTruthy();
    await act(async () =>
      retry?.dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("only renders the mobile evaluation text when enabled", async () => {
    await act(async () =>
      root.render(
        createElement(MobileEvaluationBar, {
          visible: false,
          label: "igualada",
        }),
      ),
    );
    expect(container.textContent).toBe("");
    await act(async () =>
      root.render(
        createElement(MobileEvaluationBar, {
          visible: true,
          label: "igualada",
        }),
      ),
    );
    expect(container.textContent).toContain("Evaluación local: igualada");
    expect(
      container.querySelector('[role="status"]')?.getAttribute("aria-label"),
    ).toContain("igualada");
  });

  it("does not let watchdog A clear a newer pending request B", () => {
    const pendingB = { identity: { requestId: "coach-b" } };
    expect(isCurrentCoachRequest(pendingB, "coach-a")).toBe(false);
    expect(isCurrentCoachRequest(pendingB, "coach-b")).toBe(true);
  });
});
