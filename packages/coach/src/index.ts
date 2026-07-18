import type { GameSession } from "@chess-coach/chess-core";
import type { EngineLine, EngineScore } from "@chess-coach/engine";

export type MoveLabel =
  "excellent" | "good" | "inaccuracy" | "mistake" | "blunder";
export type HintLevel = 1 | 2 | 3;
export type HelpLevel = "none" | "normal" | "guided";

export interface EvaluationEvidence {
  readonly before: EngineScore;
  readonly after: EngineScore;
  readonly bestLine: EngineLine;
  readonly playedUci: string;
  readonly perspective: "white" | "black";
  readonly expectedScoreBefore?: number;
  readonly expectedScoreAfter?: number;
}

export interface CoachFeedback {
  readonly label: MoveLabel;
  readonly loss: number;
  readonly evidence: EvaluationEvidence;
  readonly motif:
    "material" | "tactical" | "king-safety" | "development" | "none";
  readonly explanation: string;
  readonly hints: Readonly<Record<HintLevel, string>>;
  readonly alternativeUci?: string;
  readonly isEstimated: boolean;
}

export function expectedScoreFromWdl(
  wins: number,
  draws: number,
  losses: number,
): number {
  const total = wins + draws + losses;

  if (!Number.isFinite(total) || total <= 0) {
    throw new RangeError("WDL total must be a positive finite number");
  }

  if (
    [wins, draws, losses].some((value) => value < 0 || !Number.isFinite(value))
  ) {
    throw new RangeError("WDL values must be non-negative finite numbers");
  }

  return (wins + 0.5 * draws) / total;
}

export function expectedScoreFromCentipawns(value: number): number {
  if (!Number.isFinite(value)) throw new RangeError("Score must be finite");
  return 1 / (1 + Math.exp(-value / 400));
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

export function classifyMove(loss: number): MoveLabel {
  if (!Number.isFinite(loss) || loss < 0) throw new RangeError("Invalid loss");
  if (loss < 0.015) return "excellent";
  if (loss < 0.05) return "good";
  if (loss < 0.12) return "inaccuracy";
  if (loss < 0.25) return "mistake";
  return "blunder";
}

function moveText(uci: string): string {
  return `${uci.slice(0, 2)}–${uci.slice(2, 4)}`;
}

function selectMotif(
  label: MoveLabel,
  playedUci: string,
): CoachFeedback["motif"] {
  if (label === "blunder" || label === "mistake") return "tactical";
  if (playedUci[1] === "2" || playedUci[1] === "7") return "development";
  return "none";
}

export function analyzeMove(
  before: GameSession,
  after: GameSession,
  beforeLine: EngineLine,
  afterLine: EngineLine,
): CoachFeedback {
  const playedUci = after.history.at(-1)?.uci;
  if (!playedUci) throw new RangeError("A played move is required");
  const best = scoreToExpectedScore(beforeLine.score);
  const played = scoreToExpectedScore(afterLine.score);
  const loss = expectedLoss(best, played);
  const label = classifyMove(loss);
  const motif = selectMotif(label, playedUci);
  const alternativeUci = beforeLine.moves[0];
  const alternativeText = alternativeUci
    ? moveText(alternativeUci)
    : "la mejor línea";

  return Object.freeze({
    label,
    loss,
    evidence: Object.freeze({
      before: beforeLine.score,
      after: afterLine.score,
      bestLine: beforeLine,
      playedUci,
      perspective: before.turn,
    }),
    motif,
    explanation:
      label === "excellent"
        ? "Tu jugada mantiene la ventaja y sigue una idea coherente."
        : `La posición cambia más de lo necesario. La alternativa ${alternativeText} conserva mejor el resultado esperado.`,
    hints: Object.freeze({
      1: "Busca una mejora que conserve la seguridad de tu rey y la actividad de tus piezas.",
      2: `Revisa la zona relacionada con ${moveText(playedUci)} y compara las amenazas inmediatas.`,
      3: alternativeUci
        ? `Prueba ${alternativeText} y observa la variante principal.`
        : "Compara tu jugada con la primera variante del motor.",
    }),
    ...(alternativeUci === undefined ? {} : { alternativeUci }),
    isEstimated:
      beforeLine.score.kind === "centipawns" ||
      afterLine.score.kind === "centipawns",
  });
}

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

export const coachReadiness = "Deterministic coach pipeline ready";
