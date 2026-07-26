import {
  applyMove,
  formatMovePhrase,
  getCastlingRights,
  getPieceAt,
  listLegalMoves,
  listPieces,
  loadPosition,
  type GameSession,
  type MoveRecord,
  type PlayerColor,
} from "@chess-coach/chess-core";
import type { EngineLine, EngineScore } from "@chess-coach/engine";

export type MoveLabel =
  | "best"
  | "brilliant"
  | "great"
  | "excellent"
  | "good"
  | "inaccuracy"
  | "mistake"
  | "blunder"
  | "miss"
  | "already-lost";
export type HintLevel = 1 | 2 | 3;
export type HelpLevel = "none" | "normal" | "guided";
export type CoachActor = "user" | "maia";
export type MotifKind =
  | "mate"
  | "material"
  | "hanging-piece"
  | "tactical"
  | "king-safety"
  | "threat"
  | "structure"
  | "development"
  | "activity"
  | "equivalent"
  | "neutral"
  | "none";

/** Verifiable reason names used by the contextual-v3 explanation contract. */
export type ContextualReasonKind =
  | "allowed-mate"
  | "direct-material-loss"
  | "left-piece-undefended"
  | "ignored-threat"
  | "allowed-forcing-attack"
  | "lost-castling-right"
  | "slow-development"
  | "unidentified";

export type ExplanationConfidence = "high" | "medium" | "low";
export type BestMovePurpose =
  | "avoids-mate"
  | "prevents-capture"
  | "defends-piece"
  | "develops-piece"
  | "castles"
  | "preserves"
  | "prepares-castling"
  | "wins-material"
  | "creates-check";

export type ContextualFactRef =
  | { readonly kind: "engine-mate"; readonly line: "before" | "after" }
  | { readonly kind: "variation-move"; readonly ply: number }
  | { readonly kind: "piece"; readonly square: string }
  | { readonly kind: "castling-right"; readonly color: PlayerColor }
  | { readonly kind: "development"; readonly square: string }
  | { readonly kind: "multipv-equivalent" };

export interface ContextualReason {
  readonly kind: ContextualReasonKind;
  readonly confidence: ExplanationConfidence;
  readonly factRefs: readonly ContextualFactRef[];
}

export interface ContextualConsequence {
  readonly kind: "mate" | "material-loss" | "forcing-attack" | "initiative";
  readonly factRefs: readonly ContextualFactRef[];
}

/**
 * Structured chess facts only. Visible wording is intentionally kept in
 * CoachPresentation so that a migration can read old records without making
 * up an explanation that was never analysed.
 */
export type ContextualExplanation =
  | {
      readonly mode: "explained";
      readonly primaryReason: ContextualReason;
      readonly consequence: ContextualConsequence;
      readonly bestMovePurposes: readonly BestMovePurpose[];
      readonly supportingVariation: readonly VerifiedMove[];
    }
  | {
      readonly mode: "recommendation-only";
      readonly primaryReason: {
        readonly kind: "unidentified";
        readonly confidence: "low";
        readonly factRefs: readonly ContextualFactRef[];
      };
      readonly bestMovePurposes: readonly BestMovePurpose[];
      readonly supportingVariation: readonly VerifiedMove[];
    }
  | {
      readonly mode: "equivalent";
      readonly primaryReason: {
        readonly kind: "unidentified";
        readonly confidence: "medium";
        readonly factRefs: readonly ContextualFactRef[];
      };
      readonly bestMovePurposes: readonly BestMovePurpose[];
      readonly supportingVariation: readonly VerifiedMove[];
    };

export interface CoachPresentation {
  readonly locale: "es";
  readonly templateId: string;
  /** Compact card copy. */
  readonly summary: string;
  /** Expanded explanation. It must not be an exact copy of summary. */
  readonly detail: string;
}

/**
 * Public Classification V2 Expected Points cutoffs.
 *
 * Chess.com publishes these boundaries, but not the rating-dependent function
 * that maps engine scores to Expected Points. The cutoffs are therefore
 * replicated exactly while the local score calibration remains versioned and
 * explicitly marked as an estimate when it is based on centipawns.
 */
export const COACH_CLASSIFICATION_CONFIG = Object.freeze({
  version: "chesscom-classification-v2",
  bestLoss: 0,
  excellentLoss: 0.02,
  goodLoss: 0.05,
  inaccuracyLoss: 0.1,
  mistakeLoss: 0.2,
  noiseLoss: 0.02,
  alreadyLostExpectedScoreAtMost: 0.15,
  alreadyLostGoodLoss: 0.08,
  alreadyLostInaccuracyLoss: 0.24,
  alreadyLostMistakeLoss: 0.5,
  equivalentLoss: 0.02,
  greatLoss: 0.02,
  brilliantLoss: 0.035,
  missedWinBeforeAtLeast: 0.62,
  missedWinAfterAtMost: 0.48,
} as const);

export const CENTIPAWN_CALIBRATION_VERSION = "centipawn-logistic-v1";

export interface EvaluationEvidence {
  readonly before: EngineScore;
  readonly after: EngineScore;
  readonly bestLine: EngineLine;
  readonly playedUci: string;
  readonly perspective: PlayerColor;
}

export interface VerifiedMove {
  readonly uci: string;
  readonly san: string;
}

/** Raw engine data is retained separately from all normalized coaching metrics. */
export interface CoachEvidence {
  readonly before: EngineLine;
  readonly after: EngineLine;
  readonly perspective: PlayerColor;
  readonly playedUci: string;
  readonly bestMove?: VerifiedMove;
  /** Best legal alternative when the principal variation does not match the played move. */
  readonly alternativeMove?: VerifiedMove;
  readonly verifiedBestVariation: readonly VerifiedMove[];
  /** Optional for persisted schema-v2 records created before MultiPV evidence. */
  readonly beforeLines?: readonly EngineLine[];
  readonly afterLines?: readonly EngineLine[];
  readonly validation: {
    readonly playedMoveLegal: boolean;
    readonly bestLineFullyLegal: boolean;
  };
}

export type ExpectedScoreSource = "wdl" | "centipawn" | "mate";

export interface CalibratedExpectedScore {
  readonly value: number;
  readonly source: ExpectedScoreSource;
  readonly calibrationVersion:
    "wdl-v1" | typeof CENTIPAWN_CALIBRATION_VERSION | "mate-outcome-v1";
}

export interface MoveAssessment {
  readonly label: MoveLabel;
  readonly expectedLoss: number;
  readonly expectedScoreBefore: CalibratedExpectedScore;
  readonly expectedScoreAfter: CalibratedExpectedScore;
  readonly isEstimated: boolean;
  readonly calibration: {
    readonly version: "expected-score-v1" | "expected-points-v2";
    readonly perspective: PlayerColor;
    readonly sourceBefore: ExpectedScoreSource;
    readonly sourceAfter: ExpectedScoreSource;
  };
  readonly context: {
    readonly alreadyLost: boolean;
    readonly mateLost: boolean;
    readonly helpLevel: HelpLevel;
    readonly equivalent: boolean;
    readonly missedWin: boolean;
  };
}

export interface MotifDetection {
  readonly kind: MotifKind;
  readonly detectorVersion: "motif-v1" | "motif-v2";
  readonly confidence?: "high" | "medium" | "low";
  /** Optional for persisted schema-v2 records created before motif-v2. */
  readonly facts?: readonly PositionFact[];
  readonly evidence: readonly string[];
}

export type PositionFactKind =
  | "capture"
  | "check"
  | "hanging-piece"
  | "forced-response"
  | "tactical"
  | "king-safety"
  | "activity"
  | "development"
  | "equivalent"
  | "neutral";

export interface PositionFact {
  readonly kind: PositionFactKind;
  readonly detail: string;
  readonly square?: string;
  readonly move?: VerifiedMove;
}

