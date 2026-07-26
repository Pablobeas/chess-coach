import { describe, expect, it } from "vitest";
import {
  applyMove,
  createInitialGame,
  loadPosition,
  type GameSession,
} from "@chess-coach/chess-core";
import {
  analyzeTurn,
  type CoachTurnRecordV3,
  type EngineLine,
} from "@chess-coach/coach";

const cp = (value: number): EngineLine["score"] => ({
  kind: "centipawns",
  value,
});

const mate = (moves: number): EngineLine["score"] => ({
  kind: "mate",
  moves,
});

function line(
  score: EngineLine["score"],
  moves: readonly string[],
  rank = 1,
  wdl?: EngineLine["wdl"],
): EngineLine {
  return { rank, score, moves, ...(wdl ? { wdl } : {}) };
}

function play(before: GameSession, uci: string): GameSession {
  return applyMove(before, {
    from: uci.slice(0, 2),
    to: uci.slice(2, 4),
    ...(uci.length === 5 ? { promotion: uci[4] as "q" | "r" | "b" | "n" } : {}),
  });
}

function recordFor(
  fen: string,
  playedUci: string,
  bestMoves: readonly string[],
  replyMoves: readonly string[],
  beforeScore: EngineLine["score"] = cp(100),
  afterScore: EngineLine["score"] = cp(-100),
  options: Parameters<typeof analyzeTurn>[4] = {},
): CoachTurnRecordV3 {
  const before = loadPosition(fen);
  const after = play(before, playedUci);
  return analyzeTurn(
    before,
    after,
    line(beforeScore, bestMoves),
    line(afterScore, replyMoves),
    options,
  ) as CoachTurnRecordV3;
}

function visibleText(record: CoachTurnRecordV3): string {
  return [
    record.presentation?.summary,
    record.presentation?.detail,
    record.copy?.text,
  ]
    .filter((text): text is string => text !== undefined)
    .join(" ");
}

describe("contextual feedback v3 semantic evaluations", () => {
  it("does not penalize a legal equivalent MultiPV alternative", () => {
    const before = createInitialGame();
    const after = play(before, "e2e4");
    const record = analyzeTurn(
      before,
      after,
      line(cp(20), ["e2e4"]),
      line(cp(10), ["e7e5"]),
      {
        beforeLines: [line(cp(20), ["e2e4"]), line(cp(22), ["d2d4"], 2)],
      },
    ) as CoachTurnRecordV3;

    expect(record.schemaVersion).toBe(3);
    expect(record.assessment?.context.equivalent).toBe(true);
    expect(record.explanation?.mode).toBe("equivalent");
    expect(record.explanation?.primaryReason.kind).toBe("unidentified");
    expect(record.assessment?.label).not.toBe("mistake");
    expect(record.assessment?.label).not.toBe("blunder");
  });

  it("identifies an undefended piece only with a legal capture and a material drop", () => {
    const record = recordFor(
      "6k1/5ppp/2p5/8/8/2N5/5P2/6K1 w - - 0 1",
      "c3b5",
      ["f2f3"],
      ["c6b5"],
      cp(120),
      cp(-180),
    );

    expect(record.explanation?.mode).toBe("explained");
    expect(record.explanation?.primaryReason.kind).toBe(
      "left-piece-undefended",
    );
    expect(record.explanation?.primaryReason.confidence).toBe("high");
    expect(record.explanation?.consequence.kind).toBe("material-loss");
    expect(record.explanation?.supportingVariation[0]?.uci).toBe("f2f3");
  });

  it("reports an ignored check as a threat, without inventing a capture", () => {
    const record = recordFor(
      "3q2k1/8/8/8/8/8/4P3/4K3 w - - 0 1",
      "e2e3",
      ["e2e4"],
      ["d8h4"],
      cp(120),
      cp(-160),
    );

    expect(record.explanation?.mode).toBe("explained");
    expect(record.explanation?.primaryReason.kind).toBe("ignored-threat");
    expect(record.explanation?.consequence.kind).toBe("forcing-attack");
    expect(record.explanation?.supportingVariation[0]?.uci).toBe("e2e4");
  });

  it("keeps a forced mate as the highest-priority reason", () => {
    const record = recordFor(
      "7k/5Q2/6K1/8/8/8/8/8 w - - 0 1",
      "f7e7",
      ["f7f8"],
      [],
      mate(1),
      mate(-1),
    );

    expect(record.explanation?.mode).toBe("explained");
    expect(record.explanation?.primaryReason.kind).toBe("allowed-mate");
    expect(record.explanation?.consequence.kind).toBe("mate");
    expect(record.explanation?.bestMovePurposes).toContain("avoids-mate");
  });

  it("uses only evidenced development and castling purposes", () => {
    const development = recordFor(
      "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
      "e2e4",
      ["g1f3"],
      ["e7e5"],
      cp(120),
      cp(-80),
    );
    expect(development.explanation?.primaryReason.kind).toBe(
      "slow-development",
    );
    expect(development.explanation?.bestMovePurposes).toContain(
      "develops-piece",
    );

    const castling = recordFor(
      "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1",
      "e1f1",
      ["e1g1"],
      ["a8a7"],
      cp(120),
      cp(-100),
    );
    expect(castling.explanation?.primaryReason.kind).toBe(
      "lost-castling-right",
    );
    expect(castling.explanation?.bestMovePurposes).toContain("castles");
  });

  it("falls back to a recommendation at low confidence", () => {
    const record = recordFor(
      "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
      "e2e4",
      ["d2d4"],
      ["e7e5"],
      cp(20),
      cp(10),
    );

    expect(record.explanation?.mode).toBe("recommendation-only");
    expect(record.explanation?.primaryReason.kind).toBe("unidentified");
    expect(record.explanation?.primaryReason.confidence).toBe("low");
    expect(record.explanation?.primaryReason.factRefs).toEqual([]);
  });

  it("keeps summary and detail distinct and avoids internal engine vocabulary", () => {
    const record = recordFor(
      "6k1/5ppp/2p5/8/8/2N5/5P2/6K1 w - - 0 1",
      "c3b5",
      ["f2f3"],
      ["c6b5"],
    );
    const text = visibleText(record);
    expect(record.presentation?.summary).not.toBe(record.presentation?.detail);
    expect(text).not.toMatch(/PV|centipe?ón|depth|multipv|confianza/i);
    expect(text).not.toContain("primera de la");
  });

  it("is deterministic and remains within a local synchronous budget", () => {
    const input = [
      "6k1/5ppp/2p5/8/8/2N5/5P2/6K1 w - - 0 1",
      "c3b5",
      ["f2f3"],
      ["c6b5"],
    ] as const;
    const first = recordFor(...input);
    const second = recordFor(...input);
    expect(second).toEqual(first);
    const start = performance.now();
    for (let index = 0; index < 20; index += 1) recordFor(...input);
    expect(performance.now() - start).toBeLessThan(1_000);
  });
});
