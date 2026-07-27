export const TRAINING_STORAGE_KEY = "chess-coach:training:v1";

export interface TrainingProgressV1 {
  readonly schemaVersion: 1;
  readonly completedPuzzleIds: readonly string[];
  readonly lastPuzzleId?: string;
  readonly lastOpeningId?: string;
}

export const EMPTY_TRAINING_PROGRESS: TrainingProgressV1 = Object.freeze({
  schemaVersion: 1,
  completedPuzzleIds: Object.freeze([]),
});

export function loadTrainingProgress(
  storage: Storage | undefined = typeof localStorage === "undefined"
    ? undefined
    : localStorage,
): TrainingProgressV1 {
  try {
    const parsed: unknown = JSON.parse(
      storage?.getItem(TRAINING_STORAGE_KEY) ?? "null",
    );
    if (!parsed || typeof parsed !== "object") return EMPTY_TRAINING_PROGRESS;
    const value = parsed as Partial<TrainingProgressV1>;
    if (
      value.schemaVersion !== 1 ||
      !Array.isArray(value.completedPuzzleIds) ||
      !value.completedPuzzleIds.every((id) => typeof id === "string")
    )
      return EMPTY_TRAINING_PROGRESS;
    return Object.freeze({
      schemaVersion: 1,
      completedPuzzleIds: Object.freeze([...value.completedPuzzleIds]),
      ...(typeof value.lastPuzzleId === "string"
        ? { lastPuzzleId: value.lastPuzzleId }
        : {}),
      ...(typeof value.lastOpeningId === "string"
        ? { lastOpeningId: value.lastOpeningId }
        : {}),
    });
  } catch {
    return EMPTY_TRAINING_PROGRESS;
  }
}

export function saveTrainingProgress(
  progress: TrainingProgressV1,
  storage: Storage | undefined = typeof localStorage === "undefined"
    ? undefined
    : localStorage,
): void {
  try {
    storage?.setItem(TRAINING_STORAGE_KEY, JSON.stringify(progress));
  } catch {
    /* Private mode and full storage are non-fatal. */
  }
}