export interface CoachCopy {
  readonly locale: "es";
  readonly templateId: string;
  readonly text: string;
}

export interface CoachHint {
  readonly level: HintLevel;
  readonly templateId: string;
  readonly text: string;
  readonly target: {
    readonly kind: "goal" | "piece-zone" | "move";
    readonly move?: VerifiedMove;
  };
}

/**
 * Versioned, persistence-friendly artifact for one completed ply. The actor
 * controls visibility: Maia turns keep evidence but intentionally have no label,
 * copy, or hints intended for the player.
 */
interface CoachTurnRecordBase {
  readonly turn: {
    readonly ply: number;
    readonly actor: CoachActor;
    readonly playedUci: string;
    readonly playedSan: string;
    readonly beforeFen: string;
    readonly afterFen: string;
    readonly perspective: PlayerColor;
  };
  readonly evidence: CoachEvidence;
  readonly assessment?: MoveAssessment;
  readonly motif: MotifDetection;
  /** v2-compatible compact copy; new views should use presentation. */
  readonly copy?: CoachCopy;
  /** Missing on decoded schema-v2 records; never synthesized during migration. */
  readonly explanation?: ContextualExplanation;
  readonly presentation?: CoachPresentation;
  readonly hints: readonly CoachHint[];
}

/** Persisted schema before contextual explanations. It remains readable only. */
export interface CoachTurnRecordV2 extends CoachTurnRecordBase {
  readonly schemaVersion: 2;
}

export interface CoachTurnRecordV3 extends CoachTurnRecordBase {
  readonly schemaVersion: 3;
}

export type CoachTurnRecord = CoachTurnRecordV2 | CoachTurnRecordV3;

/** Compatibility view for the pre-v2 UI. New callers should use analyzeTurn. */
export interface CoachFeedback {
  readonly record: CoachTurnRecord;
  readonly label: MoveLabel;
  readonly loss: number;
  readonly evidence: EvaluationEvidence;
  readonly motif: MotifKind;
  readonly explanation: string;
  readonly hints: Readonly<Record<HintLevel, string>>;
  readonly alternativeUci?: string;
  readonly isEstimated: boolean;
}

export interface AnalyzeTurnOptions {
  readonly actor?: CoachActor;
  readonly helpLevel?: HelpLevel;
  /** Perspective used when the engine scores were requested. */
  readonly perspective?: PlayerColor;
  /** All validated MultiPV lines from the same before/after search. */
  readonly beforeLines?: readonly EngineLine[];
  readonly afterLines?: readonly EngineLine[];
  /** Rejects syntactically valid but illegal UCI progress variations. */
  readonly requireCompleteVariations?: boolean;
}

export interface ClassificationContext {
  readonly alreadyLost?: boolean;
  readonly mateLost?: boolean;
  readonly equivalent?: boolean;
  readonly great?: boolean;
  readonly brilliant?: boolean;
  readonly missedWin?: boolean;
}

