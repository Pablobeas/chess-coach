import {
  applyMove,
  createInitialGame,
  loadPosition,
} from "@chess-coach/chess-core";
import { describe, expect, it } from "vitest";
import {
  completeTerminalCheckmateEvidenceV1,
  createFinalLineSnapshotV1,
  decodeFinalLineSnapshotV1,
  decodePostgamePositionEvidenceV1,
  phaseFinalLine,
  summarizeCheckmateGame,
  type FinalLineSnapshotV1,
  type PostgameDecisionEvidenceV1,
} from "./postgame";

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

function scholarMate() {
  return play(["e2e4", "e7e5", "f1c4", "b8c6", "d1h5", "g8f6", "h5f7"]);
}

function terminalLine(session = foolsMate()): FinalLineSnapshotV1 {
  return createFinalLineSnapshotV1(session, { white: "user", black: "maia" });
}

function evidenceFor(
  line: FinalLineSnapshotV1,
  index: number,
  options: {
    readonly perspective?: "white" | "black";
    readonly best?: readonly [number, number, number];
    readonly played?: readonly [number, number, number];
  } = {},
): PostgameDecisionEvidenceV1 {
  const move = line.moves[index]!;
  const makeLine = (wdl: readonly [number, number, number]) => ({
    rank: 1,
    score: { kind: "centipawns" as const, value: 0 },
    moves: [],
    wdl: { wins: wdl[0], draws: wdl[1], losses: wdl[2] },
  });
  return {
    schemaVersion: 1,
    kind: "decision",
    moveIndex: index,
    beforeFen: move.beforeFen,
    afterFen: move.afterFen,
    perspective: options.perspective ?? move.color,
    bestLine: makeLine(options.best ?? [70, 20, 10]),
    playedLine: makeLine(options.played ?? [70, 20, 10]),
  };
}

describe("post-game terminal line", () => {
  it("keeps only the completed checkmate line with exact move metadata", () => {
    const session = foolsMate();
    const snapshot = terminalLine(session);

    expect(session.isCheckmate).toBe(true);
    expect(snapshot.result).toBe("checkmate");
    expect(snapshot.winner).toBe("black");
    expect(
      snapshot.moves.map((move) => [
        move.index,
        move.color,
        move.actor,
        move.san,
      ]),
    ).toEqual([
      [0, "white", "user", "f3"],
      [1, "black", "maia", "e5"],
      [2, "white", "user", "g4"],
      [3, "black", "maia", "Qh4#"],
    ]);
    expect(
      decodeFinalLineSnapshotV1(JSON.parse(JSON.stringify(snapshot))),
    ).toEqual(snapshot);
    expect(Object.isFrozen(snapshot.moves)).toBe(true);
    expect(Object.isFrozen(snapshot.moves[0]!)).toBe(true);
  });

  it("rejects non-terminal, corrupt and non-replayable snapshots", () => {
    const valid = terminalLine();
    const corrupt = structuredClone(valid) as unknown as {
      moves: { afterFen: string }[];
    };
    corrupt.moves[1]!.afterFen = valid.moves[0]!.afterFen;

    expect(() =>
      createFinalLineSnapshotV1(createInitialGame(), {
        white: "user",
        black: "maia",
      }),
    ).toThrow(/checkmate/);
    expect(decodeFinalLineSnapshotV1(corrupt)).toBeUndefined();
    expect(decodeFinalLineSnapshotV1({ schemaVersion: 1 })).toBeUndefined();
  });

  it("partitions a developed standard game into non-overlapping phases", () => {
    const phases = phaseFinalLine(terminalLine(scholarMate()));

    expect(phases).toHaveLength(7);
    expect(phases.slice(0, 6)).toEqual(Array(6).fill("opening"));
    expect(phases[6]).toBe("middlegame");
    expect(new Set(phases)).toEqual(new Set(["opening", "middlegame"]));
  });

  it("recognizes a material ending and makes opening not applicable for custom starts", () => {
    const custom = applyMove(loadPosition("7k/5K2/8/8/8/8/8/6Q1 w - - 0 1"), {
      from: "g1",
      to: "g7",
    });
    const summary = summarizeCheckmateGame(
      createFinalLineSnapshotV1(custom, { white: "maia", black: "user" }),
    );

    expect(custom.isCheckmate).toBe(true);
    expect(summary.phases.map((phase) => [phase.phase, phase.status])).toEqual([
      ["opening", "not-applicable"],
      ["middlegame", "not-reached"],
      ["ending", "reached"],
    ]);
  });
});

