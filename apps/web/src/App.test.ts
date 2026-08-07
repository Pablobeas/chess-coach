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
  applyCurrentOpponentResponse,
  COACH_DEADLINE_MS,
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
  feedbackPresentationFor,
  describeGameTurnStatus,
  initialOpponentNameForMode,
  isAbortErrorLike,
  isRetryAttemptInFlight,
  isCurrentCoachRequest,
  isRetryTargetActive,
  opponentNameForBackend,
  opponentResponseStillMatches,
  postgameAnalysisPositionsForTask,
  postgameReviewAutoOpenDelayMs,
  postgameReviewAutoOpenCandidate,
  MAX_PGN_IMPORT_BYTES,
  MAX_PGN_IMPORT_PLIES,
  loadPgnImportFile,
  pgnImportErrorMessage,
  readCurrentBuildId,
  resolvePostgameReviewTask,
  retryAnalysisTarget,
  rebuildCoachRetryTurn,
  reportCoachFailureDebug,
  shouldRequestOpponentMove,
  shouldWaitForCoachRetry,
  shouldStartCoachRetry,
  shouldReplacePendingFeedback,
  shouldAnalyzeLiveCoachMove,
  shouldCapturePostgameReview,
  workspaceTransitionNotice,
} from "./App";
import {
  createSessionWorkspace,
  createTrialLine,
  promoteSessionLineAndDeleteFormerMain,
} from "./sessionWorkspace";
import {
  acceptsAnalysisResult,
  syncActiveLineSession,
} from "./lineTransitions";
import { createPostgameReviewStateV1 } from "./postgameReview";

function playMate(uciMoves: readonly string[]) {
  return uciMoves.reduce(
    (session, uci) =>
      applyMove(session, {
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        ...(uci.length === 5
          ? { promotion: uci[4] as "q" | "r" | "b" | "n" }
          : {}),
      }),
    createInitialGame(),
  );
}

describe("PGN import bounds", () => {
  it("rejects an oversized file before reading its contents", async () => {
    const text = vi.fn(async () => "1. e4 e5");

    await expect(
      loadPgnImportFile({ size: MAX_PGN_IMPORT_BYTES + 1, text }),
    ).rejects.toThrow("supera el límite de 256 KB");

    expect(text).not.toHaveBeenCalled();
  });

  it("rejects parsed games beyond the session ply budget", async () => {
    const pgn = Array.from(
      { length: MAX_PGN_IMPORT_PLIES / 4 + 1 },
      (_, index) => {
        const whiteMoveNumber = index * 2 + 1;
        return `${whiteMoveNumber}. Nf3 Nf6 ${whiteMoveNumber + 1}. Ng1 Ng8`;
      },
    ).join(" ");

    await expect(
      loadPgnImportFile({ size: pgn.length, text: async () => pgn }),
    ).rejects.toThrow("supera el límite de 1.024 medias jugadas");
  });

  it("keeps valid PGN imports and exposes a safe Spanish error otherwise", async () => {
    await expect(
      loadPgnImportFile({ size: 9, text: async () => "1. e4 e5" }),
    ).resolves.toMatchObject({ history: [{ uci: "e2e4" }, { uci: "e7e5" }] });

    expect(pgnImportErrorMessage(new Error("details"))).toBe(
      "El archivo no contiene un PGN válido o legal.",
    );
  });
});

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

describe("opponent response route identity", () => {
  it("rejects a delayed response after switching to a same-FEN trial line", () => {
    const initial = createInitialGame();
    const main = createSessionWorkspace(initial);
    const trial = createTrialLine(main, "same-fen-trial");
    const request = {
      lineId: "main",
      cursor: 0,
      fen: initial.fen,
      historyLength: 0,
    };

    expect(
      opponentResponseStillMatches(request, {
        ...request,
        lineId: "same-fen-trial",
      }),
    ).toBe(false);
    expect(applyCurrentOpponentResponse(trial, request, "e2e4")).toBe(trial);
    expect(
      trial.lines.every((line) => line.timeline.session.history.length === 0),
    ).toBe(true);
  });

  it("only applies a delayed response when its exact route is still active", () => {
    const initial = createInitialGame();
    const workspace = createSessionWorkspace(initial);
    const next = applyCurrentOpponentResponse(
      workspace,
      { lineId: "main", cursor: 0, fen: initial.fen, historyLength: 0 },
      "e2e4",
    );

    expect(next).not.toBe(workspace);
    expect(next.lines[0]?.timeline.session.history.at(-1)?.uci).toBe("e2e4");
  });
});

