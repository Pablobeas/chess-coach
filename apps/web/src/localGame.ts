import {
  applyMove,
  listLegalMoves,
  undoLastMove,
  type GameSession,
  type PlayerColor,
  type PieceType,
} from "@chess-coach/chess-core";

export type Square =
  `${"a" | "b" | "c" | "d" | "e" | "f" | "g" | "h"}${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8}`;
export type Piece = { readonly color: PlayerColor; readonly type: PieceType };

const files = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;
const ranks = [8, 7, 6, 5, 4, 3, 2, 1] as const;

function squareAt(file: number, rank: number): Square | undefined {
  return file < 0 || file > 7 || rank < 1 || rank > 8
    ? undefined
    : (`${files[file]}${rank}` as Square);
}

export function boardForFen(fen: string): ReadonlyMap<Square, Piece> {
  const board = new Map<Square, Piece>();
  (fen.split(" ")[0]?.split("/") ?? []).forEach((row, rowIndex) => {
    let file = 0;
    for (const symbol of row) {
      if (/\d/.test(symbol)) {
        file += Number(symbol);
        continue;
      }
      const square = squareAt(file, 8 - rowIndex);
      if (square)
        board.set(square, {
          color: symbol === symbol.toUpperCase() ? "white" : "black",
          type: symbol.toLowerCase() as PieceType,
        });
      file += 1;
    }
  });
  return board;
}

export const boardSquares = ranks.flatMap((rank) =>
  files.map((file) => `${file}${rank}` as Square),
);
export const boardRows = ranks.map((rank) =>
  files.map((file) => `${file}${rank}` as Square),
);
export const createLocalGame = (game: GameSession) => game;
export const legalDestinations = (game: GameSession, from: Square) =>
  listLegalMoves(game.fen)
    .filter((move) => move.from === from)
    .map((move) => move.to as Square);
export const playMove = (game: GameSession, from: Square, to: Square) =>
  applyMove(game, {
    from,
    to,
    ...(to[1] === "1" || to[1] === "8" ? { promotion: "q" as const } : {}),
  });
export const playUciMove = (game: GameSession, uci: string) => {
  const from = uci.slice(0, 2) as Square;
  const to = uci.slice(2, 4) as Square;
  const legalMove = listLegalMoves(game.fen).find((move) => move.uci === uci);
  if (!legalMove) throw new Error(`Illegal engine move: ${uci}`);
  return applyMove(game, {
    from,
    to,
    ...(legalMove.promotion === undefined
      ? {}
      : { promotion: legalMove.promotion }),
  });
};
export const undoMove = (game: GameSession) => undoLastMove(game);