describe("post-game decision stability", () => {
  it("completes the final mating move with only pre-move analysis and exact outcome", () => {
    const fool = terminalLine();
    const scholar = terminalLine(scholarMate());
    const bestLine = evidenceFor(fool, 0).bestLine;
    const blackPerspective = completeTerminalCheckmateEvidenceV1(
      fool,
      "black",
      bestLine,
    );
    const whitePerspective = completeTerminalCheckmateEvidenceV1(
      scholar,
      "white",
      bestLine,
    );
    const fourTerminalContexts = [
      completeTerminalCheckmateEvidenceV1(fool, "white", bestLine),
      blackPerspective,
      whitePerspective,
      completeTerminalCheckmateEvidenceV1(scholar, "black", bestLine),
    ];
    const foolEvidence = fool.moves.map((_, index) =>
      index === fool.moves.length - 1
        ? blackPerspective
        : evidenceFor(fool, index),
    );
    const scholarEvidence = scholar.moves.map((_, index) =>
      index === scholar.moves.length - 1
        ? whitePerspective
        : evidenceFor(scholar, index),
    );

    expect(blackPerspective).toMatchObject({
      kind: "terminal-checkmate",
      moveIndex: 3,
      outcome: {
        winner: "black",
        loser: "white",
        terminalFen: fool.terminalFen,
      },
    });
    expect(whitePerspective).toMatchObject({
      kind: "terminal-checkmate",
      moveIndex: 6,
      outcome: {
        winner: "white",
        loser: "black",
        terminalFen: scholar.terminalFen,
      },
    });
    expect("playedLine" in blackPerspective).toBe(false);
    expect(
      fourTerminalContexts.every(
        (evidence) =>
          decodePostgamePositionEvidenceV1(evidence)?.kind ===
          "terminal-checkmate",
      ),
    ).toBe(true);
    expect(summarizeCheckmateGame(fool, foolEvidence).status).toBe("complete");
    expect(summarizeCheckmateGame(scholar, scholarEvidence).status).toBe(
      "complete",
    );
  });

  it("accepts terminal evidence only for the exact final snapshot move", () => {
    const line = terminalLine();
    const terminal = completeTerminalCheckmateEvidenceV1(
      line,
      "black",
      evidenceFor(line, 0).bestLine,
    );
    const earlyTerminal = { ...terminal, moveIndex: 1 };
    const nonTerminal = {
      ...terminal,
      afterFen: line.moves[2]!.afterFen,
      outcome: { ...terminal.outcome, terminalFen: line.moves[2]!.afterFen },
    };

    expect(decodePostgamePositionEvidenceV1(earlyTerminal)).toBeDefined();
    expect(decodePostgamePositionEvidenceV1(nonTerminal)).toBeUndefined();
    expect(
      decodePostgamePositionEvidenceV1({
        ...terminal,
        outcome: { ...terminal.outcome, winner: "white" },
      }),
    ).toBeUndefined();
    expect(summarizeCheckmateGame(line, [earlyTerminal]).status).toBe(
      "partial",
    );
  });

  it("scores the two sides symmetrically and preserves WDL source", () => {
    const line = terminalLine();
    const summary = summarizeCheckmateGame(
      line,
      line.moves.map((_, index) => evidenceFor(line, index)),
    );
    const all = summary.phases.flatMap((phase) => [phase.white, phase.black]);

    expect(summary.status).toBe("complete");
    expect(
      all
        .filter((stability) => stability.decisionsScored > 0)
        .every((stability) => stability.score === 100),
    ).toBe(true);
    expect(
      all.reduce((total, stability) => total + stability.coverage.available, 0),
    ).toBe(4);
  });

  it("uses RMS so one outlier is reflected without pretending it is a probability", () => {
    const line = terminalLine();
    const evidence = line.moves.map((_, index) =>
      evidenceFor(
        line,
        index,
        index === 2 ? { best: [100, 0, 0], played: [0, 0, 100] } : {},
      ),
    );
    const summary = summarizeCheckmateGame(line, evidence);
    const white = summary.phases.find(
      (phase) => phase.phase === "opening",
    )!.white;

    expect(white.rmsExpectedLoss).toBeGreaterThan(0.6);
    expect(white.score).toBe(0);
    expect(white.buckets.critical).toBe(1);
    expect(JSON.stringify(summary)).not.toMatch(/probabilidad|PV|centipawn/i);
  });

  it("marks a side with no margin rather than counting its forced loss as an error", () => {
    const line = terminalLine();
    const noMargin = evidenceFor(line, 0, {
      best: [0, 0, 100],
      played: [0, 0, 100],
    });
    const summary = summarizeCheckmateGame(line, [noMargin]);
    const white = summary.phases.find(
      (phase) => phase.phase === "opening",
    )!.white;

    expect(white.decisionsScored).toBe(0);
    expect(white.noMargin).toBe(1);
    expect(white.buckets["no-margin"]).toBe(1);
    expect(white.score).toBeUndefined();
  });

  it("keeps a partial report honest when evidence is absent, corrupt, duplicated or mismatched", () => {
    const line = terminalLine();
    const good = evidenceFor(line, 1);
    const mismatch = {
      ...evidenceFor(line, 2),
      afterFen: line.moves[1]!.afterFen,
    };
    const duplicate = evidenceFor(line, 1);
    const summary = summarizeCheckmateGame(line, [
      good,
      mismatch,
      duplicate,
      { schemaVersion: 1 },
    ]);

    expect(decodePostgamePositionEvidenceV1(mismatch)).toBeDefined();
    expect(summary.status).toBe("partial");
    expect(
      summary.phases
        .flatMap((phase) => [phase.white, phase.black])
        .reduce((total, stability) => total + stability.coverage.available, 0),
    ).toBe(1);
  });

  it("corrects black-perspective evidence before measuring a white move", () => {
    const line = terminalLine();
    const evidence = evidenceFor(line, 0, {
      perspective: "black",
      best: [0, 0, 100],
      played: [50, 0, 50],
    });
    const summary = summarizeCheckmateGame(line, [evidence]);
    const white = summary.phases.find(
      (phase) => phase.phase === "opening",
    )!.white;

    expect(white.decisionsScored).toBe(1);
    expect(white.buckets.critical).toBe(1);
  });

  it("is deterministic and does not mutate caller-owned evidence", () => {
    const line = terminalLine();
    const evidence = [evidenceFor(line, 0)];
    const before = structuredClone(evidence);
    const first = summarizeCheckmateGame(line, evidence);
    const second = summarizeCheckmateGame(line, evidence);

    expect(first).toEqual(second);
    expect(evidence).toEqual(before);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.phases[0]!.white.buckets)).toBe(true);
  });
});