describe("historical board interaction", () => {
  it("keeps a historical player-turn position playable when only browsing", () => {
    expect(canPlayBoard(false, false, "white", "white")).toBe(true);
    expect(canPlayBoard(true, false, "white", "white")).toBe(false);
    expect(canPlayBoard(false, false, "black", "white")).toBe(false);
  });

  it("requests an opponent move only on a live non-terminal engine turn", () => {
    expect(
      shouldRequestOpponentMove({
        started: true,
        paused: false,
        isBrowsingHistory: false,
        isGameOver: false,
        turn: "black",
        engineColor: "black",
      }),
    ).toBe(true);
    expect(
      shouldRequestOpponentMove({
        started: false,
        paused: false,
        isBrowsingHistory: false,
        isGameOver: false,
        turn: "black",
        engineColor: "black",
      }),
    ).toBe(false);
    expect(
      shouldRequestOpponentMove({
        started: true,
        paused: true,
        isBrowsingHistory: false,
        isGameOver: false,
        turn: "black",
        engineColor: "black",
      }),
    ).toBe(false);
    expect(
      shouldRequestOpponentMove({
        started: true,
        paused: false,
        isBrowsingHistory: true,
        isGameOver: false,
        turn: "black",
        engineColor: "black",
      }),
    ).toBe(false);
    expect(
      shouldRequestOpponentMove({
        started: true,
        paused: false,
        isBrowsingHistory: false,
        isGameOver: true,
        turn: "black",
        engineColor: "black",
      }),
    ).toBe(false);
    expect(
      shouldRequestOpponentMove({
        started: true,
        paused: false,
        isBrowsingHistory: false,
        isGameOver: false,
        turn: "white",
        engineColor: "black",
      }),
    ).toBe(false);
  });

  it("treats scholar mate as terminal, so the opponent must not be requested again", () => {
    const scholarMate = playMate([
      "e2e4",
      "e7e5",
      "d1h5",
      "b8c6",
      "f1c4",
      "g8f6",
      "h5f7",
    ]);
    expect(scholarMate.isGameOver).toBe(true);
    expect(
      shouldRequestOpponentMove({
        started: true,
        paused: false,
        isBrowsingHistory: false,
        isGameOver: scholarMate.isGameOver,
        turn: scholarMate.turn,
        engineColor: "black",
      }),
    ).toBe(false);
  });
});

