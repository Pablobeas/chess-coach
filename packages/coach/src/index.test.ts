import {
  applyMove,
  createInitialGame,
  loadPosition,
} from "@chess-coach/chess-core";
import { describe, expect, it } from "vitest";
import {
  assessTurn,
  analyzeMove,
  analyzeTurn,
  classifyMove,
  expectedScoreFromWdl,
  hintForLevel,
} from "./index";

const line = (
  score:
    | { readonly kind: "centipawns"; readonly value: number }
    | {
        readonly kind: "mate";
        readonly moves: number;
      },
  moves: readonly string[],
) => ({ rank: 1, score, moves });

describe("coach turn records", () => {
  it("matches the completed turn assessment as soon as both engine lines are available", () => {
    const initial = createInitialGame();
    const initialAfter = applyMove(initial, { from: "e2", to: "e4" });
    const hangingBefore = loadPosition("4k3/6pp/8/6p1/8/8/4N3/4K3 w - - 0 1");
    const hangingAfter = applyMove(hangingBefore, { from: "e2", to: "f4" });
    const cases = [
      {
        name: "WDL with equivalent MultiPV choices",
        expectedLabel: "best",
        before: initial,
        after: initialAfter,
        beforeLine: {
          ...line({ kind: "centipawns", value: 25 }, ["e2e4"]),
          wdl: { wins: 6, draws: 2, losses: 2 },
        },
        afterLine: {
          ...line({ kind: "centipawns", value: 10 }, ["e7e5"]),
          wdl: { wins: 5, draws: 4, losses: 1 },
        },
        options: {
          beforeLines: [
            line({ kind: "centipawns", value: 20 }, ["e2e4"]),
            { ...line({ kind: "centipawns", value: 22 }, ["d2d4"]), rank: 2 },
          ],
        },
      },
      {
        name: "centipawn loss",
        expectedLabel: "mistake",
        before: initial,
        after: initialAfter,
        beforeLine: line({ kind: "centipawns", value: 120 }, ["e2e4"]),
        afterLine: line({ kind: "centipawns", value: -100 }, ["e7e5"]),
        options: {},
      },
      {
        name: "lost forced mate",
        expectedLabel: "blunder",
        before: initial,
        after: initialAfter,
        beforeLine: line({ kind: "mate", moves: 3 }, ["e2e4"]),
        afterLine: line({ kind: "mate", moves: -2 }, ["e7e5"]),
        options: {},
      },
      {
        name: "missed winning chance",
        expectedLabel: "miss",
        before: initial,
        after: initialAfter,
        beforeLine: line({ kind: "centipawns", value: 400 }, ["e2e4"]),
        afterLine: line({ kind: "centipawns", value: -100 }, ["e7e5"]),
        options: {},
      },
      {
        name: "already lost",
        expectedLabel: "already-lost",
        before: initial,
        after: initialAfter,
        beforeLine: line({ kind: "centipawns", value: -1200 }, ["e2e4"]),
        afterLine: line({ kind: "centipawns", value: -1300 }, ["e7e5"]),
        options: {},
      },
      {
        name: "brilliant with a partial after PV",
        expectedLabel: "brilliant",
        before: hangingBefore,
        after: hangingAfter,
        beforeLine: line({ kind: "centipawns", value: 30 }, ["e2f4"]),
        afterLine: line({ kind: "centipawns", value: 30 }, ["g5f4"]),
        options: {},
      },
    ] as const;

    cases.forEach(
      ({
        name,
        expectedLabel,
        before,
        after,
        beforeLine,
        afterLine,
        options,
      }) => {
        const early = assessTurn(before, after, beforeLine, afterLine, options);
        const completed = analyzeTurn(
          before,
          after,
          beforeLine,
          afterLine,
          options,
        ).assessment;

        expect(early, name).toEqual(completed);
        expect(early?.label, name).toBe(expectedLabel);
      },
    );
  });

  it("does not produce a user assessment for a Maia turn", () => {
    const before = createInitialGame();
    const after = applyMove(before, { from: "e2", to: "e4" });

    expect(
      assessTurn(
        before,
        after,
        line({ kind: "centipawns", value: 10 }, ["e2e4"]),
        line({ kind: "centipawns", value: 5 }, ["e7e5"]),
        { actor: "maia" },
      ),
    ).toBeUndefined();
  });

  it("rejects an illegal progress PV before producing a provisional assessment", () => {
    const before = createInitialGame();
    const after = applyMove(before, { from: "e2", to: "e4" });

    expect(() =>
      assessTurn(
        before,
        after,
        line({ kind: "centipawns", value: 20 }, ["e2e4"]),
        line({ kind: "centipawns", value: -40 }, ["e7e5", "e2e4"]),
        { requireCompleteVariations: true },
      ),
    ).toThrow(/fully legal/i);
  });

  it("keeps raw engine evidence, calibrated assessment, motif, copy, and hints separate", () => {
    const before = createInitialGame();
    const after = applyMove(before, { from: "e2", to: "e4" });
    const record = analyzeTurn(
      before,
      after,
      line({ kind: "centipawns", value: 10 }, ["e2e4"]),
      line({ kind: "centipawns", value: -80 }, ["e7e5"]),
    );

    expect(record.schemaVersion).toBe(2);
    expect(record.turn).toMatchObject({
      ply: 1,
      actor: "user",
      playedUci: "e2e4",
    });
    expect(record.evidence.before.score).toEqual({
      kind: "centipawns",
      value: 10,
    });
    expect(record.assessment?.expectedScoreBefore.calibrationVersion).toBe(
      "centipawn-logistic-v1",
    );
    expect(record.motif.kind).toBeDefined();
    expect(
      record.copy?.text.split(/[.!?](?:\s|$)/).filter(Boolean),
    ).toHaveLength(3);
    expect(record.hints.map((hint) => hint.level)).toEqual([1, 2, 3]);
    expect(record.hints[1]?.text).toBe("Revisa el peón e2-e4.");
    expect(record.hints[2]?.text).toBe("Prueba el peón e2-e4.");
  });

  it("uses WDL directly and calls a centipawn conversion an estimate", () => {
    expect(expectedScoreFromWdl(3, 2, 1)).toBeCloseTo(2 / 3);
    const before = createInitialGame();
    const after = applyMove(before, { from: "e2", to: "e4" });
    const record = analyzeTurn(
      before,
      after,
      {
        ...line({ kind: "centipawns", value: 25 }, ["e2e4"]),
        wdl: { wins: 6, draws: 2, losses: 2 },
      },
      {
        ...line({ kind: "centipawns", value: 10 }, ["e7e5"]),
        wdl: { wins: 5, draws: 4, losses: 1 },
      },
    );

    expect(record.assessment?.calibration.sourceBefore).toBe("wdl");
    expect(record.assessment?.isEstimated).toBe(false);
    expect(record.copy?.text).not.toContain("probabilidad exacta");
  });

  it("classifies a lost forced mate as a blunder even when ordinary loss thresholds are not used", () => {
    const before = createInitialGame();
    const after = applyMove(before, { from: "e2", to: "e4" });
    const record = analyzeTurn(
      before,
      after,
      line({ kind: "mate", moves: 3 }, ["e2e4"]),
      line({ kind: "mate", moves: -2 }, ["e7e5"]),
    );

    expect(record.assessment?.label).toBe("blunder");
    expect(record.motif.kind).toBe("mate");
  });

  it("does not call a still-winning position a blunder only because mate is no longer forced", () => {
    const before = createInitialGame();
    const after = applyMove(before, { from: "e2", to: "e4" });
    const record = analyzeTurn(
      before,
      after,
      line({ kind: "mate", moves: 3 }, ["e2e4"]),
      line({ kind: "centipawns", value: 1000 }, ["e7e5"]),
    );

    expect(record.assessment?.context.mateLost).toBe(false);
    expect(record.assessment?.label).not.toBe("blunder");
  });

  it("does not overstate tiny changes or already-lost positions", () => {
    expect(classifyMove(0)).toBe("best");
    expect(classifyMove(0.01)).toBe("excellent");
    expect(classifyMove(0.02)).toBe("excellent");
    expect(classifyMove(0.020_001)).toBe("good");
    expect(classifyMove(0.05)).toBe("good");
    expect(classifyMove(0.050_001)).toBe("inaccuracy");
    expect(classifyMove(0.1)).toBe("inaccuracy");
    expect(classifyMove(0.100_001)).toBe("mistake");
    expect(classifyMove(0.2)).toBe("mistake");
    expect(classifyMove(0.200_001)).toBe("blunder");
    expect(classifyMove(0.1, { alreadyLost: true })).toBe("inaccuracy");

    const before = createInitialGame();
    const after = applyMove(before, { from: "e2", to: "e4" });
    const record = analyzeTurn(
      before,
      after,
      line({ kind: "centipawns", value: -1200 }, ["e2e4"]),
      line({ kind: "centipawns", value: -1300 }, ["e7e5"]),
    );
    expect(record.assessment?.label).not.toBe("blunder");
  });

  it("detects a verified capture and a verified check from legal session data", () => {
    const opening = applyMove(
      applyMove(applyMove(createInitialGame(), { from: "e2", to: "e4" }), {
        from: "e7",
        to: "e5",
      }),
      { from: "g1", to: "f3" },
    );
    const readyForCapture = applyMove(opening, { from: "a7", to: "a6" });
    const capture = applyMove(readyForCapture, { from: "f3", to: "e5" });
    const captureRecord = analyzeTurn(
      readyForCapture,
      capture,
      line({ kind: "centipawns", value: 20 }, ["f3e5"]),
      line({ kind: "centipawns", value: 18 }, ["b8c6"]),
    );
    expect(captureRecord.motif.kind).toBe("material");

    const checkBefore = loadPosition("4k3/8/8/8/8/8/4Q3/4K3 w - - 0 1");
    const checkAfter = applyMove(checkBefore, { from: "e2", to: "e7" });
    const checkRecord = analyzeTurn(
      checkBefore,
      checkAfter,
      line({ kind: "centipawns", value: 200 }, ["e2e7"]),
      line({ kind: "centipawns", value: 210 }, ["e8f8"]),
    );
    expect(checkRecord.motif.kind).toBe("king-safety");
  });

  it("detects a hanging piece from the opponent's legal captures", () => {
    const before = loadPosition("4k3/6pp/8/6p1/8/8/4N3/4K3 w - - 0 1");
    const after = applyMove(before, { from: "e2", to: "f4" });
    const record = analyzeTurn(
      before,
      after,
      line({ kind: "centipawns", value: 30 }, ["e2f4"]),
      line({ kind: "centipawns", value: -180 }, ["g5f4"]),
    );

    expect(record.motif.kind).toBe("hanging-piece");
    expect(record.motif.facts?.[0]?.detail).toContain("f4");
    expect(record.copy?.text).toContain("capturable");
  });

  it("explains the played move and the legal alternative with origin and destination", () => {
    const before = createInitialGame();
    const after = applyMove(before, { from: "a2", to: "a3" });
    const record = analyzeTurn(
      before,
      after,
      line({ kind: "centipawns", value: 120 }, ["e2e4"]),
      line({ kind: "centipawns", value: -100 }, ["e7e5"]),
    );

    expect(record.copy?.text).toContain("Moviste el peón a2-a3");
    expect(record.copy?.text).toContain(
      "La mejor alternativa era mover el peón e2-e4",
    );
    expect(record.copy?.text).not.toContain("La alternativa e4");
    expect(record.evidence.alternativeMove).toMatchObject({
      uci: "e2e4",
      san: "e4",
    });
  });

  it("formats the response move in a guided hint without an isolated SAN token", () => {
    const before = createInitialGame();
    const after = applyMove(before, { from: "e2", to: "e4" });
    const record = analyzeTurn(
      before,
      after,
      line({ kind: "centipawns", value: 20 }, ["e2e4", "e7e5"]),
      line({ kind: "centipawns", value: -10 }, ["e7e5"]),
    );

    expect(record.hints[2]?.text).toBe(
      "Prueba el peón e2-e4 y la respuesta Peón e7-e5.",
    );
  });

  it("recognizes equivalent MultiPV choices without inventing a positional fault", () => {
    const before = createInitialGame();
    const after = applyMove(before, { from: "e2", to: "e4" });
    const record = analyzeTurn(
      before,
      after,
      line({ kind: "centipawns", value: 20 }, ["e2e4"]),
      line({ kind: "centipawns", value: -10 }, ["e7e5"]),
      {
        beforeLines: [
          line({ kind: "centipawns", value: 20 }, ["e2e4"]),
          { ...line({ kind: "centipawns", value: 22 }, ["d2d4"]), rank: 2 },
        ],
      },
    );

    expect(record.assessment?.context.equivalent).toBe(true);
    expect(record.motif.kind).toBe("equivalent");
    expect(record.copy?.text).toContain("varias continuaciones");
  });

  it("classifies a missed winning opportunity separately", () => {
    expect(classifyMove(0.2, { missedWin: true })).toBe("miss");
    expect(classifyMove(0.001, { alreadyLost: true })).toBe("already-lost");
  });

  it("never cites an illegal engine move and leaves Maia without visible coaching copy or label", () => {
    const before = createInitialGame();
    const after = applyMove(before, { from: "e2", to: "e4" });
    const invalidPv = analyzeTurn(
      before,
      after,
      line({ kind: "centipawns", value: 100 }, ["a1a1"]),
      line({ kind: "centipawns", value: -200 }, ["e7e5"]),
    );
    expect(invalidPv.evidence.bestMove).toBeUndefined();
    expect(invalidPv.copy?.text).not.toContain("a1");

    const maia = analyzeTurn(
      before,
      after,
      line({ kind: "centipawns", value: 10 }, ["e2e4"]),
      line({ kind: "centipawns", value: 5 }, ["e7e5"]),
      { actor: "maia" },
    );
    expect(maia.assessment).toBeUndefined();
    expect(maia.copy).toBeUndefined();
    expect(maia.hints).toEqual([]);
  });

  it("keeps the requested analysis perspective when it differs from Maia's side to move", () => {
    const before = applyMove(createInitialGame(), { from: "e2", to: "e4" });
    const after = applyMove(before, { from: "e7", to: "e5" });
    const maia = analyzeTurn(
      before,
      after,
      line({ kind: "centipawns", value: 10 }, ["e7e5"]),
      line({ kind: "centipawns", value: 5 }, ["g1f3"]),
      { actor: "maia", perspective: "white" },
    );
    const user = analyzeTurn(
      before,
      after,
      line({ kind: "centipawns", value: 10 }, ["e7e5"]),
      line({ kind: "centipawns", value: 5 }, ["g1f3"]),
      { perspective: "white" },
    );

    expect(before.turn).toBe("black");
    expect(maia.turn.perspective).toBe("white");
    expect(maia.evidence.perspective).toBe("white");
    expect(user.assessment?.calibration.perspective).toBe("white");
  });

  it("selects warm copy templates deterministically and varies them across turn context", () => {
    const first = createInitialGame();
    const e4 = applyMove(first, { from: "e2", to: "e4" });
    const d4 = applyMove(first, { from: "d2", to: "d4" });
    const e5 = applyMove(e4, { from: "e7", to: "e5" });
    const e4Record = analyzeTurn(
      first,
      e4,
      line({ kind: "centipawns", value: 10 }, ["e2e4"]),
      line({ kind: "centipawns", value: -80 }, ["e7e5"]),
    );
    const repeat = analyzeTurn(
      first,
      e4,
      line({ kind: "centipawns", value: 10 }, ["e2e4"]),
      line({ kind: "centipawns", value: -80 }, ["e7e5"]),
    );
    const variants = [
      e4Record,
      analyzeTurn(
        first,
        d4,
        line({ kind: "centipawns", value: 10 }, ["d2d4"]),
        line({ kind: "centipawns", value: -80 }, ["d7d5"]),
      ),
      analyzeTurn(
        e4,
        e5,
        line({ kind: "centipawns", value: 10 }, ["e7e5"]),
        line({ kind: "centipawns", value: -80 }, ["g1f3"]),
      ),
    ];

    expect(e4Record.copy).toEqual(repeat.copy);
    expect(
      new Set(variants.map((record) => record.copy?.templateId)).size,
    ).toBeGreaterThan(1);
    expect(
      new Set(variants.map((record) => record.copy?.text)).size,
    ).toBeGreaterThan(1);
    variants.forEach((record) => {
      expect(
        record.copy?.text.split(/[.!?](?:\s|$)/).filter(Boolean).length,
      ).toBeGreaterThanOrEqual(2);
      expect(
        record.copy?.text.split(/[.!?](?:\s|$)/).filter(Boolean).length,
      ).toBeLessThanOrEqual(3);
    });
  });

  it("keeps the legacy adapter usable while exposing the complete record", () => {
    const before = createInitialGame();
    const after = applyMove(before, { from: "e2", to: "e4" });
    const feedback = analyzeMove(
      before,
      after,
      line({ kind: "centipawns", value: 10 }, ["e2e4"]),
      line({ kind: "centipawns", value: -80 }, ["e7e5"]),
    );

    expect(feedback.evidence.playedUci).toBe("e2e4");
    expect(feedback.record.schemaVersion).toBe(2);
    expect(hintForLevel(feedback, 1, "guided")).toBe(feedback.hints[1]);
    expect(hintForLevel(feedback, 3, "none")).toBeUndefined();
  });
});