function assertFiniteNonNegative(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative finite number`);
  }
}

export function expectedScoreFromWdl(
  wins: number,
  draws: number,
  losses: number,
): number {
  [wins, draws, losses].forEach((value) =>
    assertFiniteNonNegative(value, "WDL value"),
  );
  const total = wins + draws + losses;
  if (!Number.isFinite(total) || total <= 0) {
    throw new RangeError("WDL total must be a positive finite number");
  }
  return (wins + 0.5 * draws) / total;
}

/** A versioned estimate for ordering decisions, never an exact win probability. */
export function expectedScoreFromCentipawns(value: number): number {
  if (!Number.isFinite(value)) throw new RangeError("Score must be finite");
  const bounded = Math.max(-10_000, Math.min(10_000, value));
  return 1 / (1 + Math.exp(-bounded / 400));
}

export function scoreToExpectedScore(score: EngineScore): number {
  return score.kind === "centipawns"
    ? expectedScoreFromCentipawns(score.value)
    : score.moves > 0
      ? 1
      : score.moves < 0
        ? 0
        : 0.5;
}

export function expectedLoss(best: number, played: number): number {
  if (
    ![best, played].every(
      (value) => Number.isFinite(value) && value >= 0 && value <= 1,
    )
  ) {
    throw new RangeError(
      "Expected scores must be finite values between 0 and 1",
    );
  }
  return Math.max(0, best - played);
}

export function classifyMove(
  loss: number,
  context: ClassificationContext = {},
): MoveLabel {
  if (!Number.isFinite(loss) || loss < 0) throw new RangeError("Invalid loss");
  if (context.mateLost) return "blunder";
  if (context.missedWin) return "miss";
  if (context.alreadyLost && loss <= COACH_CLASSIFICATION_CONFIG.noiseLoss)
    return "already-lost";
  if (context.brilliant && loss <= COACH_CLASSIFICATION_CONFIG.brilliantLoss)
    return "brilliant";
  if (loss === COACH_CLASSIFICATION_CONFIG.bestLoss) return "best";
  if (loss <= COACH_CLASSIFICATION_CONFIG.excellentLoss) return "excellent";
  if (context.great && loss <= COACH_CLASSIFICATION_CONFIG.greatLoss)
    return "great";
  if (context.equivalent && loss <= COACH_CLASSIFICATION_CONFIG.equivalentLoss)
    return "good";

  const thresholds = context.alreadyLost
    ? {
        good: COACH_CLASSIFICATION_CONFIG.alreadyLostGoodLoss,
        inaccuracy: COACH_CLASSIFICATION_CONFIG.alreadyLostInaccuracyLoss,
        mistake: COACH_CLASSIFICATION_CONFIG.alreadyLostMistakeLoss,
      }
    : {
        good: COACH_CLASSIFICATION_CONFIG.goodLoss,
        inaccuracy: COACH_CLASSIFICATION_CONFIG.inaccuracyLoss,
        mistake: COACH_CLASSIFICATION_CONFIG.mistakeLoss,
      };

  if (loss <= thresholds.good) return "good";
  if (loss <= thresholds.inaccuracy) return "inaccuracy";
  if (loss <= thresholds.mistake) return "mistake";
  return "blunder";
}

function isValidWdl(line: EngineLine): line is EngineLine & {
  readonly wdl: {
    readonly wins: number;
    readonly draws: number;
    readonly losses: number;
  };
} {
  if (line.wdl === undefined) return false;
  try {
    expectedScoreFromWdl(line.wdl.wins, line.wdl.draws, line.wdl.losses);
    return true;
  } catch {
    return false;
  }
}

function calibrate(line: EngineLine): CalibratedExpectedScore {
  if (isValidWdl(line)) {
    return Object.freeze({
      value: expectedScoreFromWdl(
        line.wdl.wins,
        line.wdl.draws,
        line.wdl.losses,
      ),
      source: "wdl",
      calibrationVersion: "wdl-v1",
    });
  }
  if (line.score.kind === "mate") {
    return Object.freeze({
      value: scoreToExpectedScore(line.score),
      source: "mate",
      calibrationVersion: "mate-outcome-v1",
    });
  }
  return Object.freeze({
    value: expectedScoreFromCentipawns(line.score.value),
    source: "centipawn",
    calibrationVersion: CENTIPAWN_CALIBRATION_VERSION,
  });
}

function parseUci(
  uci: string,
): { from: string; to: string; promotion?: "q" | "r" | "b" | "n" } | undefined {
  const match = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/.exec(uci);
  if (!match) return undefined;
  const promotion = match[3] as "q" | "r" | "b" | "n" | undefined;
  return promotion === undefined
    ? { from: match[1]!, to: match[2]! }
    : { from: match[1]!, to: match[2]!, promotion };
}

function verifiedVariation(
  fen: string,
  moves: readonly string[],
): {
  readonly moves: readonly VerifiedMove[];
  readonly complete: boolean;
} {
  let session = loadPosition(fen);
  const verified: VerifiedMove[] = [];
  for (const uci of moves) {
    const parsed = parseUci(uci);
    if (!parsed) return { moves: Object.freeze(verified), complete: false };
    const legal = listLegalMoves(session.fen).find((move) => move.uci === uci);
    if (!legal) return { moves: Object.freeze(verified), complete: false };
    session = applyMove(session, parsed);
    verified.push(Object.freeze({ uci, san: legal.san }));
  }
  return { moves: Object.freeze(verified), complete: true };
}

function describeMove(
  beforeFen: string,
  move: VerifiedMove,
  prefix: "Moviste" | "mover",
): string {
  const phrase = formatMovePhrase(beforeFen, move);
  return prefix === "Moviste" ? `Moviste ${phrase}` : `mover ${phrase}`;
}

function trimSentencePunctuation(text: string): string {
  return text.replace(/[.!?]+$/u, "");
}

function isMateLost(before: EngineScore, expectedScoreAfter: number): boolean {
  return (
    before.kind === "mate" && before.moves > 0 && expectedScoreAfter <= 0.5
  );
}

type BoardPieces = Readonly<Record<string, string>>;

function boardPieces(fen: string): BoardPieces {
  const result: Record<string, string> = {};
  const ranks = fen.split(" ")[0]?.split("/") ?? [];
  ranks.forEach((rank, rankIndex) => {
    let file = 0;
    for (const symbol of rank ?? "") {
      if (/\d/.test(symbol)) {
        file += Number(symbol);
      } else {
        result[`${String.fromCharCode(97 + file)}${8 - rankIndex}`] = symbol;
        file += 1;
      }
    }
  });
  return result;
}

function pieceName(piece: string | undefined): string {
  const names: Readonly<Record<string, string>> = {
    p: "peón",
    n: "caballo",
    b: "alfil",
    r: "torre",
    q: "dama",
    k: "rey",
  };
  return names[piece?.toLowerCase() ?? ""] ?? "pieza";
}

function expectedLineScore(line: EngineLine): number {
  try {
    return calibrate(line).value;
  } catch {
    return scoreToExpectedScore(line.score);
  }
}

function linesAreEquivalent(lines: readonly EngineLine[]): boolean {
  const first = lines[0];
  const second = lines[1];
  if (!first || !second) return false;
  return (
    Math.abs(expectedLineScore(first) - expectedLineScore(second)) <=
    COACH_CLASSIFICATION_CONFIG.equivalentLoss
  );
}

/**
 * Calculates the user-facing assessment as soon as the before/after engine
 * lines are available. Raw engine evidence, motif detection, copy, and hints
 * deliberately remain outside this pure assessment step.
 *
 * Maia turns retain technical evidence in `analyzeTurn`, but do not receive a
 * user-facing assessment.
 */
export function assessTurn(
  before: GameSession,
  after: GameSession,
  beforeLine: EngineLine,
  afterLine: EngineLine,
  options: AnalyzeTurnOptions = {},
): MoveAssessment | undefined {
  const played = after.history.at(-1);
  if (!played) throw new RangeError("A played move is required");
  const actor = options.actor ?? "user";
  const helpLevel = options.helpLevel ?? "normal";
  const perspective = options.perspective ?? before.turn;
  const playedMoveLegal = listLegalMoves(before.fen).some(
    (move) => move.uci === played.uci,
  );
  if (!playedMoveLegal)
    throw new RangeError("The played move is not legal in the before position");

  const beforeLines = Object.freeze([
    ...(options.beforeLines?.length ? options.beforeLines : [beforeLine]),
  ]);
  const variation = verifiedVariation(before.fen, beforeLine.moves);
  const afterVariation = verifiedVariation(after.fen, afterLine.moves);
  if (
    options.requireCompleteVariations &&
    (!variation.complete || !afterVariation.complete)
  ) {
    throw new RangeError("Progress variations must be fully legal");
  }
  const bestMove = variation.moves[0];
  const beforeExpected = calibrate(beforeLine);
  const afterExpected = calibrate(afterLine);
  const loss = expectedLoss(beforeExpected.value, afterExpected.value);
  const mateLost = isMateLost(beforeLine.score, afterExpected.value);
  const alreadyLost =
    beforeExpected.value <=
    COACH_CLASSIFICATION_CONFIG.alreadyLostExpectedScoreAtMost;
  const equivalent = linesAreEquivalent(beforeLines);
  const missedWin =
    beforeExpected.value >=
      COACH_CLASSIFICATION_CONFIG.missedWinBeforeAtLeast &&
    afterExpected.value <= COACH_CLASSIFICATION_CONFIG.missedWinAfterAtMost;
  const bestMovePlayed = bestMove?.uci === played.uci;
  const afterCapturesPlayedPiece =
    afterVariation.moves[0]?.uci.slice(2, 4) === played.to &&
    afterVariation.moves[0]?.san.includes("x");
  const brilliant =
    bestMovePlayed &&
    afterCapturesPlayedPiece &&
    !alreadyLost &&
    loss <= COACH_CLASSIFICATION_CONFIG.brilliantLoss;
  const great =
    bestMovePlayed &&
    !brilliant &&
    !missedWin &&
    loss > COACH_CLASSIFICATION_CONFIG.noiseLoss;

  if (actor !== "user") return undefined;

  return Object.freeze({
    label: classifyMove(loss, {
      alreadyLost,
      mateLost,
      equivalent,
      great,
      brilliant,
      missedWin,
    }),
    expectedLoss: loss,
    expectedScoreBefore: beforeExpected,
    expectedScoreAfter: afterExpected,
    isEstimated:
      beforeExpected.source === "centipawn" ||
      afterExpected.source === "centipawn",
    calibration: Object.freeze({
      version: "expected-points-v2" as const,
      perspective,
      sourceBefore: beforeExpected.source,
      sourceAfter: afterExpected.source,
    }),
    context: Object.freeze({
      alreadyLost,
      mateLost,
      helpLevel,
      equivalent,
      missedWin,
    }),
  });
}

function detectMotif(
  before: GameSession,
  after: GameSession,
  played: MoveRecord,
  assessment: MoveAssessment | undefined,
  bestVariation: readonly VerifiedMove[],
  afterVariation: readonly VerifiedMove[],
  beforeLines: readonly EngineLine[],
): MotifDetection {
  const facts: PositionFact[] = [];
  const evidence: string[] = [];
  const beforeBoard = boardPieces(before.fen);
  const afterBoard = boardPieces(after.fen);
  const movedPiece = afterBoard[played.to];
  const opponentCaptures = listLegalMoves(after.fen).filter(
    (move) => move.to === played.to && move.san.includes("x"),
  );
  const bestResponse = afterVariation[0];

  if (played.san.includes("x")) {
    const capturedPiece = beforeBoard[played.to];
    facts.push({
      kind: "capture",
      detail: capturedPiece
        ? `Capturaste el ${pieceName(capturedPiece)} en ${played.to}.`
        : `La jugada captura material en ${played.to}.`,
      square: played.to,
    });
    evidence.push("legal-capture-in-played-move");
  }
  if (after.isCheck || played.san.includes("+") || played.san.includes("#")) {
    facts.push({
      kind: "check",
      detail: "La jugada crea un jaque legal.",
      move: { uci: played.uci, san: played.san },
    });
    evidence.push("check-in-legal-position");
  }
  if (opponentCaptures.length > 0 && movedPiece) {
    facts.push({
      kind: "hanging-piece",
      detail: `El ${pieceName(movedPiece)} de ${played.to} queda capturable inmediatamente.`,
      square: played.to,
      move: {
        uci: opponentCaptures[0]!.uci,
        san: opponentCaptures[0]!.san,
      },
    });
    evidence.push("opponent-has-legal-capture-on-moved-piece");
  }
  if (bestResponse?.san.includes("+") || bestResponse?.san.includes("#")) {
    facts.push({
      kind: "forced-response",
      detail: `La mejor respuesta ${bestResponse.san} crea una amenaza forzada.`,
      move: bestResponse,
    });
    evidence.push("best-response-contains-forcing-check");
  }
  if (
    bestVariation.some(
      (move) => move.san.includes("+") || move.san.includes("x"),
    )
  ) {
    facts.push({
      kind: "tactical",
      detail:
        "La variante principal contiene una secuencia forzada verificable.",
      ...(bestVariation[0] === undefined ? {} : { move: bestVariation[0] }),
    });
    evidence.push("best-variation-contains-forcing-sequence");
  }
  if (linesAreEquivalent(beforeLines)) {
    facts.push({
      kind: "equivalent",
      detail: "Hay más de una continuación con resultado esperado equivalente.",
    });
    evidence.push("top-multipv-lines-equivalent");
  }
  if (
    (played.from[1] === "2" || played.from[1] === "7") &&
    !played.san.includes("x") &&
    !played.san.includes("+") &&
    movedPiece?.toLowerCase() !== "p"
  ) {
    facts.push({
      kind: "development",
      detail: `La jugada desarrolla el ${pieceName(movedPiece)} desde su fila inicial.`,
      square: played.to,
    });
    evidence.push("minor-piece-leaves-home-rank");
  }

  let kind: MotifKind = "neutral";
  let confidence: MotifDetection["confidence"] = "low";
  const confirmedMaterialLoss =
    isNegativeAssessment(assessment) ||
    (assessment !== undefined &&
      assessment.expectedLoss >= COACH_CLASSIFICATION_CONFIG.mistakeLoss);
  if (assessment?.context.mateLost || after.isCheckmate) {
    kind = "mate";
    confidence = "high";
    evidence.push("mate-score-or-board-state");
  } else if (facts.some((fact) => fact.kind === "check")) {
    kind = "king-safety";
    confidence = "high";
  } else if (
    confirmedMaterialLoss &&
    facts.some((fact) => fact.kind === "hanging-piece")
  ) {
    kind = "hanging-piece";
    confidence = "high";
  } else if (
    facts.some(
      (fact) => fact.kind === "tactical" || fact.kind === "forced-response",
    ) &&
    (assessment?.label === "mistake" ||
      assessment?.label === "blunder" ||
      assessment?.label === "miss")
  ) {
    kind = "tactical";
    confidence = "high";
  } else if (facts.some((fact) => fact.kind === "capture")) {
    kind = "material";
    confidence = "high";
  } else if (facts.some((fact) => fact.kind === "equivalent")) {
    kind = "equivalent";
    confidence = "medium";
  } else if (facts.some((fact) => fact.kind === "development")) {
    kind = "development";
    confidence = "medium";
  } else if (assessment === undefined) {
    kind = "none";
  }

  if (kind === "neutral") evidence.push("no-specific-verified-motif");
  if (
    Object.keys(beforeBoard).length === 0 ||
    Object.keys(afterBoard).length === 0
  )
    evidence.push("board-facts-unavailable");
  return Object.freeze({
    kind,
    detectorVersion: "motif-v2",
    confidence,
    facts: Object.freeze(facts.map((fact) => Object.freeze(fact))),
    evidence: Object.freeze(evidence),
  });
}

const NEGATIVE_LABELS: readonly MoveLabel[] = Object.freeze([
  "inaccuracy",
  "mistake",
  "blunder",
  "miss",
]);

const CONTEXTUAL_THRESHOLDS = Object.freeze({
  /** A tactical claim requires at least an expected-score mistake-sized drop. */
  verifiedTacticalLoss: COACH_CLASSIFICATION_CONFIG.noiseLoss,
  /** Development language is limited to the opening, not a late-game judgement. */
  openingPlyAtMost: 20,
});

function isNegativeAssessment(assessment: MoveAssessment | undefined): boolean {
  return assessment !== undefined && NEGATIVE_LABELS.includes(assessment.label);
}

function isCastlingMove(move: VerifiedMove | MoveRecord): boolean {
  const from = move.uci.slice(0, 2);
  const to = move.uci.slice(2, 4);
  return (
    (from === "e1" && (to === "g1" || to === "c1")) ||
    (from === "e8" && (to === "g8" || to === "c8"))
  );
}

function isMinorPieceDevelopment(
  beforeFen: string,
  move: VerifiedMove | MoveRecord,
): boolean {
  const piece = getPieceAt(beforeFen, move.uci.slice(0, 2));
  return (
    (piece?.type === "n" || piece?.type === "b") &&
    (piece.color === "white" ? move.uci[1] === "1" : move.uci[1] === "8")
  );
}

function lostMoverCastlingRight(
  beforeFen: string,
  afterFen: string,
  color: PlayerColor,
): boolean {
  const beforeRights = getCastlingRights(beforeFen)[color];
  const afterRights = getCastlingRights(afterFen)[color];
  return (
    (beforeRights.kingside && !afterRights.kingside) ||
    (beforeRights.queenside && !afterRights.queenside)
  );
}

function bestMovePurposes(
  beforeFen: string,
  assessment: MoveAssessment,
  move: VerifiedMove | undefined,
): readonly BestMovePurpose[] {
  if (!move) return Object.freeze([]);
  const purposes: BestMovePurpose[] = [];
  const from = move.uci.slice(0, 2);
  const piece = getPieceAt(beforeFen, from);
  if (assessment.context.mateLost) purposes.push("avoids-mate");
  if (isCastlingMove(move)) purposes.push("castles");
  if (isMinorPieceDevelopment(beforeFen, move)) purposes.push("develops-piece");
  if (move.san.includes("+") || move.san.includes("#"))
    purposes.push("creates-check");
  const rights = getCastlingRights(beforeFen)[piece?.color ?? "white"];
  if (
    (piece?.type === "n" || piece?.type === "b") &&
    (rights.kingside || rights.queenside)
  ) {
    purposes.push("prepares-castling");
  }
  return Object.freeze([...new Set(purposes)]);
}

function contextualExplanation(
  before: GameSession,
  after: GameSession,
  played: MoveRecord,
  assessment: MoveAssessment,
  bestVariation: readonly VerifiedMove[],
  afterVariation: readonly VerifiedMove[],
  beforeLines: readonly EngineLine[],
): ContextualExplanation {
  const bestMove = bestVariation[0];
  const purposes = bestMovePurposes(before.fen, assessment, bestMove);
  const supportingVariation = Object.freeze(bestVariation.slice(0, 3));
  if (assessment.context.equivalent || linesAreEquivalent(beforeLines)) {
    return Object.freeze({
      mode: "equivalent",
      primaryReason: Object.freeze({
        kind: "unidentified",
        confidence: "medium",
        factRefs: Object.freeze([{ kind: "multipv-equivalent" } as const]),
      }),
      bestMovePurposes: purposes,
      supportingVariation,
    });
  }

  const response = afterVariation[0];
  const responseTarget = response?.uci.slice(2, 4);
  const tacticalDrop =
    assessment.expectedLoss >= CONTEXTUAL_THRESHOLDS.verifiedTacticalLoss;
  const responseTargetPiece = responseTarget
    ? getPieceAt(after.fen, responseTarget)
    : undefined;
  const responseIsCapture =
    response?.san.includes("x") === true ||
    (responseTargetPiece !== undefined &&
      responseTargetPiece.color !== after.turn);
  const responseCapturesMovedPiece =
    responseIsCapture && responseTarget === played.to;
  // A validated PV capture plus the named score drop is sufficient evidence;
  // do not treat the mere availability of a legal capture as a motif.
  const materialClaimAllowed =
    isNegativeAssessment(assessment) ||
    assessment.expectedLoss >= COACH_CLASSIFICATION_CONFIG.mistakeLoss;
  const hasConfirmedCapture =
    responseIsCapture && tacticalDrop && materialClaimAllowed;
  const hasForcingCheck =
    response !== undefined &&
    (response.san.includes("+") || response.san.includes("#")) &&
    tacticalDrop;

  const reason = (
    kind: ContextualReasonKind,
    confidence: ExplanationConfidence,
    factRefs: readonly ContextualFactRef[],
    consequence: ContextualConsequence,
  ): ContextualExplanation =>
    Object.freeze({
      mode: "explained",
      primaryReason: Object.freeze({
        kind,
        confidence,
        factRefs: Object.freeze([...factRefs]),
      }),
      consequence: Object.freeze(consequence),
      bestMovePurposes: purposes,
      supportingVariation,
    });

  if (assessment.context.mateLost) {
    return reason(
      "allowed-mate",
      "high",
      [
        { kind: "engine-mate", line: "before" },
        { kind: "engine-mate", line: "after" },
      ],
      { kind: "mate", factRefs: [{ kind: "engine-mate", line: "after" }] },
    );
  }
  if (hasConfirmedCapture && responseCapturesMovedPiece) {
    return reason(
      "left-piece-undefended",
      "high",
      [
        { kind: "piece", square: played.to },
        { kind: "variation-move", ply: 0 },
      ],
      { kind: "material-loss", factRefs: [{ kind: "variation-move", ply: 0 }] },
    );
  }
  if (hasConfirmedCapture) {
    return reason(
      "direct-material-loss",
      "high",
      [
        { kind: "piece", square: responseTarget! },
        { kind: "variation-move", ply: 0 },
      ],
      { kind: "material-loss", factRefs: [{ kind: "variation-move", ply: 0 }] },
    );
  }
  if (
    response !== undefined &&
    (response.san.includes("x") || response.san.includes("+")) &&
    materialClaimAllowed
  ) {
    return reason(
      "ignored-threat",
      "medium",
      [{ kind: "variation-move", ply: 0 }],
      {
        kind: response.san.includes("x") ? "material-loss" : "forcing-attack",
        factRefs: [{ kind: "variation-move", ply: 0 }],
      },
    );
  }
  if (hasForcingCheck && isNegativeAssessment(assessment)) {
    return reason(
      "allowed-forcing-attack",
      "medium",
      [{ kind: "variation-move", ply: 0 }],
      {
        kind: "forcing-attack",
        factRefs: [{ kind: "variation-move", ply: 0 }],
      },
    );
  }
  if (
    isNegativeAssessment(assessment) &&
    !isCastlingMove(played) &&
    lostMoverCastlingRight(before.fen, after.fen, before.turn)
  ) {
    return reason(
      "lost-castling-right",
      "high",
      [{ kind: "castling-right", color: before.turn }],
      {
        kind: "initiative",
        factRefs: [{ kind: "castling-right", color: before.turn }],
      },
    );
  }
  const stillUndeveloped = listPieces(after.fen).some(
    (piece) =>
      piece.color === before.turn &&
      (piece.type === "n" || piece.type === "b") &&
      (piece.color === "white"
        ? piece.square[1] === "1"
        : piece.square[1] === "8"),
  );
  if (
    isNegativeAssessment(assessment) &&
    after.history.length <= CONTEXTUAL_THRESHOLDS.openingPlyAtMost &&
    stillUndeveloped &&
    !isCastlingMove(played) &&
    !isMinorPieceDevelopment(before.fen, played)
  ) {
    return reason(
      "slow-development",
      "medium",
      [{ kind: "development", square: played.to }],
      {
        kind: "initiative",
        factRefs: [{ kind: "development", square: played.to }],
      },
    );
  }
  return Object.freeze({
    mode: "recommendation-only",
    primaryReason: Object.freeze({
      kind: "unidentified",
      confidence: "low",
      factRefs: Object.freeze([]),
    }),
    bestMovePurposes: purposes,
    supportingVariation,
  });
}

function compactReason(
  assessment: MoveAssessment,
  motif: MotifDetection,
  bestMove: VerifiedMove | undefined,
  played: MoveRecord,
): string {
  if (assessment.context.mateLost)
    return "La línea del motor pasa de mate favorable a desfavorable";
  if (assessment.context.alreadyLost)
    return "La evaluación ya era muy desfavorable antes de mover";

  const fact = motif.facts?.find(
    (candidate) =>
      candidate.kind === motif.kind ||
      (motif.kind === "tactical" && candidate.kind === "forced-response"),
  );
  if (fact?.detail) return trimSentencePunctuation(fact.detail);

  return bestMove?.uci === played.uci
    ? assessment.expectedLoss > COACH_CLASSIFICATION_CONFIG.noiseLoss
      ? "El resultado esperado empeora"
      : "La PV validada empieza con esta jugada"
    : "Tu jugada no es la primera de la PV validada";
}

function labelCopy(label: MoveLabel): string {
  switch (label) {
    case "best":
      return "Correcta";
    case "brilliant":
    case "great":
    case "excellent":
    case "good":
      return "Buena";
    case "inaccuracy":
      return "Imprecisión";
    case "mistake":
      return "Error";
    case "blunder":
      return "Error grave";
    case "miss":
      return "Oportunidad perdida";
    case "already-lost":
      return "Posición difícil";
  }
}

function mustAvoidBestClaim(assessment: MoveAssessment): boolean {
  return (
    assessment.context.mateLost ||
    assessment.label === "inaccuracy" ||
    assessment.label === "mistake" ||
    assessment.label === "blunder" ||
    assessment.label === "miss" ||
    assessment.label === "already-lost"
  );
}

function formatVariationPhrases(
  beforeFen: string,
  moves: readonly VerifiedMove[],
): readonly string[] {
  let position = loadPosition(beforeFen);
  const phrases: string[] = [];
  for (const move of moves) {
    phrases.push(formatMovePhrase(position.fen, move));
    const parsed = parseUci(move.uci);
    if (!parsed) break;
    try {
      position = applyMove(position, parsed);
    } catch {
      break;
    }
  }
  return Object.freeze(phrases);
}

function reasonSentence(reason: ContextualReasonKind): string {
  switch (reason) {
    case "allowed-mate":
      return "Esta jugada permite una amenaza de mate.";
    case "direct-material-loss":
      return "Esta jugada permite perder material de inmediato.";
    case "left-piece-undefended":
      return "Esta jugada deja una pieza sin suficiente defensa.";
    case "ignored-threat":
      return "Esta jugada no responde a una amenaza inmediata.";
    case "allowed-forcing-attack":
      return "Esta jugada facilita un ataque con jaque.";
    case "lost-castling-right":
      return "Esta jugada pierde un derecho de enroque.";
    case "slow-development":
      return "Esta jugada es lenta para el desarrollo.";
    case "unidentified":
      return "La alternativa recomendada ofrece una mejora comprobada.";
  }
}

function consequenceSentence(
  consequence: ContextualConsequence | undefined,
): string {
  switch (consequence?.kind) {
    case "mate":
      return "El rival puede continuar con una secuencia forzada contra tu rey.";
    case "material-loss":
      return "El rival puede aprovecharlo para ganar material.";
    case "forcing-attack":
      return "El rival gana tiempo con una respuesta forzada.";
    case "initiative":
      return "El rival puede completar su desarrollo con más comodidad.";
    default:
      return "";
  }
}

function purposeSentence(purposes: readonly BestMovePurpose[]): string {
  const labels: Readonly<Record<BestMovePurpose, string>> = {
    "avoids-mate": "evita la amenaza de mate",
    "prevents-capture": "evita una captura inmediata",
    "defends-piece": "defiende una pieza",
    "develops-piece": "desarrolla una pieza",
    castles: "pone al rey a salvo mediante el enroque",
    preserves: "conserva la posición",
    "prepares-castling": "prepara el enroque",
    "wins-material": "gana material",
    "creates-check": "crea un jaque",
  };
  const described = purposes.slice(0, 3).map((purpose) => labels[purpose]);
  if (described.length === 0) return "mejora la posición de forma comprobada";
  if (described.length === 1) return described[0]!;
  return described.length === 2
    ? `${described[0]} y ${described[1]}`
    : `${described[0]}, ${described[1]} y ${described[2]}`;
}

/** Immutable fields that identify the exact half-move being described. */
interface PresentationIdentity {
  readonly ply: number;
  readonly actor: CoachActor;
  readonly playedUci: string;
  readonly beforeFen: string;
  readonly afterFen: string;
  readonly perspective: PlayerColor;
}

/**
 * Template selection depends only on persisted half-move identity. It never
 * reads time, random state, or UI state, so a reload preserves the wording.
 */
function stableTemplateIndex(
  identity: PresentationIdentity,
  slot: string,
  length: number,
  avoid?: number,
): number {
  if (length < 1) throw new RangeError("Template choices must not be empty");
  const input = [
    identity.ply,
    identity.actor,
    identity.playedUci,
    identity.beforeFen,
    identity.afterFen,
    identity.perspective,
    slot,
  ].join("|");
  let hash = 2_166_136_261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  const selected = (hash >>> 0) % length;
  return avoid !== undefined && length > 1 && selected === avoid
    ? (selected + 1) % length
    : selected;
}

function templateChoice(
  identity: PresentationIdentity,
  slot: string,
  choices: readonly string[],
  avoid?: number,
): { readonly text: string; readonly index: number } {
  const index = stableTemplateIndex(identity, slot, choices.length, avoid);
  return Object.freeze({ text: choices[index]!, index });
}

const REASON_ALTERNATIVES: Readonly<
  Record<ContextualReasonKind, readonly string[]>
> = Object.freeze({
  "allowed-mate": Object.freeze([
    "Tu rey queda expuesto a una secuencia de mate.",
    "Con esta jugada dejas entrar un mate forzado.",
  ]),
  "direct-material-loss": Object.freeze([
    "El rival puede capturar material tras tu jugada.",
    "Concedes una ganancia material inmediata.",
  ]),
  "left-piece-undefended": Object.freeze([
    "Tu jugada deja esa pieza expuesta a una captura.",
    "La pieza en esa casilla no queda bien protegida.",
  ]),
  "ignored-threat": Object.freeze([
    "La jugada pasa por alto una amenaza que ya estaba presente.",
    "Dejas sin cubrir la amenaza más urgente del rival.",
  ]),
  "allowed-forcing-attack": Object.freeze([
    "Tu jugada facilita una respuesta forzada con jaque.",
    "El rival gana iniciativa al poder dar jaque.",
  ]),
  "lost-castling-right": Object.freeze([
    "Tu rey pierde la opción de enrocar.",
    "Con este movimiento renuncias al enroque.",
  ]),
  "slow-development": Object.freeze([
    "En la apertura, esta jugada deja el desarrollo demasiado lento.",
    "Te faltó una jugada que ayudara al desarrollo.",
  ]),
  unidentified: Object.freeze([
    "La mejor alternativa conserva mejor tus opciones.",
    "La alternativa sugerida mantiene una posición más cómoda.",
  ]),
});

const CONSEQUENCE_ALTERNATIVES: Readonly<
  Record<ContextualConsequence["kind"], readonly string[]>
> = Object.freeze({
  mate: Object.freeze([
    "Después, tu rey no tiene una defensa suficiente contra el mate.",
    "La continuación del rival lleva a mate de forma forzada.",
  ]),
  "material-loss": Object.freeze([
    "Eso deja al rival una captura que gana material.",
    "La respuesta rival obtiene material de inmediato.",
  ]),
  "forcing-attack": Object.freeze([
    "Tendrás que responder al ataque del rival antes de continuar tu plan.",
    "El jaque obliga a atender primero la iniciativa rival.",
  ]),
  initiative: Object.freeze([
    "Eso da al rival una posición más fácil para continuar.",
    "El rival obtiene tiempo para mejorar sus piezas.",
  ]),
});

const PURPOSE_ALTERNATIVES: Readonly<
  Record<BestMovePurpose, readonly string[]>
> = Object.freeze({
  "avoids-mate": Object.freeze([
    "mantiene a tu rey fuera del mate",
    "corta la secuencia de mate",
  ]),
  "prevents-capture": Object.freeze([
    "quita al rival una captura directa",
    "impide que el rival gane material enseguida",
  ]),
  "defends-piece": Object.freeze([
    "deja una pieza bien protegida",
    "refuerza la defensa de una pieza",
  ]),
  "develops-piece": Object.freeze([
    "pone una pieza en juego",
    "mejora la actividad de una pieza",
  ]),
  castles: Object.freeze([
    "protege al rey al enrocar",
    "mejora la seguridad del rey con el enroque",
  ]),
  preserves: Object.freeze([
    "mantiene tus opciones en la posición",
    "evita ceder terreno sin necesidad",
  ]),
  "prepares-castling": Object.freeze([
    "acerca a tu rey al enroque",
    "deja listo el camino para enrocar",
  ]),
  "wins-material": Object.freeze([
    "crea una ganancia material",
    "aprovecha una pieza que el rival deja vulnerable",
  ]),
  "creates-check": Object.freeze([
    "obliga al rival a atender un jaque",
    "gana tiempo dando jaque",
  ]),
});

const EQUIVALENT_PREFIXES = Object.freeze([
  "Hay varias jugadas con resultado parecido.",
  "Aquí hay varias jugadas con resultado similar.",
  "Hay varias jugadas; no hay una única necesaria en esta posición.",
]);

const RECOMMENDATION_ONLY_PREFIXES = Object.freeze([
  "No hay una pérdida táctica inmediata confirmada.",
  "No se ve una táctica inmediata que explique por sí sola la diferencia.",
  "La diferencia no permite señalar una causa táctica concreta.",
]);

function variedReasonSentence(
  identity: PresentationIdentity,
  reason: ContextualReasonKind,
  slot: string,
  avoid?: number,
): { readonly text: string; readonly index: number } {
  return templateChoice(
    identity,
    slot,
    [reasonSentence(reason), ...REASON_ALTERNATIVES[reason]],
    avoid,
  );
}

function variedConsequenceSentence(
  identity: PresentationIdentity,
  consequence: ContextualConsequence,
): string {
  return templateChoice(identity, `detail:consequence:${consequence.kind}`, [
    consequenceSentence(consequence),
    ...CONSEQUENCE_ALTERNATIVES[consequence.kind],
  ]).text;
}

function variedPurposeSentence(
  identity: PresentationIdentity,
  purposes: readonly BestMovePurpose[],
  slot: string,
): string {
  const described = purposes
    .slice(0, 3)
    .map(
      (purpose, index) =>
        templateChoice(identity, `${slot}:${purpose}:${index}`, [
          purposeSentence([purpose]),
          ...PURPOSE_ALTERNATIVES[purpose],
        ]).text,
    );
  if (described.length === 0) {
    return templateChoice(identity, `${slot}:generic`, [
      "mejora la posición de forma comprobada",
      "conserva mejores opciones de forma comprobada",
      "evita ceder terreno sin una compensación clara",
    ]).text;
  }
  if (described.length === 1) return described[0]!;
  return described.length === 2
    ? `${described[0]} y ${described[1]}`
    : `${described[0]}, ${described[1]} y ${described[2]}`;
}

function makePresentation(
  before: GameSession,
  identity: PresentationIdentity,
  explanation: ContextualExplanation,
): CoachPresentation {
  return makeVariedPresentation(before, identity, explanation);
}

function makeVariedPresentation(
  before: GameSession,
  identity: PresentationIdentity,
  explanation: ContextualExplanation,
): CoachPresentation {
  const bestMove = explanation.supportingVariation[0];
  const summaryReason =
    explanation.mode === "equivalent"
      ? templateChoice(identity, "summary:equivalent", EQUIVALENT_PREFIXES)
      : explanation.mode === "recommendation-only"
        ? templateChoice(
            identity,
            "summary:recommendation-only",
            RECOMMENDATION_ONLY_PREFIXES,
          )
        : variedReasonSentence(
            identity,
            explanation.primaryReason.kind,
            "summary:reason",
          );
  const detailReason =
    explanation.mode === "equivalent"
      ? templateChoice(
          identity,
          "detail:equivalent",
          EQUIVALENT_PREFIXES,
          summaryReason.index,
        )
      : explanation.mode === "recommendation-only"
        ? templateChoice(
            identity,
            "detail:recommendation-only",
            RECOMMENDATION_ONLY_PREFIXES,
            summaryReason.index,
          )
        : variedReasonSentence(
            identity,
            explanation.primaryReason.kind,
            "detail:reason",
            summaryReason.index,
          );
  const summaryRecommendation = bestMove
    ? `${describeMove(before.fen, bestMove, "mover")} porque ${variedPurposeSentence(identity, explanation.bestMovePurposes, "summary:purpose")}`
    : "revisar una alternativa legal";
  const detailRecommendation = bestMove
    ? `${describeMove(before.fen, bestMove, "mover")} porque ${variedPurposeSentence(identity, explanation.bestMovePurposes, "detail:purpose")}`
    : "revisar las alternativas legales antes de decidir";
  const summaryLead = templateChoice(identity, "summary:recommendation-lead", [
    "Considera",
    "En su lugar, conviene",
    "La alternativa útil es",
  ]).text;
  const detailLead = templateChoice(identity, "detail:recommendation-lead", [
    "La mejor continuación era",
    "Una opción preferible era",
    "La alternativa recomendada es",
  ]).text;
  const consequence =
    explanation.mode === "explained"
      ? variedConsequenceSentence(identity, explanation.consequence)
      : "";
  const summary = `${summaryReason.text} ${summaryLead} ${summaryRecommendation}.`;
  const detail = [
    detailReason.text,
    consequence,
    `${detailLead} ${detailRecommendation}.`,
  ]
    .filter(Boolean)
    .join(" ");
  return Object.freeze({
    locale: "es",
    templateId: `turn-v6-${explanation.mode}-${explanation.primaryReason.kind}-${bestMove ? "recommendation" : "no-recommendation"}`,
    summary,
    detail:
      detail === summary
        ? `${detail} Busca una respuesta que conserve tus opciones.`
        : detail,
  });
}

function makeCopy(presentation: CoachPresentation): CoachCopy {
  return Object.freeze({
    locale: presentation.locale,
    templateId: presentation.templateId,
    text: presentation.summary,
  });
}

function makeHints(
  beforeFen: string,
  motif: MotifDetection,
  bestVariation: readonly VerifiedMove[],
): readonly CoachHint[] {
  const bestMove = bestVariation[0];
  const variationPhrases = formatVariationPhrases(
    beforeFen,
    bestVariation.slice(0, 2),
  );
  const goal =
    motif.kind === "mate" || motif.kind === "king-safety"
      ? "Busca primero la seguridad de los reyes y las respuestas forzadas."
      : motif.kind === "material" || motif.kind === "hanging-piece"
        ? "Busca capturas seguras y comprueba qué pieza queda defendida."
        : "Compara la actividad de tus piezas antes de decidir.";
  const zone = bestMove
    ? `Revisa ${formatMovePhrase(beforeFen, bestMove)}.`
    : "Revisa la pieza que moviste y las amenazas inmediatas.";
  const move = variationPhrases[0]
    ? `Prueba ${variationPhrases[0]}${variationPhrases[1] ? ` y la respuesta ${variationPhrases[1].replace(/^el /u, "").replace(/^./u, (character) => character.toUpperCase())}` : ""}.`
    : "Repite el análisis para obtener una variante legal verificable.";
  return Object.freeze([
    Object.freeze({
      level: 1,
      templateId: `hint-v2-goal-${motif.kind}`,
      text: goal,
      target: Object.freeze({ kind: "goal" }),
    }),
    Object.freeze({
      level: 2,
      templateId: `hint-v2-zone-${motif.kind}`,
      text: zone,
      target:
        bestMove === undefined
          ? Object.freeze({ kind: "piece-zone" })
          : Object.freeze({ kind: "piece-zone", move: bestMove }),
    }),
    Object.freeze({
      level: 3,
      templateId: `hint-v2-move-${motif.kind}`,
      text: move,
      target:
        bestMove === undefined
          ? Object.freeze({ kind: "move" })
          : Object.freeze({ kind: "move", move: bestMove }),
    }),
  ]);
}

/** Rebuilds visible hint text while keeping persisted SAN evidence untouched. */
export function normalizeCoachTurnRecord(
  record: CoachTurnRecord,
): CoachTurnRecord {
  try {
    const hints = makeHints(
      record.turn.beforeFen,
      record.motif,
      record.evidence.verifiedBestVariation,
    );
    return Object.freeze({ ...record, hints }) as CoachTurnRecord;
  } catch {
    return record;
  }
}

/**
 * Defensive persistence boundary for both record versions. It only accepts an
 * explanation when schema v3 actually stored one; loading v2 never invents
 * contextual chess facts from copy text.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasField(record: Record<string, unknown>, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, field);
}

function isSquare(value: unknown): value is string {
  return typeof value === "string" && /^[a-h][1-8]$/u.test(value);
}

function isVerifiedMoveValue(value: unknown): value is VerifiedMove {
  return (
    isRecord(value) &&
    typeof value.uci === "string" &&
    /^[a-h][1-8][a-h][1-8][qrbn]?$/u.test(value.uci) &&
    typeof value.san === "string"
  );
}

function isFactRef(value: unknown): value is ContextualFactRef {
  if (!isRecord(value) || typeof value.kind !== "string") return false;
  switch (value.kind) {
    case "engine-mate":
      return value.line === "before" || value.line === "after";
    case "variation-move":
      return (
        typeof value.ply === "number" &&
        Number.isInteger(value.ply) &&
        value.ply >= 0
      );
    case "piece":
    case "development":
      return isSquare(value.square);
    case "castling-right":
      return value.color === "white" || value.color === "black";
    case "multipv-equivalent":
      return true;
    default:
      return false;
  }
}

function isPrimaryReason(value: unknown): value is ContextualReason {
  const kinds: readonly ContextualReasonKind[] = [
    "allowed-mate",
    "direct-material-loss",
    "left-piece-undefended",
    "ignored-threat",
    "allowed-forcing-attack",
    "lost-castling-right",
    "slow-development",
    "unidentified",
  ];
  return (
    isRecord(value) &&
    typeof value.kind === "string" &&
    kinds.includes(value.kind as ContextualReasonKind) &&
    (value.confidence === "high" ||
      value.confidence === "medium" ||
      value.confidence === "low") &&
    Array.isArray(value.factRefs) &&
    value.factRefs.every(isFactRef)
  );
}

function isConsequence(value: unknown): value is ContextualConsequence {
  return (
    isRecord(value) &&
    (value.kind === "mate" ||
      value.kind === "material-loss" ||
      value.kind === "forcing-attack" ||
      value.kind === "initiative") &&
    Array.isArray(value.factRefs) &&
    value.factRefs.every(isFactRef)
  );
}

function isBestMovePurpose(value: unknown): value is BestMovePurpose {
  return (
    typeof value === "string" &&
    [
      "avoids-mate",
      "prevents-capture",
      "defends-piece",
      "develops-piece",
      "castles",
      "preserves",
      "prepares-castling",
      "wins-material",
      "creates-check",
    ].includes(value)
  );
}

function isContextualExplanationValue(
  value: unknown,
): value is ContextualExplanation {
  if (
    !isRecord(value) ||
    !isPrimaryReason(value.primaryReason) ||
    !Array.isArray(value.bestMovePurposes) ||
    !value.bestMovePurposes.every(isBestMovePurpose) ||
    !Array.isArray(value.supportingVariation) ||
    !value.supportingVariation.every(isVerifiedMoveValue)
  )
    return false;
  const reason = value.primaryReason;
  if (value.mode === "explained") {
    return (
      reason.kind !== "unidentified" &&
      hasField(value, "consequence") &&
      isConsequence(value.consequence)
    );
  }
  if (value.mode === "recommendation-only") {
    return (
      !hasField(value, "consequence") &&
      reason.kind === "unidentified" &&
      reason.confidence === "low" &&
      reason.factRefs.length === 0
    );
  }
  return (
    value.mode === "equivalent" &&
    !hasField(value, "consequence") &&
    reason.kind === "unidentified" &&
    reason.confidence === "medium" &&
    reason.factRefs.length === 1 &&
    reason.factRefs[0]?.kind === "multipv-equivalent"
  );
}

function isPresentation(value: unknown): value is CoachPresentation {
  return (
    isRecord(value) &&
    value.locale === "es" &&
    typeof value.templateId === "string" &&
    typeof value.summary === "string" &&
    typeof value.detail === "string" &&
    value.summary !== value.detail
  );
}

export function decodeCoachTurnRecord(
  value: unknown,
): CoachTurnRecord | undefined {
  if (!isRecord(value)) return undefined;
  const candidate = value;
  if (
    (candidate.schemaVersion !== 2 && candidate.schemaVersion !== 3) ||
    !isRecord(candidate.turn) ||
    !isRecord(candidate.evidence) ||
    !isRecord(candidate.motif) ||
    !Array.isArray(candidate.hints)
  )
    return undefined;
  if (candidate.schemaVersion === 2) {
    if (
      hasField(candidate, "explanation") ||
      hasField(candidate, "presentation")
    )
      return undefined;
  } else if (candidate.explanation === undefined) {
    if (candidate.presentation !== undefined) return undefined;
  } else {
    const explanation = candidate.explanation;
    if (
      !isContextualExplanationValue(explanation) ||
      !isPresentation(candidate.presentation)
    )
      return undefined;
    if (typeof candidate.turn.beforeFen !== "string") return undefined;
    const legalVariation = verifiedVariation(
      candidate.turn.beforeFen,
      explanation.supportingVariation.map((move) => move.uci),
    );
    if (
      !legalVariation.complete ||
      legalVariation.moves.length !== explanation.supportingVariation.length ||
      legalVariation.moves.some(
        (move, index) =>
          move.uci !== explanation.supportingVariation[index]?.uci ||
          move.san !== explanation.supportingVariation[index]?.san,
      )
    )
      return undefined;
  }
  return normalizeCoachTurnRecord(candidate as unknown as CoachTurnRecord);
}

export function analyzeTurn(
  before: GameSession,
  after: GameSession,
  beforeLine: EngineLine,
  afterLine: EngineLine,
  options: AnalyzeTurnOptions = {},
): CoachTurnRecord {
  const played = after.history.at(-1);
  if (!played) throw new RangeError("A played move is required");
  const actor = options.actor ?? "user";
  const perspective = options.perspective ?? before.turn;
  const playedMoveLegal = listLegalMoves(before.fen).some(
    (move) => move.uci === played.uci,
  );
  if (!playedMoveLegal)
    throw new RangeError("The played move is not legal in the before position");

  const beforeLines = Object.freeze([
    ...(options.beforeLines?.length ? options.beforeLines : [beforeLine]),
  ]);
  const afterLines = Object.freeze([
    ...(options.afterLines?.length ? options.afterLines : [afterLine]),
  ]);
  const variation = verifiedVariation(before.fen, beforeLine.moves);
  const afterVariation = verifiedVariation(after.fen, afterLine.moves);
  const bestMove = variation.moves[0];
  const assessment = assessTurn(before, after, beforeLine, afterLine, options);
  const motif = detectMotif(
    before,
    after,
    played,
    assessment,
    variation.moves,
    afterVariation.moves,
    beforeLines,
  );
  const explanation =
    assessment === undefined
      ? undefined
      : contextualExplanation(
          before,
          after,
          played,
          assessment,
          variation.moves,
          afterVariation.moves,
          beforeLines,
        );
  const presentation =
    explanation === undefined
      ? undefined
      : makePresentation(
          before,
          Object.freeze({
            ply: after.history.length,
            actor,
            playedUci: played.uci,
            beforeFen: before.fen,
            afterFen: after.fen,
            perspective,
          }),
          explanation,
        );
  const copy = presentation === undefined ? undefined : makeCopy(presentation);
  const hints =
    assessment === undefined
      ? Object.freeze([])
      : makeHints(before.fen, motif, variation.moves);

  return Object.freeze({
    schemaVersion: 3,
    turn: Object.freeze({
      ply: after.history.length,
      actor,
      playedUci: played.uci,
      playedSan: played.san,
      beforeFen: before.fen,
      afterFen: after.fen,
      perspective,
    }),
    evidence: Object.freeze({
      before: beforeLine,
      after: afterLine,
      perspective,
      playedUci: played.uci,
      ...(bestMove === undefined ? {} : { bestMove }),
      ...(bestMove === undefined || bestMove.uci === played.uci
        ? {}
        : { alternativeMove: bestMove }),
      verifiedBestVariation: variation.moves,
      beforeLines,
      afterLines,
      validation: Object.freeze({
        playedMoveLegal,
        bestLineFullyLegal: variation.complete,
      }),
    }),
    ...(assessment === undefined ? {} : { assessment }),
    motif,
    ...(explanation === undefined ? {} : { explanation }),
    ...(presentation === undefined ? {} : { presentation }),
    ...(copy === undefined ? {} : { copy }),
    hints,
  });
}

/** @deprecated Use analyzeTurn and render record.copy/hints directly. */
export function analyzeMove(
  before: GameSession,
  after: GameSession,
  beforeLine: EngineLine,
  afterLine: EngineLine,
): CoachFeedback {
  const record = analyzeTurn(before, after, beforeLine, afterLine);
  const assessment = record.assessment;
  const copy = record.copy;
  if (!assessment || !copy)
    throw new RangeError("User coaching assessment is required");
  const hints = Object.freeze({
    1: record.hints.find((hint) => hint.level === 1)?.text ?? "",
    2: record.hints.find((hint) => hint.level === 2)?.text ?? "",
    3: record.hints.find((hint) => hint.level === 3)?.text ?? "",
  });
  return Object.freeze({
    record,
    label: assessment.label,
    loss: assessment.expectedLoss,
    evidence: Object.freeze({
      before: beforeLine.score,
      after: afterLine.score,
      bestLine: beforeLine,
      playedUci: record.turn.playedUci,
      perspective: before.turn,
    }),
    motif: record.motif.kind,
    explanation: copy.text,
    hints,
    ...(record.evidence.alternativeMove === undefined
      ? {}
      : { alternativeUci: record.evidence.alternativeMove.uci }),
    isEstimated: assessment.isEstimated,
  });
}

/** Compatibility helper. New UIs should apply their reveal state to record.hints. */
export function hintForLevel(
  feedback: CoachFeedback,
  level: HintLevel,
  help: HelpLevel,
): string | undefined {
  if (help === "none") return undefined;
  const allowedLevel =
    help === "guided" ? level : (Math.min(level, 1) as HintLevel);
  return feedback.hints[allowedLevel];
}
