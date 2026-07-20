import {
  formatMoveReference,
  replayHistory,
  type GameSession,
  type PlayerColor,
} from "@chess-coach/chess-core";

export interface HistoryPly {
  readonly historyIndex: number;
  readonly color: PlayerColor;
  readonly beforeFen: string;
  readonly move: GameSession["history"][number];
  /** Preformatted during the history replay to avoid chess work while rendering. */
  readonly display: string;
}

export interface HistoryMoveGroup {
  readonly moveNumber: number;
  readonly white?: HistoryPly;
  readonly black?: HistoryPly;
}

export function groupMoveHistory(
  session: GameSession,
): readonly HistoryMoveGroup[] {
  const fenFields = session.initialFen.split(/\s+/);
  let color: PlayerColor = fenFields[1] === "b" ? "black" : "white";
  let moveNumber = Number(fenFields[5]);
  if (!Number.isInteger(moveNumber) || moveNumber < 1) moveNumber = 1;

  const groups: HistoryMoveGroup[] = [];
  for (const entry of replayHistory(session)) {
    const ply: HistoryPly = {
      historyIndex: entry.historyIndex,
      color,
      beforeFen: entry.beforeFen,
      move: entry.move,
      display: formatMoveReference(entry.beforeFen, entry.move),
    };
    const previous = groups.at(-1);
    if (!previous || previous.moveNumber !== moveNumber) {
      groups.push(
        color === "white"
          ? { moveNumber, white: ply }
          : { moveNumber, black: ply },
      );
    } else if (color === "white") {
      groups[groups.length - 1] = { ...previous, white: ply };
    } else {
      groups[groups.length - 1] = { ...previous, black: ply };
    }
    if (color === "black") moveNumber += 1;
    color = color === "white" ? "black" : "white";
  }
  return Object.freeze(groups);
}
