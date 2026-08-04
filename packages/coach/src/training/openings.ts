import {
  applyUciMove,
  loadPosition,
  positionKeyForFen,
  type PlayerColor,
  type PositionKey,
} from "@chess-coach/chess-core";
import type { EngineLine } from "@chess-coach/engine";

export interface BoardArrowV1 {
  readonly from: string;
  readonly to: string;
}
export interface OpeningMoveV1 {
  readonly uci: string;
  readonly target: PositionKey;
  readonly kind: "main" | "valid-alternative";
}
export interface OpeningNodeV1 {
  readonly positionKey: PositionKey;
  readonly fen: string;
  readonly moves: readonly OpeningMoveV1[];
  readonly strategicIdea: string;
  readonly highlightedSquares: readonly string[];
  readonly arrows: readonly BoardArrowV1[];
  readonly isOpeningEnd?: true;
}
export interface OpeningExplanationStepV1 {
  readonly positionKey: PositionKey;
  readonly title: string;
  readonly description: string;
  /** Optional in persisted v1 content created before linked lesson paths. */
  readonly recommendedMove?: string;
  readonly arrows: readonly BoardArrowV1[];
  readonly highlightedSquares: readonly string[];
  readonly piecesToHighlight: readonly string[];
  readonly futurePlan: string;
}
export interface OpeningCourseV1 {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly name: string;
  readonly eco: string;
  readonly supportedColors: readonly PlayerColor[];
  readonly root: PositionKey;
  /** Optional in persisted v1 content created before linked lesson paths. */
  readonly targetPosition?: PositionKey;
  readonly nodes: readonly OpeningNodeV1[];
  readonly explanationSteps: readonly OpeningExplanationStepV1[];
  readonly description: string;
  readonly generalObjective: string;
}

export type OpeningMatchKindV1 =
  "main" | "valid-alternative" | "transposition" | "outside";
export interface OpeningMatchV1 {
  readonly kind: OpeningMatchKindV1;
  readonly positionKey: PositionKey;
  readonly node?: OpeningNodeV1;
  /** Separately supplied objective evidence; never inferred from repertoire membership. */
  readonly objectiveQuality?: OpeningObjectiveQualityV1;
}
export interface OpeningObjectiveQualityV1 {
  readonly status: "unknown" | "safe" | "unsafe";
  readonly reason: string;
}
export const OPENING_SAFETY_POLICY_V1 = Object.freeze({
  version: "opening-safety-v1",
  maximumCentipawnGap: 75,
  rejectMateRegression: true,
  requireEngineEvidence: true,
} as const);
export interface OpeningCandidateEvidenceV1 {
  readonly move: string;
  readonly line: EngineLine;
}
export interface OpeningCandidateAssessmentV1 {
  readonly move: string;
  readonly allowed: boolean;
  readonly reason:
    | "within-margin"
    | "mate-regression"
    | "outside-margin"
    | "missing-evidence"
    | "evidence-mismatch"
    | "illegal-evidence";
  readonly evidence?: EngineLine;
}
export interface OpeningReplyChoiceV1 {
  readonly move: string;
  readonly source: "opening" | "engine-fallback";
  readonly reason: string;
  readonly assessment?: OpeningCandidateAssessmentV1;
}

const freeze = <T>(value: T): T => Object.freeze(value);
const byKey = (course: OpeningCourseV1) =>
  new Map(course.nodes.map((node) => [node.positionKey, node]));
function score(line: EngineLine): number {
  return line.score.kind === "centipawns"
    ? line.score.value
    : line.score.moves > 0
      ? 100_000
      : line.score.moves < 0
        ? -100_000
        : 0;
}
function legalNext(node: OpeningNodeV1, move: OpeningMoveV1): boolean {
  try {
    return (
      positionKeyForFen(applyUciMove(loadPosition(node.fen), move.uci).fen) ===
      move.target
    );
  } catch {
    return false;
  }
}

