import type { MoveFeedbackRecord } from "./persistence";
import {
  createFinalLineSnapshotV1,
  decodeFinalLineSnapshotV1,
  decodePostgamePositionEvidenceV1,
  POSTGAME_PHASE_POLICY,
  POSTGAME_SCORING_POLICY,
  summarizeCheckmateGame,
  type FinalLineSnapshotV1,
  type PostgameActor,
  type PostgamePositionEvidenceV1,
  type PostgameSummaryV1,
} from "@chess-coach/coach";
import type { GameSession, PlayerColor } from "@chess-coach/chess-core";
import type { EngineLine } from "@chess-coach/engine";

export const POSTGAME_REVIEW_SCHEMA_VERSION = 1 as const;

export interface PostgameReviewProgressV1 {
  readonly completed: number;
  readonly total: number;
}

export interface PostgameReviewStateV1 {
  readonly schemaVersion: typeof POSTGAME_REVIEW_SCHEMA_VERSION;
  readonly reviewId: string;
  readonly snapshot: FinalLineSnapshotV1;
  readonly evidence: readonly PostgamePositionEvidenceV1[];
  readonly summary: PostgameSummaryV1;
  readonly status: "partial" | "ready" | "unavailable";
  readonly progress: PostgameReviewProgressV1;
  readonly policies: Readonly<{
    phases: typeof POSTGAME_PHASE_POLICY;
    scoring: typeof POSTGAME_SCORING_POLICY;
  }>;
}

