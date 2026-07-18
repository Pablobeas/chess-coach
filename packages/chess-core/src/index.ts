import { Chess } from "chess.js";

export type PlayerColor = "white" | "black";

export interface GameSnapshot {
  readonly fen: string;
  readonly pgn: string;
  readonly turn: PlayerColor;
  readonly isGameOver: boolean;
}

function snapshot(game: Chess): GameSnapshot {
  return {
    fen: game.fen(),
    pgn: game.pgn(),
    turn: game.turn() === "w" ? "white" : "black",
    isGameOver: game.isGameOver(),
  };
}

export function createInitialGame(): GameSnapshot {
  return snapshot(new Chess());
}

export function loadPosition(fen: string): GameSnapshot {
  return snapshot(new Chess(fen));
}
