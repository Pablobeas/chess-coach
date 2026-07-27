import { describe, expect, it } from "vitest";
import { applyUciMove, createInitialGame } from "@chess-coach/chess-core";
import {
  ITALIAN_OPENING_COURSE_V1,
  PUZZLES_V1,
} from "../training-content/mvp.js";
import { openingPeriodForSession } from "../postgame.js";
import {
  OPENING_SAFETY_POLICY_V1,
  assessOpeningCandidateV1,
  chooseOpeningReplyV1,
  matchOpeningPositionV1,
  validateOpeningCourseV1,
} from "./openings.js";
import {
  createPuzzleSessionV1,
  revealPuzzleHintV1,
  submitPuzzleMoveV1,
  validatePuzzleV1,
} from "./puzzles.js";

const line = (value: number, moves = ["e2e4"]) => ({
  rank: 1,
  score: { kind: "centipawns" as const, value },
  moves,
});

describe("training v1", () => {
  it("validates the curated legal puzzle graph and keeps hints progressive", () => {
    expect(PUZZLES_V1).toHaveLength(4);
    PUZZLES_V1.forEach((puzzle) =>
      expect(validatePuzzleV1(puzzle)).toBe(puzzle),
    );
    PUZZLES_V1.forEach((puzzle) => {
      expect(puzzle.theme).toBe("mate");
      expect(puzzle.verification).toMatchObject({
        engine: "stockfish",
        status: "verified",
        analysis: {
          version: "Stockfish 18 Lite WASM (Stockfish 18; package 18.0.8)",
          verifiedOn: "2026-07-27",
          license: "GPL-3.0",
          budget: {
            hashMegabytes: 16,
            userMoveNodes: 50_000,
            replyMoveNodes: 50_000,
            userMoveMultiPvLimit: 4,
            materialAdvantageCentipawns: 150,
            policy: {
              userMoveMustMatch: "engine-best-line-in-node",
              replyMoveMustMatch: "engine-best-defense-in-child-node",
              objectiveValidation:
                "terminal mate requires checkmate; material requires positive engine or material proof",
            },
          },
        },
      });
    });
    const puzzle = PUZZLES_V1[0]!;
    let session = createPuzzleSessionV1(puzzle);
    const wrong = submitPuzzleMoveV1(session, "g1h1");
    expect(wrong.kind).toBe("incorrect");
    if (wrong.kind === "incorrect") session = wrong.session;
    const hint = revealPuzzleHintV1(session);
    expect(hint.session.revealedHintLevel).toBe(1);
    expect(hint.hint).not.toContain("h5f7");
    const first = submitPuzzleMoveV1(session, "h5f7");
    expect(first.kind).toBe("accepted");
    if (first.kind === "accepted") expect(first.automaticReply).toBe("g8h8");
  });

  it("rejects malformed puzzle continuations", () => {
    const malformed = {
      ...structuredClone(PUZZLES_V1[0]!),
      solution: [{ userMove: "h5f7" }],
    };
    expect(() => validatePuzzleV1(malformed)).toThrow(/two user decisions/);
  });

  it("recognizes opening membership independently from objective quality and a real transposition", () => {
    expect(validateOpeningCourseV1(ITALIAN_OPENING_COURSE_V1)).toBe(
      ITALIAN_OPENING_COURSE_V1,
    );
    let session = createInitialGame();
    for (const move of ["e2e4", "e7e5", "g1f3", "b8c6", "f1c4", "g8f6", "d2d3"])
      session = applyUciMove(session, move);
    const match = matchOpeningPositionV1(
      ITALIAN_OPENING_COURSE_V1,
      session.fen,
      "f8c5",
      { status: "safe", reason: "injected test evidence" },
    );
    expect(match.kind).toBe("transposition");
    expect(match.objectiveQuality?.status).toBe("safe");
  });

  it("uses only injected engine evidence and falls back strongly when repertoire moves are unsafe", () => {
    const fen = applyUciMove(createInitialGame(), "e2e4").fen;
    const rejected = assessOpeningCandidateV1(fen, line(100, ["e7e5"]), {
      move: "e7e5",
      line: line(-100, ["e7e5"]),
    });
    expect(rejected).toMatchObject({
      allowed: false,
      reason: "outside-margin",
    });
    const reply = chooseOpeningReplyV1(
      ITALIAN_OPENING_COURSE_V1,
      applyUciMove(createInitialGame(), "e2e4").fen,
      {
        best: line(100, ["e7e5"]),
        candidates: [{ move: "e7e5", line: line(-100, ["e7e5"]) }],
        engineBestMove: "c7c5",
      },
    );
    expect(reply).toMatchObject({ source: "engine-fallback", move: "c7c5" });
    expect(OPENING_SAFETY_POLICY_V1.maximumCentipawnGap).toBe(75);
  });

  it("rejects untrusted engine PVs that do not prove their advertised candidate", () => {
    const fen = applyUciMove(createInitialGame(), "e2e4").fen;
    const mismatch = assessOpeningCandidateV1(fen, line(20, ["e7e5"]), {
      move: "e7e5",
      line: { ...line(20, ["c7c5"]), moves: ["c7c5"] },
    });
    expect(mismatch).toMatchObject({
      allowed: false,
      reason: "evidence-mismatch",
    });
  });

  it("refuses an illegal engine fallback instead of returning it as a move", () => {
    const fen = applyUciMove(createInitialGame(), "e2e4").fen;
    expect(() =>
      chooseOpeningReplyV1(ITALIAN_OPENING_COURSE_V1, fen, {
        best: line(20, ["e7e5"]),
        candidates: [],
        engineBestMove: "a1a1",
      }),
    ).toThrow(/fallback/i);
  });

  it("reuses the post-game event phase policy for an active opening session", () => {
    let session = createInitialGame();
    for (const move of ["e2e4", "e7e5", "g1f3", "b8c6", "f1c4", "f8c5", "d2d3"])
      session = applyUciMove(session, move);
    expect(openingPeriodForSession(session)).toEqual([
      "opening",
      "opening",
      "opening",
      "opening",
      "opening",
      "opening",
      "middlegame",
    ]);
  });
});
