import {
  applyMove,
  formatMovePhrase,
  listLegalMoves,
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
export interface CoachTurnRecord {
  readonly schemaVersion: 2;
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
  readonly copy?: CoachCopy;
  readonly hints: readonly CoachHint[];
}

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
  if (assessment?.context.mateLost || after.isCheckmate) {
    kind = "mate";
    confidence = "high";
    evidence.push("mate-score-or-board-state");
  } else if (facts.some((fact) => fact.kind === "check")) {
    kind = "king-safety";
    confidence = "high";
  } else if (facts.some((fact) => fact.kind === "hanging-piece")) {
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

function makeCopy(
  before: GameSession,
  played: MoveRecord,
  assessment: MoveAssessment,
  motif: MotifDetection,
  bestMove: VerifiedMove | undefined,
): CoachCopy {
  const uncertainty = assessment.isEstimated ? " (estimación)" : "";
  const bestStatus =
    bestMove === undefined
      ? "unverified"
      : bestMove.uci === played.uci
        ? "played"
        : "alternative";
  const playedBestButNegative =
    bestMove?.uci === played.uci && mustAvoidBestClaim(assessment);
  const text =
    bestMove === undefined
      ? `Sin una PV legal verificable, no hay una mejor jugada que mostrar${uncertainty}.`
      : playedBestButNegative
        ? `${labelCopy(assessment.label)}${uncertainty}: ${compactReason(assessment, motif, bestMove, played)}. La línea validada empieza con ${describeMove(before.fen, bestMove, "mover")}.`
        : bestMove.uci === played.uci
          ? `Es la mejor jugada${uncertainty}: ${describeMove(before.fen, bestMove, "mover")}. ${compactReason(assessment, motif, bestMove, played)}.`
          : `${labelCopy(assessment.label)}${uncertainty}: ${compactReason(assessment, motif, bestMove, played)}. Mejor: ${describeMove(before.fen, bestMove, "mover")}.`;
  return Object.freeze({
    locale: "es",
    templateId: `turn-v5-${assessment.label}-${motif.kind}-${bestStatus}`,
    text,
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
    return Object.freeze({ ...record, hints });
  } catch {
    return record;
  }
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
  const copy =
    assessment === undefined
      ? undefined
      : makeCopy(before, played, assessment, motif, bestMove);
  const hints =
    assessment === undefined
      ? Object.freeze([])
      : makeHints(before.fen, motif, variation.moves);

  return Object.freeze({
    schemaVersion: 2,
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
