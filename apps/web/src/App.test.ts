// @vitest-environment jsdom
import {
  applyMove,
  createInitialGame,
  loadPgn,
  loadPosition,
  replayHistory,
} from "@chess-coach/chess-core";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GameTurnStatus,
  AdvicePanel,
  MobileEvaluationBar,
  finalizePendingCoachAttempt,
  browserOpponentModeForBuild,
  bindVisualViewportHeight,
  clearExpiredCoachRetryTarget,
  coachDebugEnabled,
  coachFailureAction,
  coachFailureActionForTurn,
  coachFailureStageForPrimaryLines,
  coachRemainingDelay,
  canPlayBoard,
  describeGameTurnStatus,
  initialOpponentNameForMode,
  isAbortErrorLike,
  isRetryAttemptInFlight,
  isCurrentCoachRequest,
  isRetryTargetActive,
  opponentNameForBackend,
  readCurrentBuildId,
  retryAnalysisTarget,
  rebuildCoachRetryTurn,
  reportCoachFailureDebug,
  shouldWaitForCoachRetry,
  shouldStartCoachRetry,
  shouldReplacePendingFeedback,
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

describe("mobile visual viewport", () => {
  it("uses the visual viewport height when Safari browser chrome reduces it", () => {
    const visualViewport = Object.assign(new EventTarget(), { height: 711 });
    const windowRef = {
      innerHeight: 844,
      visualViewport,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as Window;

    const cleanup = bindVisualViewportHeight(windowRef, document);
    expect(
      document.documentElement.style.getPropertyValue("--app-viewport-height"),
    ).toBe("711px");
    cleanup();
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

  it("classifies internal coach preemption without retrying invalidated work", () => {
    const internalAbort = new DOMException("preempted", "AbortError");
    expect(coachFailureAction(internalAbort, false, true, 0)).toBe(
      "auto-retry",
    );
    expect(coachFailureAction(internalAbort, true, true, 0)).toBe("stale");
    expect(coachFailureAction(internalAbort, false, true, 1)).toBe(
      "unavailable",
    );
    expect(coachFailureAction(new Error("engine"), false, true, 0)).toBe(
      "unavailable",
    );
    expect(coachFailureAction(internalAbort, false, false, 0)).toBe("stale");
    expect(isAbortErrorLike(internalAbort)).toBe(true);
    expect(isAbortErrorLike({ name: "AbortError" })).toBe(true);
    expect(coachFailureAction({ name: "AbortError" }, false, true, 0)).toBe(
      "auto-retry",
    );
    expect(coachFailureAction({ name: "OtherError" }, false, true, 0)).toBe(
      "unavailable",
    );
  });

  it("defers repeated internal preemptions until the opponent has completed its turn", () => {
    const internalAbort = new DOMException("preempted", "AbortError");
    const waitingTarget = {
      lineId: "main",
      lineRole: "main" as const,
      historyIndex: 0,
      uci: "e2e4",
      beforeFen: "before",
      afterFen: "after",
      autoAttempts: 1,
    };

    expect(
      coachFailureActionForTurn(internalAbort, false, true, 0, false),
    ).toBe("wait-for-player-turn");
    expect(
      coachFailureActionForTurn(internalAbort, false, true, 1, false),
    ).toBe("wait-for-player-turn");
    expect(shouldWaitForCoachRetry(waitingTarget, "black", "white")).toBe(true);
    // Once the rival has replied, the exact retry target becomes eligible and
    // the normal pipeline can resolve it to ready.
    expect(shouldWaitForCoachRetry(waitingTarget, "white", "white")).toBe(
      false,
    );
    expect(coachFailureActionForTurn(internalAbort, false, true, 1, true)).toBe(
      "unavailable",
    );
  });

  it("preserves the original 20-second watchdog budget across a deferred retry", () => {
    expect(coachRemainingDelay(20_000, 0, 5_000)).toBe(15_000);
    expect(coachRemainingDelay(20_000, 5_000, 20_000)).toBe(5_000);
    expect(coachRemainingDelay(20_000, 5_000, 30_000)).toBe(0);
  });

  it("does not revive a deferred retry after its 20-second watchdog has expired", () => {
    const target = {
      lineId: "main",
      lineRole: "main" as const,
      historyIndex: 0,
      uci: "e2e4",
      beforeFen: "before",
      afterFen: "after",
      autoAttempts: 1,
    };
    const expired = clearExpiredCoachRetryTarget(target, {
      lineId: "main",
      lineRole: "main" as const,
      historyIndex: 0,
      uci: "e2e4",
      beforeFen: "before",
      afterFen: "after",
    });

    expect(expired).toBeUndefined();
    // Even once the opponent's turn finishes, there is no pending retry to
    // start after the watchdog has declared the analysis unavailable.
    expect(shouldWaitForCoachRetry(expired, "white", "white")).toBe(false);
  });

  it("only emits sanitized coach failure diagnostics when explicitly enabled", () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const originalSearch = window.location.search;

    expect(coachDebugEnabled("?coachDebug=0")).toBe(false);
    reportCoachFailureDebug({
      stage: "before",
      error: new Error(
        "FEN rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 1",
      ),
      signalAborted: false,
      identityActive: true,
      autoAttempt: 0,
      action: "unavailable",
    });
    expect(warning).not.toHaveBeenCalled();

    window.history.replaceState({}, "", "?coachDebug=1");
    expect(coachDebugEnabled()).toBe(true);
    reportCoachFailureDebug({
      stage: "after",
      error: {
        name: "EngineUnavailableError",
        message:
          "FEN rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 1",
      },
      signalAborted: false,
      identityActive: true,
      autoAttempt: 1,
      action: "auto-retry",
    });

    expect(warning).toHaveBeenCalledTimes(1);
    expect(warning.mock.calls[0]?.[0]).toBe("[coach-debug] analysis failed");
    expect(warning.mock.calls[0]?.[1]).toEqual({
      stage: "after",
      errorName: "EngineUnavailableError",
      errorMessage: "[redacted-position-data]",
      signalAborted: false,
      identityActive: true,
      autoAttempt: 1,
      action: "auto-retry",
    });

    reportCoachFailureDebug({
      stage: "acceptance",
      error: {
        name: "FEN rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR",
        message: "safe",
      },
      signalAborted: false,
      identityActive: true,
      autoAttempt: 0,
      action: "unavailable",
    });
    expect(warning.mock.calls[1]?.[1]).toMatchObject({
      errorName: "[unknown-error-name]",
      errorMessage: "safe",
    });

    window.history.replaceState({}, "", originalSearch || "/");
    warning.mockRestore();
  });

  it("marks a missing primary line as a validation-stage failure", () => {
    expect(coachFailureStageForPrimaryLines([], [])).toBe("acceptance");
    expect(coachFailureStageForPrimaryLines([{ rank: 1 }], [{ rank: 1 }])).toBe(
      "analyzeTurn",
    );
  });

  it("only replaces a matching pending feedback for an explicit retry target", () => {
    expect(
      shouldReplacePendingFeedback(
        true,
        { historyIndex: 0, uci: "e2e4" },
        0,
        "e2e4",
      ),
    ).toBe(true);
    expect(
      shouldReplacePendingFeedback(
        true,
        { historyIndex: 1, uci: "c7c5" },
        0,
        "e2e4",
      ),
    ).toBe(false);
    expect(shouldReplacePendingFeedback(false, undefined, 0, "e2e4")).toBe(
      true,
    );
  });

  it("keeps the exact player ply as the retry target after a Maia reply", () => {
    const e4 = applyMove(createInitialGame(), { from: "e2", to: "e4" });
    const e4c5 = applyMove(e4, { from: "c7", to: "c5" });
    const workspace = createSessionWorkspace(e4c5);
    const target = retryAnalysisTarget(workspace, {
      historyIndex: 0,
      uci: "e2e4",
      beforeFen: createInitialGame().fen,
      afterFen: e4.fen,
    });
    expect(e4c5.history).toHaveLength(2);
    expect(target).toMatchObject({
      historyIndex: 0,
      uci: "e2e4",
      afterFen: e4.fen,
    });
    expect(isRetryTargetActive(workspace, target)).toBe(true);
    expect(
      isRetryTargetActive(createTrialLine(workspace, "other"), target),
    ).toBe(false);

    const rebuilt = rebuildCoachRetryTurn(workspace, target);
    expect(rebuilt.before.fen).toBe(createInitialGame().fen);
    expect(rebuilt.after.fen).toBe(e4.fen);
    expect(rebuilt.after.history.at(-1)?.uci).toBe("e2e4");
    expect(rebuilt.after.history).toHaveLength(1);
  });

  it("does not enqueue a second retry while the exact retry request is still in flight", () => {
    const target = {
      lineId: "main",
      lineRole: "main" as const,
      historyIndex: 0,
      uci: "e2e4",
      beforeFen: createInitialGame().fen,
      afterFen: applyMove(createInitialGame(), { from: "e2", to: "e4" }).fen,
      autoAttempts: 1,
      attemptRequestId: "coach-retry-1",
    };
    const pending = {
      identity: {
        requestId: "coach-retry-1",
      },
    };

    expect(isRetryAttemptInFlight(target, pending)).toBe(true);
    expect(shouldStartCoachRetry(target, pending, "white", "white")).toBe(
      false,
    );
    expect(shouldStartCoachRetry(target, undefined, "white", "white")).toBe(
      true,
    );
  });

  it("finalizes the origin pending retry after switching lines and ignores deleted or newer entries", () => {
    const e4 = applyMove(createInitialGame(), { from: "e2", to: "e4" });
    const e4c5 = applyMove(e4, { from: "c7", to: "c5" });
    const entry = replayHistory(e4c5)[0]!;
    const base = createSessionWorkspace(e4c5);
    const identity = {
      lineId: "main",
      lineRole: "main" as const,
      historyIndex: 0,
      ply: 1,
      actor: "user" as const,
      uci: "e2e4",
      beforeFen: entry.beforeFen,
      afterFen: entry.afterFen,
      requestId: "retry-a",
    };
    const pending = {
      ...base,
      lines: base.lines.map((line) => ({
        ...line,
        feedbackByPly: [
          {
            historyIndex: 0,
            uci: "e2e4",
            actor: "user" as const,
            beforeFen: entry.beforeFen,
            afterFen: entry.afterFen,
            status: "pending" as const,
          },
        ],
      })),
    };
    const switched = createTrialLine(pending, "trial");
    const finalized = finalizePendingCoachAttempt(switched, identity);
    expect(finalized.activeLineId).toBe("trial");
    expect(
      finalized.lines.find((line) => line.id === "main")?.feedbackByPly[0]
        ?.status,
    ).toBe("unavailable");
    const deleted = {
      ...finalized,
      lines: finalized.lines.filter((line) => line.id !== "main"),
    };
    expect(finalizePendingCoachAttempt(deleted, identity)).toEqual(deleted);
    const ready = {
      ...finalized,
      lines: finalized.lines.map((line) =>
        line.id === "main"
          ? {
              ...line,
              feedbackByPly: [
                { ...line.feedbackByPly[0]!, status: "ready" as const },
              ],
            }
          : line,
      ),
    };
    expect(
      finalizePendingCoachAttempt(ready, identity).lines.find(
        (line) => line.id === "main",
      )?.feedbackByPly[0]?.status,
    ).toBe("ready");
  });
});
