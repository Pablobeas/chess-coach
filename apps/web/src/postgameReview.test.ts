import { applyMove, createInitialGame } from "@chess-coach/chess-core";
import type { CoachTurnRecord } from "@chess-coach/coach";
import { completeTerminalCheckmateEvidenceV1 } from "@chess-coach/coach";
import { describe, expect, it } from "vitest";
import type { MoveFeedbackRecord } from "./persistence";
import {
  createPostgameReviewStateV1,
  decodePostgameReviewStateV1,
  isPostgameReviewPendingForMove,
  listPostgameReviewTasks,
  markPostgameReviewUnavailable,
  mergePostgameReviewEvidence,
  postgameEvidenceFromAnalysis,
  seedPostgameReviewFromFeedback,
} from "./postgameReview";

function play(uciMoves: readonly string[]) {
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

function foolsMate() {
  return play(["f2f3", "e7e5", "g2g4", "d8h4"]);
}

function scholarsMate() {
  return play(["e2e4", "e7e5", "d1h5", "b8c6", "f1c4", "g8f6", "h5f7"]);
}

function v3Record(entry: {
  readonly moveIndex: number;
  readonly uci: string;
  readonly beforeFen: string;
  readonly afterFen: string;
  readonly san: string;
  readonly perspective: "white" | "black";
}): CoachTurnRecord {
  return {
    schemaVersion: 3,
    turn: {
      ply: entry.moveIndex + 1,
      actor: "user",
      playedUci: entry.uci,
      playedSan: entry.san,
      beforeFen: entry.beforeFen,
      afterFen: entry.afterFen,
      perspective: entry.perspective,
    },
    evidence: {
      before: { rank: 1, moves: [], score: { kind: "centipawns", value: 30 } },
      after: { rank: 1, moves: [], score: { kind: "centipawns", value: 10 } },
      perspective: entry.perspective,
      playedUci: entry.uci,
      verifiedBestVariation: [{ uci: entry.uci, san: entry.san }],
      validation: { playedMoveLegal: true, bestLineFullyLegal: true },
    },
    assessment: {
      label: "good",
      expectedLoss: 0.04,
      expectedScoreBefore: {
        value: 0.55,
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
        perspective: entry.perspective,
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
    motif: { kind: "activity", detectorVersion: "motif-v2", evidence: [] },
    explanation: {
      mode: "explained",
      primaryReason: {
        kind: "slow-development",
        confidence: "medium",
        factRefs: [],
      },
      consequence: { kind: "initiative", factRefs: [] },
      bestMovePurposes: ["develops-piece"],
      supportingVariation: [{ uci: entry.uci, san: entry.san }],
    },
    presentation: {
      locale: "es",
      templateId: "postgame-review",
      summary: "Resumen",
      detail: "Detalle",
    },
    hints: [],
  };
}

function feedbackEntry(
  session = foolsMate(),
  moveIndex = 0,
  actorOverride?: "user" | "maia",
): MoveFeedbackRecord {
  const history = session.history[moveIndex]!;
  const replay = session.history.slice(0, moveIndex + 1);
  const before = play(replay.slice(0, moveIndex).map((move) => move.uci));
  const after = play(replay.map((move) => move.uci));
  const color = before.turn;
  const actor = actorOverride ?? (moveIndex % 2 === 0 ? "user" : "maia");
  const base: Omit<MoveFeedbackRecord, "record"> = {
    historyIndex: moveIndex,
    uci: history.uci,
    actor,
    beforeFen: before.fen,
    afterFen: after.fen,
    status: "ready" as const,
  };
  return actor === "user"
    ? {
        ...base,
        record: v3Record({
          moveIndex,
          uci: history.uci,
          beforeFen: before.fen,
          afterFen: after.fen,
          san: history.san,
          perspective: color,
        }),
      }
    : base;
}

describe("postgameReview", () => {
  it("captures only the final checkmated line and seeds exact v3 evidence", () => {
    const session = scholarsMate();
    const feedbackByPly = [
      feedbackEntry(session, 0),
      feedbackEntry(session, 2),
    ];

    const review = createPostgameReviewStateV1({
      session,
      lineId: "trial-mate",
      playerColor: "white",
      feedbackByPly,
    });

    expect(review.snapshot.moves.map((move) => move.uci)).toEqual([
      "e2e4",
      "e7e5",
      "d1h5",
      "b8c6",
      "f1c4",
      "g8f6",
      "h5f7",
    ]);
    expect(review.snapshot.participants.white.actor).toBe("user");
    expect(review.snapshot.participants.black.actor).toBe("maia");
    expect(review.evidence.map((item) => item.moveIndex)).toEqual([0, 2]);
    expect(review.evidence.every((item) => item.kind === "decision")).toBe(
      true,
    );
    expect(review.progress).toEqual({ completed: 2, total: 7 });
    expect(review.status).toBe("partial");
    expect(Object.isFrozen(review.snapshot.moves)).toBe(true);
  });

  it("assigns actors correctly when the user mates with black", () => {
    const review = createPostgameReviewStateV1({
      session: foolsMate(),
      lineId: "main",
      playerColor: "black",
      feedbackByPly: [feedbackEntry(foolsMate(), 1, "user")],
    });

    expect(review.snapshot.winner).toBe("black");
    expect(review.snapshot.participants.white.actor).toBe("maia");
    expect(review.snapshot.participants.black.actor).toBe("user");
    expect(review.evidence.map((item) => item.moveIndex)).toEqual([1]);
  });

  it("seeds terminal mate evidence as terminal-checkmate instead of a fake after analysis", () => {
    const session = foolsMate();
    const review = createPostgameReviewStateV1({
      session,
      lineId: "main",
      playerColor: "black",
      feedbackByPly: [feedbackEntry(session, 3, "user")],
    });

    expect(review.evidence).toHaveLength(1);
    expect(review.evidence[0]?.kind).toBe("terminal-checkmate");
    expect(review.evidence[0]).toEqual(
      completeTerminalCheckmateEvidenceV1(
        review.snapshot,
        "black",
        (feedbackEntry(session, 3, "user").record as CoachTurnRecord).evidence
          .before,
      ),
    );
  });

  it("orders missing work by priority, skips pending workspace feedback, and merges later seeds", () => {
    const session = scholarsMate();
    const initial = createPostgameReviewStateV1({
      session,
      lineId: "trial",
      playerColor: "white",
      feedbackByPly: [],
    });
    const pendingFeedback: MoveFeedbackRecord[] = [
      {
        historyIndex: 0,
        uci: feedbackEntry(session, 0).uci,
        actor: "user",
        beforeFen: feedbackEntry(session, 0).beforeFen,
        afterFen: feedbackEntry(session, 0).afterFen,
        status: "pending",
      },
    ];

    const tasks = listPostgameReviewTasks(initial);
    expect(tasks.slice(0, 3).map((task) => task.priority)).toEqual([
      "normal",
      "normal",
      "normal",
    ]);
    expect(tasks.at(-1)?.priority).toBe("low");
    expect(
      tasks.find((task) => task.moveIndex === session.history.length - 1)?.kind,
    ).toBe("terminal-checkmate");
    expect(isPostgameReviewPendingForMove(initial, pendingFeedback, 0)).toBe(
      true,
    );

    const seeded = seedPostgameReviewFromFeedback(initial, [
      feedbackEntry(session, 0),
      feedbackEntry(session, 2),
    ]);
    expect(seeded.evidence.map((item) => item.moveIndex)).toEqual([0, 2]);
    expect(listPostgameReviewTasks(seeded)[0]?.moveIndex).toBe(4);
  });

  it("validates persisted state by exact snapshot identities, progress and policies", () => {
    const review = createPostgameReviewStateV1({
      session: foolsMate(),
      lineId: "main",
      playerColor: "black",
      feedbackByPly: [feedbackEntry(foolsMate(), 1)],
    });
    const stored = JSON.parse(JSON.stringify(review)) as Record<
      string,
      unknown
    >;

    expect(decodePostgameReviewStateV1(stored)).toEqual(review);

    (stored.progress as { completed: number }).completed = 99;
    expect(decodePostgameReviewStateV1(stored)).toBeUndefined();

    const wrongPolicy = JSON.parse(JSON.stringify(review)) as {
      policies: { phases: string; scoring: string };
    };
    wrongPolicy.policies.phases = "other-policy";
    expect(decodePostgameReviewStateV1(wrongPolicy)).toBeUndefined();
  });

  it("keeps late results guarded by exact move identities and can settle as unavailable", () => {
    const review = createPostgameReviewStateV1({
      session: foolsMate(),
      lineId: "main",
      playerColor: "black",
      feedbackByPly: [],
    });
    const moveOne = postgameEvidenceFromAnalysis({
      review,
      moveIndex: 1,
      bestLine: {
        rank: 1,
        moves: [],
        score: { kind: "centipawns", value: 20 },
      },
      playedLine: {
        rank: 1,
        moves: ["e7e5"],
        score: { kind: "centipawns", value: 10 },
      },
    })!;

    const merged = mergePostgameReviewEvidence(review, moveOne);
    expect(merged.progress.completed).toBe(1);
    expect(
      mergePostgameReviewEvidence(merged, {
        ...moveOne,
        afterFen: review.snapshot.moves[0]!.afterFen,
      }).progress.completed,
    ).toBe(1);
    expect(markPostgameReviewUnavailable(merged).status).toBe("unavailable");
  });

  it("reaches ready when all normal moves and the terminal mate are merged", () => {
    const review = createPostgameReviewStateV1({
      session: foolsMate(),
      lineId: "main",
      playerColor: "black",
      feedbackByPly: [],
    });
    const ready = review.snapshot.moves.reduce((current, move) => {
      if (move.afterFen === current.snapshot.terminalFen) {
        return mergePostgameReviewEvidence(
          current,
          completeTerminalCheckmateEvidenceV1(current.snapshot, move.color, {
            rank: 1,
            moves: [],
            score: { kind: "centipawns", value: 50 },
          }),
        );
      }
      return mergePostgameReviewEvidence(
        current,
        postgameEvidenceFromAnalysis({
          review: current,
          moveIndex: move.index,
          bestLine: {
            rank: 1,
            moves: [],
            score: { kind: "centipawns", value: 50 },
          },
          playedLine: {
            rank: 1,
            moves: [move.uci],
            score: { kind: "centipawns", value: 25 },
          },
        })!,
      );
    }, review);

    expect(ready.progress).toEqual({ completed: 4, total: 4 });
    expect(ready.status).toBe("ready");
    expect(ready.summary.status).toBe("complete");
  });
});
