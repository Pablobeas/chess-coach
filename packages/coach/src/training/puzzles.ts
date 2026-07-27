import {
  applyUciMove,
  loadPosition,
  replayUciLine,
  type PlayerColor,
} from "@chess-coach/chess-core";

export type PuzzleThemeV1 =
  "mate" | "fork" | "pin" | "skewer" | "deflection" | "material";

export interface PuzzleEngineVerificationV1 {
  readonly engine: "stockfish";
  /** Provenance is deliberately explicit: bundled data is not a runtime claim. */
  readonly status: "verified" | "unverified";
  readonly source: string;
  readonly analysis?: {
    readonly version: string;
    readonly verifiedOn: string;
    readonly license: "GPL-3.0";
    readonly jsSha256: string;
    readonly wasmSha256: string;
    readonly budget: {
      readonly hashMegabytes: number;
      readonly userMoveNodes: number;
      readonly replyMoveNodes: number;
      readonly userMoveMultiPvLimit: number;
      readonly materialAdvantageCentipawns: number;
      readonly policy: {
        readonly userMoveMustMatch: string;
        readonly replyMoveMustMatch: string;
        readonly objectiveValidation: string;
      };
    };
  };
}

export interface PuzzleBranchV1 {
  readonly userMove: string;
  readonly reply?: string;
  readonly next?: readonly PuzzleBranchV1[];
}

export interface PuzzleV1 {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly fen: string;
  readonly sideToMove: PlayerColor;
  readonly theme: PuzzleThemeV1;
  readonly difficulty: "beginner" | "intermediate" | "advanced";
  readonly objective: string;
  readonly solution: readonly PuzzleBranchV1[];
  readonly explanation: string;
  readonly resultingAdvantage: string;
  readonly verification: PuzzleEngineVerificationV1;
  readonly hints: readonly [string, string, string, string];
}

export type PuzzleSubmissionV1 =
  | {
      readonly kind: "accepted";
      readonly acceptedAs: "main" | "valid-alternative";
      readonly session: PuzzleSessionV1;
      readonly automaticReply?: string;
    }
  | {
      readonly kind: "incorrect";
      readonly session: PuzzleSessionV1;
      readonly message: string;
    };

export interface PuzzleSessionV1 {
  readonly puzzle: PuzzleV1;
  readonly fen: string;
  readonly branches: readonly PuzzleBranchV1[];
  readonly userMoves: readonly string[];
  readonly automaticReplies: readonly string[];
  readonly failedAttempts: number;
  readonly revealedHintLevel: 0 | 1 | 2 | 3 | 4;
  readonly status: "active" | "solved" | "solution-revealed";
}

export interface PuzzleSummaryV1 {
  readonly status: PuzzleSessionV1["status"];
  readonly theme: PuzzleThemeV1;
  readonly objective: string;
  readonly attempts: number;
  readonly userMoves: readonly string[];
  readonly automaticReplies: readonly string[];
  readonly explanation: string;
  readonly resultingAdvantage: string;
}

const freeze = <T>(value: T): T => Object.freeze(value);

function colorAt(fen: string): PlayerColor {
  return loadPosition(fen).turn;
}

function validateBranch(
  fen: string,
  branch: PuzzleBranchV1,
  user: PlayerColor,
): void {
  if (colorAt(fen) !== user)
    throw new RangeError("Puzzle user move has the wrong side to move");
  const afterUser = applyUciMove(loadPosition(fen), branch.userMove);
  if (branch.reply === undefined) {
    if (branch.next !== undefined && branch.next.length > 0)
      throw new RangeError("A puzzle continuation requires an opponent reply");
    return;
  }
  const afterReply = applyUciMove(afterUser, branch.reply);
  if (branch.next === undefined || branch.next.length === 0)
    throw new RangeError("A non-terminal puzzle reply requires a continuation");
  branch.next.forEach((next) => validateBranch(afterReply.fen, next, user));
}