function isLegalMoveFromFen(fen: string, uci: string): boolean {
  try {
    applyUciMove(loadPosition(fen), uci);
    return true;
  } catch {
    return false;
  }
}

function isLegalEngineLineFromFen(fen: string, line: EngineLine): boolean {
  if (line.moves.length === 0) return false;
  try {
    let position = loadPosition(fen);
    for (const move of line.moves) position = applyUciMove(position, move);
    return true;
  } catch {
    return false;
  }
}

/** Runtime decoder boundary for JSON/content: legal graph edges and position keys are mandatory. */
export function validateOpeningCourseV1(
  course: OpeningCourseV1,
): OpeningCourseV1 {
  if (
    course.schemaVersion !== 1 ||
    course.nodes.length === 0 ||
    course.supportedColors.length === 0
  )
    throw new RangeError(
      "Opening course requires v1 nodes and a supported color",
    );
  const nodes = byKey(course);
  if (nodes.size !== course.nodes.length || !nodes.has(course.root))
    throw new RangeError("Opening nodes require unique keys and a root");
  const target =
    course.targetPosition === undefined
      ? undefined
      : nodes.get(course.targetPosition);
  if (
    course.targetPosition !== undefined &&
    (target === undefined || !target.isOpeningEnd)
  )
    throw new RangeError(
      "Opening course target position must be an opening end",
    );
  for (const node of course.nodes) {
    if (positionKeyForFen(node.fen) !== node.positionKey)
      throw new RangeError("Opening node key does not match FEN");
    for (const move of node.moves) {
      if (!nodes.has(move.target) || !legalNext(node, move))
        throw new RangeError(
          "Opening edge is illegal or has an unknown target",
        );
    }
  }
  // Linked steps are an additive v1 content convention. Older persisted v1
  // courses remain valid when they have neither a target nor move links.
  if (course.targetPosition === undefined) {
    for (const step of course.explanationSteps)
      if (!nodes.has(step.positionKey))
        throw new RangeError("Explanation step references an unknown node");
    return freeze(course);
  }
  if (course.explanationSteps.length < 3)
    throw new RangeError(
      "Linked opening course requires three explanation steps",
    );
  for (const [index, step] of course.explanationSteps.entries()) {
    const from = nodes.get(step.positionKey);
    if (from === undefined)
      throw new RangeError("Explanation step references an unknown node");
    if (step.recommendedMove === undefined)
      throw new RangeError(
        "Linked explanation step requires a recommended move",
      );
    const learnerMove = from.moves.find(
      (move) => move.uci === step.recommendedMove,
    );
    const afterLearnerMove =
      learnerMove === undefined ? undefined : nodes.get(learnerMove.target);
    const mainReply = afterLearnerMove?.moves.find(
      (move) => move.kind === "main",
    );
    const nextPosition =
      course.explanationSteps[index + 1]?.positionKey ?? course.targetPosition;
    if (mainReply?.target !== nextPosition)
      throw new RangeError(
        "Explanation step must connect through its recommended move and a main reply",
      );
  }
  return freeze(course);
}

export function selectOpeningCourseV1(
  course: OpeningCourseV1,
  color: PlayerColor,
): {
  readonly available: boolean;
  readonly course: OpeningCourseV1;
  readonly reason?: string;
} {
  const valid = validateOpeningCourseV1(course);
  return valid.supportedColors.includes(color)
    ? freeze({ available: true, course: valid })
    : freeze({
        available: false,
        course: valid,
        reason: "Esta apertura MVP se practica con blancas.",
      });
}

