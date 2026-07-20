import type { PlayerColor } from "@chess-coach/chess-core";
import type { CSSProperties } from "react";
import { boardRows, type Square } from "./localGame";

export type BoardPoint = { readonly x: number; readonly y: number };
export type SquareOffset = { readonly left: string; readonly top: string };

export function orientedBoardRows(
  playerColor: PlayerColor,
): readonly (readonly Square[])[] {
  return playerColor === "white"
    ? boardRows
    : boardRows
        .slice()
        .reverse()
        .map((row) => row.slice().reverse());
}

export function squarePoint(
  square: Square,
  playerColor: PlayerColor,
): BoardPoint {
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square[1]);
  return playerColor === "white"
    ? { x: file + 0.5, y: 8 - rank + 0.5 }
    : { x: 7 - file + 0.5, y: rank - 1 + 0.5 };
}

export function squareOffset(
  square: Square,
  playerColor: PlayerColor,
): SquareOffset {
  const point = squarePoint(square, playerColor);
  return {
    left: `${(point.x - 0.5) * 12.5}%`,
    top: `${(point.y - 0.5) * 12.5}%`,
  };
}

export function visualMoveOffset(
  from: Square,
  to: Square,
  playerColor: PlayerColor,
): CSSProperties {
  const start = squarePoint(from, playerColor);
  const end = squarePoint(to, playerColor);
  return {
    "--move-x": `${(end.x - start.x) * 100}%`,
    "--move-y": `${(end.y - start.y) * 100}%`,
  } as CSSProperties;
}