/** Validates all legal edges, turn ownership, and at least two user decisions. */
export function validatePuzzleV1(value: PuzzleV1): PuzzleV1 {
  if (value.schemaVersion !== 1 || !/^[a-z0-9-]+$/.test(value.id))
    throw new RangeError("Puzzle requires a stable v1 id");
  if (value.solution.length === 0 || value.hints.length !== 4)
    throw new RangeError(
      "Puzzle requires a solution and four progressive hints",
    );
  if (colorAt(value.fen) !== value.sideToMove)
    throw new RangeError("Puzzle sideToMove does not match FEN");
  value.solution.forEach((branch) =>
    validateBranch(value.fen, branch, value.sideToMove),
  );
  const decisionCount = (branches: readonly PuzzleBranchV1[]): number =>
    1 +
    Math.max(
      0,
      ...branches.map((branch) =>
        branch.next === undefined ? 0 : decisionCount(branch.next),
      ),
    );
  if (decisionCount(value.solution) < 2)
    throw new RangeError("Puzzle requires at least two user decisions");
  return freeze(value);
}

export function createPuzzleSessionV1(puzzle: PuzzleV1): PuzzleSessionV1 {
  const valid = validatePuzzleV1(puzzle);
  return freeze({
    puzzle: valid,
    fen: valid.fen,
    branches: valid.solution,
    userMoves: freeze([]),
    automaticReplies: freeze([]),
    failedAttempts: 0,
    revealedHintLevel: 0,
    status: "active",
  });
}

export function submitPuzzleMoveV1(
  session: PuzzleSessionV1,
  uci: string,
): PuzzleSubmissionV1 {
  if (session.status !== "active")
    throw new RangeError("Puzzle session is no longer active");
  const branch = session.branches.find(
    (candidate) => candidate.userMove === uci,
  );
  if (branch === undefined) {
    // Validate syntax and legality so callers cannot record impossible attempts.
    applyUciMove(loadPosition(session.fen), uci);
    const next = freeze({
      ...session,
      failedAttempts: session.failedAttempts + 1,
    });
    return freeze({
      kind: "incorrect",
      session: next,
      message:
        "Esa jugada no fuerza el objetivo del ejercicio. Inténtalo de nuevo desde esta posición.",
    });
  }
  let position = applyUciMove(loadPosition(session.fen), uci);
  const reply = branch.reply;
  if (reply !== undefined) position = applyUciMove(position, reply);
  const solved = branch.next === undefined;
  const next = freeze({
    ...session,
    fen: position.fen,
    branches: freeze([...(branch.next ?? [])]),
    userMoves: freeze([...session.userMoves, uci]),
    automaticReplies:
      reply === undefined
        ? session.automaticReplies
        : freeze([...session.automaticReplies, reply]),
    status: solved ? ("solved" as const) : ("active" as const),
  });
  return freeze({
    kind: "accepted",
    acceptedAs:
      session.branches[0]?.userMove === uci ? "main" : "valid-alternative",
    session: next,
    ...(reply === undefined ? {} : { automaticReply: reply }),
  });
}

export function retryPuzzleV1(session: PuzzleSessionV1): PuzzleSessionV1 {
  return createPuzzleSessionV1(session.puzzle);
}

export function revealPuzzleHintV1(session: PuzzleSessionV1): {
  readonly session: PuzzleSessionV1;
  readonly hint: string;
} {
  const nextLevel = Math.min(
    4,
    session.revealedHintLevel + 1,
  ) as PuzzleSessionV1["revealedHintLevel"];
  return freeze({
    session: freeze({ ...session, revealedHintLevel: nextLevel }),
    hint: session.puzzle.hints[nextLevel - 1]!,
  });
}

export function revealPuzzleSolutionV1(
  session: PuzzleSessionV1,
): PuzzleSessionV1 {
  const principal = session.puzzle.solution[0];
  if (principal === undefined) throw new RangeError("Puzzle has no solution");
  const moves: string[] = [];
  let branches: readonly PuzzleBranchV1[] | undefined = [principal];
  while (branches?.[0] !== undefined) {
    const current: PuzzleBranchV1 = branches[0];
    moves.push(current.userMove);
    if (current.reply !== undefined) moves.push(current.reply);
    branches = current.next;
  }
  const replay = replayUciLine(session.puzzle.fen, moves);
  return freeze({
    ...session,
    fen: replay.finalFen,
    status: "solution-revealed",
    revealedHintLevel: 4,
  });
}

export function summarizePuzzleV1(session: PuzzleSessionV1): PuzzleSummaryV1 {
  return freeze({
    status: session.status,
    theme: session.puzzle.theme,
    objective: session.puzzle.objective,
    attempts: session.failedAttempts + session.userMoves.length,
    userMoves: session.userMoves,
    automaticReplies: session.automaticReplies,
    explanation: session.puzzle.explanation,
    resultingAdvantage: session.puzzle.resultingAdvantage,
  });
}
