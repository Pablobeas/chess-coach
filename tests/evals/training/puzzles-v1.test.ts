import { describe, expect, it } from "vitest";
import {
  applyUciMove,
  loadPosition,
  replayUciLine,
} from "@chess-coach/chess-core";
import { PUZZLES_V1 } from "@chess-coach/coach";
import {
  createPuzzleSessionV1,
  submitPuzzleMoveV1,
  validatePuzzleV1,
  type PuzzleBranchV1,
} from "@chess-coach/coach";

function flatten(
  branches: readonly PuzzleBranchV1[],
  out: string[] = [],
): string[] {
  const branch = branches[0];
  if (!branch) return out;
  out.push(branch.userMove);
  if (branch.reply) out.push(branch.reply);
  return branch.next ? flatten(branch.next, out) : out;
}

describe("PUZZLES_V1 reproducible verifier", () => {
  it("accepts every curated puzzle only when every PV edge is legal and has 2+ decisions", () => {
    const report = PUZZLES_V1.map((puzzle) => {
      const valid = validatePuzzleV1(puzzle);
      const moves = flatten(valid.solution);
      const replay = replayUciLine(valid.fen, moves);
      return {
        id: valid.id,
        legal: replay.history.length === moves.length,
        decisions:
          valid.solution.length + (valid.solution[0]?.next?.length ? 1 : 0),
        verification: valid.verification,
      };
    });
    console.info("PUZZLES_V1 verification report", JSON.stringify(report));
    expect(report.every((item) => item.legal && item.decisions >= 2)).toBe(
      true,
    );
    expect(report.map((item) => item.id)).toEqual([
      "bishop-corridor-mate",
      "bishop-queen-corridor-mate",
      "queen-rook-mate",
      "knight-queen-corridor-mate",
    ]);
  });

  it("records engine provenance without treating unverified metadata as proof", () => {
    for (const puzzle of PUZZLES_V1) {
      expect(puzzle.verification.engine).toBe("stockfish");
      expect(puzzle.verification.source.length).toBeGreaterThan(0);
      if (puzzle.verification.status === "verified") {
        expect(puzzle.verification.analysis?.version).toBeTruthy();
        expect(puzzle.verification.analysis?.verifiedOn).toMatch(/^2026-/);
        expect(puzzle.verification.analysis?.license).toBe("GPL-3.0");
        expect(puzzle.verification.analysis?.jsSha256).toMatch(
          /^[A-F0-9]{64}$/,
        );
        expect(puzzle.verification.analysis?.wasmSha256).toMatch(
          /^[A-F0-9]{64}$/,
        );
        expect(
          puzzle.verification.analysis?.budget.hashMegabytes,
        ).toBeGreaterThan(0);
        expect(
          puzzle.verification.analysis?.budget.userMoveNodes,
        ).toBeGreaterThan(0);
        expect(
          puzzle.verification.analysis?.budget.replyMoveNodes,
        ).toBeGreaterThan(0);
        expect(
          puzzle.verification.analysis?.budget.userMoveMultiPvLimit,
        ).toBeGreaterThan(0);
      }
    }
  });

  it("supports incorrect, progressive hint, alternative/solution and terminal replay invariants", () => {
    const puzzle = PUZZLES_V1[0]!;
    let session = createPuzzleSessionV1(puzzle);
    const illegal = () => applyUciMove(loadPosition(session.fen), "a1a1");
    expect(illegal).toThrow();
    const wrong = submitPuzzleMoveV1(session, "g2g3");
    expect(wrong.kind).toBe("incorrect");
    if (wrong.kind === "incorrect") session = wrong.session;
    expect(session.failedAttempts).toBe(1);
    expect(session.userMoves).toHaveLength(0);
    const hint = submitPuzzleMoveV1(session, "h5f7");
    expect(hint.kind).toBe("accepted");
    if (hint.kind === "accepted") {
      expect(hint.session.userMoves).toEqual(["h5f7"]);
      expect(hint.automaticReply).toBe("g8h8");
      session = hint.session;
    }
    expect(session.fen).not.toBe(puzzle.fen);
  });
});
