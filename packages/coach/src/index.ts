export const coachReadiness = "Contratos listos";

export type MoveLabel =
  "excellent" | "good" | "inaccuracy" | "mistake" | "blunder";

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