export function matchOpeningPositionV1(
  course: OpeningCourseV1,
  beforeFen: string,
  playedUci: string,
  quality?: OpeningObjectiveQualityV1,
): OpeningMatchV1 {
  const valid = validateOpeningCourseV1(course);
  const before = positionKeyForFen(beforeFen);
  const from = byKey(valid).get(before);
  let afterFen: string;
  try {
    afterFen = applyUciMove(loadPosition(beforeFen), playedUci).fen;
  } catch {
    throw new RangeError("Opening candidate move must be legal");
  }
  const key = positionKeyForFen(afterFen);
  const target = byKey(valid).get(key);
  const direct = from?.moves.find((move) => move.uci === playedUci);
  const incoming = valid.nodes
    .flatMap((node) => node.moves)
    .filter((move) => move.target === key).length;
  const kind: OpeningMatchKindV1 =
    incoming > 1 && target !== undefined
      ? "transposition"
      : direct?.kind === "main"
        ? "main"
        : direct?.kind === "valid-alternative"
          ? "valid-alternative"
          : target !== undefined
            ? "transposition"
            : "outside";
  return freeze({
    kind,
    positionKey: key,
    ...(target === undefined ? {} : { node: target }),
    ...(quality === undefined ? {} : { objectiveQuality: quality }),
  });
}

export function assessOpeningCandidateV1(
  fen: string,
  best: EngineLine | undefined,
  candidate: OpeningCandidateEvidenceV1 | undefined,
  policy = OPENING_SAFETY_POLICY_V1,
): OpeningCandidateAssessmentV1 {
  if (best === undefined || candidate === undefined)
    return freeze({
      move: candidate?.move ?? "",
      allowed: false,
      reason: "missing-evidence",
    });
  if (!isLegalEngineLineFromFen(fen, best))
    return freeze({
      move: candidate.move,
      allowed: false,
      reason: "illegal-evidence",
    });
  if (candidate.line.moves[0] !== candidate.move)
    return freeze({
      move: candidate.move,
      allowed: false,
      reason: "evidence-mismatch",
    });
  if (
    !isLegalMoveFromFen(fen, candidate.move) ||
    !isLegalEngineLineFromFen(fen, candidate.line)
  )
    return freeze({
      move: candidate.move,
      allowed: false,
      reason: "illegal-evidence",
    });
  const bestMate = best.score.kind === "mate" && best.score.moves > 0;
  const candidateMateLoss =
    candidate.line.score.kind === "mate" && candidate.line.score.moves < 0;
  if (policy.rejectMateRegression && bestMate && candidateMateLoss)
    return freeze({
      move: candidate.move,
      allowed: false,
      reason: "mate-regression",
      evidence: candidate.line,
    });
  return freeze({
    move: candidate.move,
    allowed: score(best) - score(candidate.line) <= policy.maximumCentipawnGap,
    reason:
      score(best) - score(candidate.line) <= policy.maximumCentipawnGap
        ? "within-margin"
        : "outside-margin",
    evidence: candidate.line,
  });
}

/** Pure selection over injected engine output. It never invokes an engine. */
export function chooseOpeningReplyV1(
  course: OpeningCourseV1,
  fen: string,
  evidence: {
    readonly best: EngineLine;
    readonly candidates: readonly OpeningCandidateEvidenceV1[];
    readonly engineBestMove: string;
  },
): OpeningReplyChoiceV1 {
  if (!isLegalEngineLineFromFen(fen, evidence.best))
    throw new RangeError(
      "Best engine evidence must be a legal line from the current FEN",
    );
  if (!isLegalMoveFromFen(fen, evidence.engineBestMove))
    throw new RangeError("Engine fallback must be legal from the current FEN");
  const node = byKey(validateOpeningCourseV1(course)).get(
    positionKeyForFen(fen),
  );
  const allowed = node?.moves
    .map((move) =>
      assessOpeningCandidateV1(
        fen,
        evidence.best,
        evidence.candidates.find((item) => item.move === move.uci),
      ),
    )
    .find((assessment) => assessment.allowed);
  if (allowed !== undefined)
    return freeze({
      move: allowed.move,
      source: "opening",
      reason:
        "La respuesta conserva la apertura dentro del margen de seguridad.",
      assessment: allowed,
    });
  return freeze({
    move: evidence.engineBestMove,
    source: "engine-fallback",
    reason:
      "Ninguna respuesta del repertorio tiene evidencia suficiente para ser segura.",
  });
}