describe("post-game review orchestration", () => {
  it("only captures a mate review at the exact terminal cursor and opens immediately for reduced motion", () => {
    const mate = loadPgn("1. f3 e5 2. g4 Qh4# 0-1");
    const atEnd = createSessionWorkspace(mate);
    const browsing = {
      ...atEnd,
      lines: atEnd.lines.map((line) => ({
        ...line,
        timeline: { ...line.timeline, cursor: mate.history.length - 1 },
      })),
    };

    expect(shouldCapturePostgameReview(atEnd)).toBe(true);
    expect(shouldCapturePostgameReview(browsing)).toBe(false);
    expect(postgameReviewAutoOpenDelayMs(true)).toBe(0);
    expect(postgameReviewAutoOpenDelayMs(false)).toBeGreaterThan(300);
  });

  it("auto-opens each terminal review identity only once despite progress updates", () => {
    vi.useFakeTimers();
    try {
      const open = vi.fn();
      let handled: string | undefined;
      const first = postgameReviewAutoOpenCandidate("review-a", true, handled);
      expect(first).toBe("review-a");
      handled = first;
      window.setTimeout(open, postgameReviewAutoOpenDelayMs(true));
      vi.runOnlyPendingTimers();
      expect(open).toHaveBeenCalledTimes(1);

      // Closing the dialog or receiving more evidence leaves the review ID
      // unchanged, therefore neither may schedule another automatic open.
      expect(
        postgameReviewAutoOpenCandidate("review-a", true, handled),
      ).toBeUndefined();
      expect(
        postgameReviewAutoOpenCandidate("review-a", true, handled),
      ).toBeUndefined();
      expect(open).toHaveBeenCalledTimes(1);

      const second = postgameReviewAutoOpenCandidate("review-b", true, handled);
      expect(second).toBe("review-b");
      window.setTimeout(open, postgameReviewAutoOpenDelayMs(true));
      vi.runOnlyPendingTimers();
      expect(open).toHaveBeenCalledTimes(2);

      // A reset/new session clears the handled identity, so an identical
      // deterministic terminal line can be announced in a later game.
      handled = undefined;
      expect(postgameReviewAutoOpenCandidate("review-a", true, handled)).toBe(
        "review-a",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("plans terminal mate review analysis without ever requesting the terminal fen", async () => {
    const mate = playMate(["f2f3", "e7e5", "g2g4", "d8h4"]);
    const review = createPostgameReviewStateV1({
      session: mate,
      lineId: "main",
      playerColor: "black",
      feedbackByPly: [],
    });
    const finalMove = review.snapshot.moves.at(-1)!;
    const task = {
      kind: "terminal-checkmate" as const,
      reviewId: "review-a",
      moveIndex: finalMove.index,
      color: "black" as const,
      actor: "user" as const,
      beforeFen: finalMove.beforeFen,
      afterFen: finalMove.afterFen,
      priority: "normal" as const,
    };
    const analyzePosition = vi.fn(async () => ({
      id: `review-a:before:${finalMove.index}`,
      fen: finalMove.beforeFen,
      backend: "deterministic" as const,
      perspective: "black" as const,
      depth: 12,
      nodes: 1,
      lines: [
        {
          rank: 1,
          moves: [],
          score: { kind: "centipawns" as const, value: 90 },
        },
      ],
    }));

    expect(postgameAnalysisPositionsForTask(task)).toEqual([
      {
        id: `review-a:before:${finalMove.index}`,
        fen: finalMove.beforeFen,
        perspective: "black",
      },
    ]);
    const evidence = await resolvePostgameReviewTask({
      task,
      review,
      analyzePosition,
    });

    expect(analyzePosition).toHaveBeenCalledTimes(1);
    expect(analyzePosition).toHaveBeenCalledWith({
      id: `review-a:before:${finalMove.index}`,
      fen: finalMove.beforeFen,
      perspective: "black",
    });
    expect(analyzePosition).not.toHaveBeenCalledWith(
      expect.objectContaining({ fen: review.snapshot.terminalFen }),
    );
    expect(evidence?.kind).toBe("terminal-checkmate");
  });

  it("plans normal post-game review analysis with both before and after positions", async () => {
    const mate = playMate([
      "e2e4",
      "e7e5",
      "d1h5",
      "b8c6",
      "f1c4",
      "g8f6",
      "h5f7",
    ]);
    const review = createPostgameReviewStateV1({
      session: mate,
      lineId: "main",
      playerColor: "white",
      feedbackByPly: [],
    });
    const move = review.snapshot.moves[0]!;
    const task = {
      kind: "decision" as const,
      reviewId: "review-b",
      moveIndex: move.index,
      color: "white" as const,
      actor: "user" as const,
      beforeFen: move.beforeFen,
      afterFen: move.afterFen,
      priority: "normal" as const,
    };
    const analyzePosition = vi
      .fn()
      .mockResolvedValueOnce({
        id: `review-b:before:${move.index}`,
        fen: move.beforeFen,
        backend: "deterministic" as const,
        perspective: "white" as const,
        depth: 12,
        nodes: 1,
        lines: [
          {
            rank: 1,
            moves: [],
            score: { kind: "centipawns" as const, value: 50 },
          },
        ],
      })
      .mockResolvedValueOnce({
        id: `review-b:after:${move.index}`,
        fen: move.afterFen,
        backend: "deterministic" as const,
        perspective: "white" as const,
        depth: 12,
        nodes: 1,
        lines: [
          {
            rank: 1,
            moves: ["e2e4"],
            score: { kind: "centipawns" as const, value: 20 },
          },
        ],
      });

    expect(postgameAnalysisPositionsForTask(task)).toEqual([
      {
        id: `review-b:before:${move.index}`,
        fen: move.beforeFen,
        perspective: "white",
      },
      {
        id: `review-b:after:${move.index}`,
        fen: move.afterFen,
        perspective: "white",
      },
    ]);
    const evidence = await resolvePostgameReviewTask({
      task,
      review,
      analyzePosition,
    });

    expect(analyzePosition).toHaveBeenCalledTimes(2);
    expect(evidence?.kind).toBe("decision");
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

  it("uses the v3 compact and expanded wording without exposing internal engine terms", async () => {
    const before = createInitialGame();
    const after = applyMove(before, { from: "e2", to: "e4" });
    const move = after.history.at(-1)!;
    const record = {
      schemaVersion: 3,
      turn: {
        ply: 1,
        actor: "user",
        playedUci: move.uci,
        playedSan: move.san,
        beforeFen: before.fen,
        afterFen: after.fen,
        perspective: "white",
      },
      evidence: {
        before: { rank: 1, moves: [], score: { kind: "centipawns", value: 0 } },
        after: { rank: 1, moves: [], score: { kind: "centipawns", value: 0 } },
        perspective: "white",
        playedUci: move.uci,
        verifiedBestVariation: [{ uci: move.uci, san: move.san }],
        validation: { playedMoveLegal: true, bestLineFullyLegal: true },
      },
      assessment: {
        label: "excellent",
        expectedLoss: 0,
        expectedScoreBefore: {
          value: 0.5,
          source: "centipawn",
          calibrationVersion: "centipawn-logistic-v1",
        },
        expectedScoreAfter: {
          value: 0.5,
          source: "centipawn",
          calibrationVersion: "centipawn-logistic-v1",
        },
        isEstimated: true,
        calibration: {
          version: "expected-score-v1",
          perspective: "white",
          sourceBefore: "centipawn",
          sourceAfter: "centipawn",
        },
        context: {
          alreadyLost: false,
          mateLost: false,
          helpLevel: "normal",
          equivalent: false,
          missedWin: false,
        },
      },
      motif: { kind: "development", detectorVersion: "motif-v2", evidence: [] },
      explanation: {
        mode: "explained",
        primaryReason: {
          kind: "slow-development",
          confidence: "medium",
          factRefs: [],
        },
        consequence: { kind: "initiative", factRefs: [] },
        bestMovePurposes: ["develops-piece"],
        supportingVariation: [{ uci: move.uci, san: move.san }],
      },
      presentation: {
        locale: "es",
        templateId: "test-v3",
        summary: "Buena jugada: desarrollas una pieza.",
        detail:
          "Buena jugada: desarrollas una pieza y dejas preparada la salida de tus demás piezas.",
      },
      hints: [],
    } as const;

    expect(feedbackPresentationFor(record).summary).not.toBe(
      feedbackPresentationFor(record).detail,
    );
    await act(async () => {
      root.render(
        createElement(AdvicePanel, {
          feedbackEntry: {
            historyIndex: 0,
            uci: move.uci,
            actor: "user",
            beforeFen: before.fen,
            afterFen: after.fen,
            status: "ready",
            record,
          },
          helpLevel: "normal",
          selectedMaia: false,
          lineVisible: false,
          onToggleLine: vi.fn(),
          slow: false,
          onRetry: vi.fn(),
        }),
      );
    });
    expect(container.textContent).toContain(record.presentation.summary);
    expect(container.textContent).not.toMatch(
      /confianza|centipe[oó]n|depth|multipv|\bPV\b/iu,
    );
    const open = container.querySelector<HTMLButtonElement>(
      ".feedback-detail-trigger",
    );
    await act(async () => open?.click());
    expect(container.textContent).toContain(record.presentation.detail);
  });

  it("replaces contaminated legacy v2 copy with a neutral migration message", async () => {
    const before = createInitialGame();
    const after = applyMove(before, { from: "e2", to: "e4" });
    const move = after.history.at(-1)!;
    const legacy = {
      schemaVersion: 2,
      turn: {
        ply: 1,
        actor: "user",
        playedUci: move.uci,
        playedSan: move.san,
        beforeFen: before.fen,
        afterFen: after.fen,
        perspective: "white",
      },
      evidence: {
        before: { rank: 1, moves: [], score: { kind: "centipawns", value: 0 } },
        after: { rank: 1, moves: [], score: { kind: "centipawns", value: 0 } },
        perspective: "white",
        playedUci: move.uci,
        verifiedBestVariation: [],
        validation: { playedMoveLegal: true, bestLineFullyLegal: true },
      },
      motif: { kind: "activity", detectorVersion: "motif-v1", evidence: [] },
      copy: {
        locale: "es",
        templateId: "legacy-pv",
        text: "La PV a profundidad 18 pierde 42 centipeones con confianza alta.",
      },
      hints: [],
    } as const;

    expect(feedbackPresentationFor(legacy).summary).not.toContain("PV");
    await act(async () => {
      root.render(
        createElement(AdvicePanel, {
          feedbackEntry: {
            historyIndex: 0,
            uci: move.uci,
            actor: "user",
            beforeFen: before.fen,
            afterFen: after.fen,
            status: "ready",
            record: legacy,
          },
          helpLevel: "normal",
          selectedMaia: false,
          lineVisible: false,
          onToggleLine: vi.fn(),
          slow: false,
          onRetry: vi.fn(),
        }),
      );
    });
    expect(container.textContent).toContain(
      "El análisis detallado de esta jugada no está disponible.",
    );
    expect(container.textContent).not.toContain(legacy.copy.text);
    expect(container.textContent).not.toMatch(
      /confianza|centipe[oó]n|profundidad|\bPV\b/iu,
    );
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

  it("does not let deadline A clear a newer pending request B", () => {
    const pendingB = { identity: { requestId: "coach-b" } };
    expect(isCurrentCoachRequest(pendingB, "coach-a")).toBe(false);
    expect(isCurrentCoachRequest(pendingB, "coach-b")).toBe(true);
  });

  it("only analyzes non-terminal user moves in the live coach pipeline", () => {
    expect(shouldAnalyzeLiveCoachMove("user", { isGameOver: false })).toBe(
      true,
    );
    expect(shouldAnalyzeLiveCoachMove("user", { isGameOver: true })).toBe(
      false,
    );
    expect(shouldAnalyzeLiveCoachMove("maia", { isGameOver: false })).toBe(
      false,
    );
    expect(shouldAnalyzeLiveCoachMove("maia", { isGameOver: true })).toBe(
      false,
    );
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

  it("preserves the 18-second analysis deadline across a deferred retry", () => {
    expect(COACH_DEADLINE_MS).toBe(18_000);
    expect(coachRemainingDelay(COACH_DEADLINE_MS, 0, 5_000)).toBe(13_000);
    expect(coachRemainingDelay(COACH_DEADLINE_MS, 5_000, 18_000)).toBe(5_000);
    expect(coachRemainingDelay(COACH_DEADLINE_MS, 5_000, 30_000)).toBe(0);
  });

  it("does not revive a deferred retry after its analysis deadline has expired", () => {
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
    // start after the deadline has declared the analysis unavailable.
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

  it("settles a pending origin after promotion so late results and aborts cannot keep it pending", () => {
    const before = createInitialGame();
    const after = applyMove(before, { from: "e2", to: "e4" });
    const entry = replayHistory(after)[0]!;
    const identity = {
      lineId: "trial",
      lineRole: "trial" as const,
      fork: { lineId: "main", ply: 1 },
      historyIndex: 0,
      ply: 1,
      actor: "user" as const,
      uci: entry.move.uci,
      beforeFen: entry.beforeFen,
      afterFen: entry.afterFen,
      requestId: "promotion-pending",
    };
    const trial = createTrialLine(createSessionWorkspace(after), "trial");
    const pending = {
      ...trial,
      lines: trial.lines.map((line) =>
        line.id === "trial"
          ? {
              ...line,
              feedbackByPly: [
                {
                  historyIndex: 0,
                  uci: entry.move.uci,
                  actor: "user" as const,
                  beforeFen: entry.beforeFen,
                  afterFen: entry.afterFen,
                  status: "pending" as const,
                },
              ],
            }
          : line,
      ),
    };
    const promoted = promoteSessionLineAndDeleteFormerMain(pending, "trial");

    expect(acceptsAnalysisResult(promoted, identity, identity.requestId)).toBe(
      false,
    );
    const settled = finalizePendingCoachAttempt(promoted, identity);
    expect(settled.lines).toHaveLength(1);
    expect(settled.lines[0]?.feedbackByPly[0]?.status).toBe("unavailable");
    expect(
      coachFailureActionForTurn({ name: "AbortError" }, true, false, 0, false),
    ).toBe("stale");
  });

  it("never finalizes a pending entry that belongs to the other actor", () => {
    const before = createInitialGame();
    const after = applyMove(before, { from: "e2", to: "e4" });
    const entry = replayHistory(after)[0]!;
    const base = createSessionWorkspace(after);
    const identity = (actor: "user" | "maia") => ({
      lineId: "main",
      lineRole: "main" as const,
      historyIndex: 0,
      ply: 1,
      actor,
      uci: entry.move.uci,
      beforeFen: entry.beforeFen,
      afterFen: entry.afterFen,
      requestId: `${actor}-request`,
    });
    const pendingFor = (actor: "user" | "maia") => ({
      ...base,
      lines: base.lines.map((line) => ({
        ...line,
        feedbackByPly: [
          {
            historyIndex: 0,
            uci: entry.move.uci,
            actor,
            beforeFen: entry.beforeFen,
            afterFen: entry.afterFen,
            status: "pending" as const,
          },
        ],
      })),
    });

    expect(
      finalizePendingCoachAttempt(pendingFor("maia"), identity("user")).lines[0]
        ?.feedbackByPly[0]?.status,
    ).toBe("pending");
    expect(
      finalizePendingCoachAttempt(pendingFor("user"), identity("maia")).lines[0]
        ?.feedbackByPly[0]?.status,
    ).toBe("pending");
  });
});