export interface PostgameReviewTask {
  readonly reviewId: string;
  readonly moveIndex: number;
  readonly color: PlayerColor;
  readonly actor: PostgameActor;
  readonly beforeFen: string;
  readonly afterFen: string;
  readonly priority: "normal" | "low";
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function freeze<T>(value: T): T {
  if (Array.isArray(value)) {
    for (const item of value) freeze(item);
  } else if (isRecord(value)) {
    for (const item of Object.values(value)) freeze(item);
  }
  return Object.freeze(value);
}

function postgameActors(
  playerColor: PlayerColor,
): Readonly<Record<PlayerColor, PostgameActor>> {
  return freeze({
    white: playerColor === "white" ? "user" : "maia",
    black: playerColor === "black" ? "user" : "maia",
  });
}

function createReviewId(lineId: string, snapshot: FinalLineSnapshotV1): string {
  const tail = snapshot.moves.at(-1);
  return [
    "postgame",
    lineId,
    snapshot.winner,
    snapshot.moves.length,
    tail?.uci ?? "none",
    snapshot.terminalFen,
  ].join(":");
}

function moveLineFromRecord(
  entry: MoveFeedbackRecord,
  moveIndex: number,
  color: PlayerColor,
): PostgamePositionEvidenceV1 | undefined {
  const record = entry.record;
  if (!record || record.schemaVersion !== 3) return undefined;
  if (record.turn.ply !== moveIndex + 1) return undefined;
  if (
    record.turn.beforeFen !== entry.beforeFen ||
    record.turn.afterFen !== entry.afterFen
  )
    return undefined;
  if (record.turn.perspective !== color || record.turn.actor !== "user")
    return undefined;
  return freeze({
    schemaVersion: 1,
    moveIndex,
    beforeFen: record.turn.beforeFen,
    afterFen: record.turn.afterFen,
    perspective: record.turn.perspective,
    bestLine: record.evidence.before,
    playedLine: record.evidence.after,
  });
}

function sameEvidence(
  left: PostgamePositionEvidenceV1,
  right: PostgamePositionEvidenceV1,
): boolean {
  return (
    left.moveIndex === right.moveIndex &&
    left.beforeFen === right.beforeFen &&
    left.afterFen === right.afterFen &&
    left.perspective === right.perspective
  );
}

function acceptedEvidence(
  snapshot: FinalLineSnapshotV1,
  evidence: readonly unknown[],
): readonly PostgamePositionEvidenceV1[] {
  const deduped = new Map<number, PostgamePositionEvidenceV1>();
  for (const item of evidence) {
    const decoded = decodePostgamePositionEvidenceV1(item);
    if (!decoded) continue;
    const move = snapshot.moves[decoded.moveIndex];
    if (
      !move ||
      decoded.beforeFen !== move.beforeFen ||
      decoded.afterFen !== move.afterFen ||
      decoded.perspective !== move.color ||
      deduped.has(decoded.moveIndex)
    )
      continue;
    deduped.set(decoded.moveIndex, decoded);
  }
  return freeze(
    [...deduped.values()].sort(
      (left, right) => left.moveIndex - right.moveIndex,
    ),
  );
}

function createState(
  reviewId: string,
  snapshot: FinalLineSnapshotV1,
  evidence: readonly PostgamePositionEvidenceV1[],
  status: "partial" | "ready" | "unavailable",
): PostgameReviewStateV1 {
  const summary = summarizeCheckmateGame(snapshot, evidence);
  const completed = evidence.length;
  const total = snapshot.moves.length;
  const normalizedStatus =
    completed === total ? "ready" : status === "ready" ? "partial" : status;
  return freeze({
    schemaVersion: 1,
    reviewId,
    snapshot,
    evidence,
    summary,
    status: normalizedStatus,
    progress: { completed, total },
    policies: {
      phases: POSTGAME_PHASE_POLICY,
      scoring: POSTGAME_SCORING_POLICY,
    },
  });
}

export function createPostgameReviewStateV1(args: {
  readonly session: GameSession;
  readonly lineId: string;
  readonly playerColor: PlayerColor;
  readonly feedbackByPly: readonly MoveFeedbackRecord[];
}): PostgameReviewStateV1 {
  const snapshot = createFinalLineSnapshotV1(
    args.session,
    postgameActors(args.playerColor),
  );
  const seeded = acceptedEvidence(
    snapshot,
    snapshot.moves.flatMap((move) => {
      const feedback = args.feedbackByPly.find(
        (entry) =>
          entry.historyIndex === move.index &&
          entry.uci === move.uci &&
          entry.actor === move.actor &&
          entry.beforeFen === move.beforeFen &&
          entry.afterFen === move.afterFen &&
          entry.status === "ready",
      );
      if (!feedback) return [];
      const evidence = moveLineFromRecord(feedback, move.index, move.color);
      return evidence ? [evidence] : [];
    }),
  );
  return createState(
    createReviewId(args.lineId, snapshot),
    snapshot,
    seeded,
    seeded.length === snapshot.moves.length ? "ready" : "partial",
  );
}

export function decodePostgameReviewStateV1(
  value: unknown,
): PostgameReviewStateV1 | undefined {
  if (
    !isRecord(value) ||
    value.schemaVersion !== POSTGAME_REVIEW_SCHEMA_VERSION ||
    typeof value.reviewId !== "string" ||
    !["partial", "ready", "unavailable"].includes(String(value.status)) ||
    !isRecord(value.policies) ||
    value.policies.phases !== POSTGAME_PHASE_POLICY ||
    value.policies.scoring !== POSTGAME_SCORING_POLICY ||
    !isRecord(value.progress) ||
    !Number.isInteger(value.progress.completed) ||
    !Number.isInteger(value.progress.total) ||
    !isRecord(value.summary)
  )
    return undefined;
  const snapshot = decodeFinalLineSnapshotV1(value.snapshot);
  if (!snapshot) return undefined;
  const evidence = acceptedEvidence(
    snapshot,
    Array.isArray(value.evidence) ? value.evidence : [],
  );
  const normalized = createState(
    value.reviewId,
    snapshot,
    evidence,
    value.status as "partial" | "ready" | "unavailable",
  );
  if (
    normalized.progress.completed !== value.progress.completed ||
    normalized.progress.total !== value.progress.total
  )
    return undefined;
  return normalized;
}

export function listPostgameReviewTasks(
  review: PostgameReviewStateV1,
): readonly PostgameReviewTask[] {
  const covered = new Set(review.evidence.map((item) => item.moveIndex));
  return freeze(
    review.snapshot.moves
      .filter((move) => !covered.has(move.index))
      .map((move): PostgameReviewTask =>
        freeze({
          reviewId: review.reviewId,
          moveIndex: move.index,
          color: move.color,
          actor: move.actor,
          beforeFen: move.beforeFen,
          afterFen: move.afterFen,
          priority: move.actor === "user" ? "normal" : "low",
        }),
      )
      .sort((left, right) =>
        left.priority === right.priority
          ? left.moveIndex - right.moveIndex
          : left.priority === "normal"
            ? -1
            : 1,
      ),
  );
}

export function mergePostgameReviewEvidence(
  review: PostgameReviewStateV1,
  evidence: PostgamePositionEvidenceV1,
): PostgameReviewStateV1 {
  const move = review.snapshot.moves[evidence.moveIndex];
  if (
    !move ||
    evidence.beforeFen !== move.beforeFen ||
    evidence.afterFen !== move.afterFen ||
    evidence.perspective !== move.color
  )
    return review;
  const existing = review.evidence.find(
    (item) => item.moveIndex === evidence.moveIndex,
  );
  if (existing && sameEvidence(existing, evidence)) return review;
  if (existing) return review;
  return createState(
    review.reviewId,
    review.snapshot,
    freeze(
      [...review.evidence, evidence].sort(
        (left, right) => left.moveIndex - right.moveIndex,
      ),
    ),
    review.status === "unavailable" ? "unavailable" : "partial",
  );
}

export function seedPostgameReviewFromFeedback(
  review: PostgameReviewStateV1,
  feedbackByPly: readonly MoveFeedbackRecord[],
): PostgameReviewStateV1 {
  let next = review;
  for (const move of review.snapshot.moves) {
    const feedback = feedbackByPly.find(
      (entry) =>
        entry.historyIndex === move.index &&
        entry.uci === move.uci &&
        entry.actor === move.actor &&
        entry.beforeFen === move.beforeFen &&
        entry.afterFen === move.afterFen &&
        entry.status === "ready",
    );
    if (!feedback) continue;
    const evidence = moveLineFromRecord(feedback, move.index, move.color);
    if (!evidence) continue;
    next = mergePostgameReviewEvidence(next, evidence);
  }
  return next;
}

export function markPostgameReviewUnavailable(
  review: PostgameReviewStateV1,
): PostgameReviewStateV1 {
  return review.status === "unavailable"
    ? review
    : createState(
        review.reviewId,
        review.snapshot,
        review.evidence,
        "unavailable",
      );
}

export function isPostgameReviewPendingForMove(
  review: PostgameReviewStateV1,
  feedbackByPly: readonly MoveFeedbackRecord[],
  moveIndex: number,
): boolean {
  const move = review.snapshot.moves[moveIndex];
  if (!move) return false;
  return feedbackByPly.some(
    (entry) =>
      entry.historyIndex === move.index &&
      entry.uci === move.uci &&
      entry.actor === move.actor &&
      entry.beforeFen === move.beforeFen &&
      entry.afterFen === move.afterFen &&
      entry.status === "pending",
  );
}

export function postgameEvidenceFromAnalysis(args: {
  readonly review: PostgameReviewStateV1;
  readonly moveIndex: number;
  readonly bestLine: EngineLine;
  readonly playedLine: EngineLine;
}): PostgamePositionEvidenceV1 | undefined {
  const move = args.review.snapshot.moves[args.moveIndex];
  if (!move) return undefined;
  return freeze({
    schemaVersion: 1,
    moveIndex: move.index,
    beforeFen: move.beforeFen,
    afterFen: move.afterFen,
    perspective: move.color,
    bestLine: args.bestLine,
    playedLine: args.playedLine,
  });
}
