import type { MoveLabel } from "@chess-coach/coach";
import type { PlayerColor } from "@chess-coach/chess-core";
import type { MoveQualityAnnotation } from "./persistence";

export const MINIMUM_PROVISIONAL_QUALITY_DEPTH = 6;

export interface DisplayedMoveQualityAnnotation extends MoveQualityAnnotation {
  readonly depth?: number;
  readonly provisional?: true;
}

export interface ProvisionalMoveQualityAnnotation extends DisplayedMoveQualityAnnotation {
  readonly depth: number;
  readonly provisional: true;
}

export function updateProvisionalMoveQuality(
  current: ProvisionalMoveQualityAnnotation | undefined,
  next: {
    readonly historyIndex: number;
    readonly uci: string;
    readonly label: MoveLabel;
    readonly depth: number;
  },
): ProvisionalMoveQualityAnnotation | undefined {
  if (next.depth < MINIMUM_PROVISIONAL_QUALITY_DEPTH) return current;
  if (
    current?.historyIndex === next.historyIndex &&
    current.uci === next.uci &&
    (current.depth > next.depth || current.label === next.label)
  )
    return current;
  return Object.freeze({ ...next, provisional: true as const });
}

export function visibleMoveQualityAnnotations(
  completed: readonly MoveQualityAnnotation[],
  provisional: ProvisionalMoveQualityAnnotation | undefined,
  visibleHistory: readonly { readonly uci: string }[],
): readonly DisplayedMoveQualityAnnotation[] {
  if (
    provisional === undefined ||
    visibleHistory[provisional.historyIndex]?.uci !== provisional.uci ||
    completed.some(
      (annotation) =>
        annotation.historyIndex === provisional.historyIndex &&
        annotation.uci === provisional.uci,
    )
  )
    return completed;
  return [...completed, provisional];
}

export function boardMoveQualityAnnotation(
  annotations: readonly DisplayedMoveQualityAnnotation[],
  visibleHistory: readonly { readonly uci: string }[],
  playerColor: PlayerColor,
  initialTurn: PlayerColor,
): DisplayedMoveQualityAnnotation | undefined {
  for (
    let historyIndex = visibleHistory.length - 1;
    historyIndex >= 0;
    --historyIndex
  ) {
    const moveColor =
      historyIndex % 2 === 0
        ? initialTurn
        : initialTurn === "white"
          ? "black"
          : "white";
    if (moveColor !== playerColor) continue;

    const move = visibleHistory[historyIndex];
    return annotations.find(
      (annotation) =>
        annotation.historyIndex === historyIndex &&
        annotation.uci === move?.uci,
    );
  }
  return undefined;
}
