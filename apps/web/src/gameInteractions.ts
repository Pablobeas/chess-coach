import type {
  GameSession,
  PieceType,
  PlayerColor,
} from "@chess-coach/chess-core";
import { boardForFen, type Square } from "./localGame";

export const ENGINE_RESPONSE_DELAY_MS = 500;
export const PIECE_MOVE_DURATION_MS = 250;

export type OpponentMoveHighlight = {
  readonly from: Square;
  readonly to: Square;
};

export type OpponentMoveSquareRole = "from" | "to" | undefined;

/**
 * Keeps the opponent's last move visible only while it is the player's turn.
 * This is derived from the visible session, so undo/redo and line changes can
 * never retain a highlight from another position.
 */
export function opponentLastMoveHighlight(
  position: Pick<GameSession, "history" | "initialFen">,
  playerColor: PlayerColor,
): OpponentMoveHighlight | undefined {
  const moveIndex = position.history.length - 1;
  const move = position.history[moveIndex];
  if (!move) return undefined;

  const initialTurn: PlayerColor =
    position.initialFen.split(" ")[1] === "w" ? "white" : "black";
  const lastMoveColor =
    moveIndex % 2 === 0
      ? initialTurn
      : initialTurn === "white"
        ? "black"
        : "white";
  if (lastMoveColor === playerColor) return undefined;

  return { from: move.from as Square, to: move.to as Square };
}

export function opponentMoveSquareRole(
  square: Square,
  highlight: OpponentMoveHighlight | undefined,
): OpponentMoveSquareRole {
  if (highlight?.from === square) return "from";
  if (highlight?.to === square) return "to";
  return undefined;
}

export function opponentMoveSquareAccessibilityLabel(
  role: OpponentMoveSquareRole,
): string {
  if (role === "from") return ", origen de la última jugada rival";
  if (role === "to") return ", destino de la última jugada rival";
  return "";
}

export type AnimatedPiece = {
  readonly piece: { readonly color: PlayerColor; readonly type: PieceType };
  readonly from: Square;
  readonly to: Square;
};
export type MoveAnimation = {
  readonly pieces: readonly AnimatedPiece[];
  readonly captured?: AnimatedPiece["piece"];
  readonly captureSquare?: Square;
};

export function createMoveAnimation(
  position: GameSession,
  from: Square,
  to: Square,
): MoveAnimation | undefined {
  const positionBoard = boardForFen(position.fen);
  const piece = positionBoard.get(from);
  if (!piece) return undefined;
  const pieces: AnimatedPiece[] = [{ piece, from, to }];
  if (
    piece.type === "k" &&
    Math.abs(from.charCodeAt(0) - to.charCodeAt(0)) === 2
  ) {
    const rank = from[1];
    const kingSide = to[0] === "g";
    const rookFrom = `${kingSide ? "h" : "a"}${rank}` as Square;
    const rookTo = `${kingSide ? "f" : "d"}${rank}` as Square;
    const rook = positionBoard.get(rookFrom);
    if (rook) pieces.push({ piece: rook, from: rookFrom, to: rookTo });
  }
  const enPassantSquare =
    piece.type === "p" && from[0] !== to[0] && !positionBoard.has(to)
      ? (`${to[0]}${from[1]}` as Square)
      : undefined;
  const captureSquare = positionBoard.has(to) ? to : enPassantSquare;
  const captured = captureSquare ? positionBoard.get(captureSquare) : undefined;
  return {
    pieces,
    ...(captured && captureSquare ? { captured, captureSquare } : {}),
  };
}

export function waitForDelay(
  milliseconds: number,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted)
    return Promise.reject(new DOMException("Aborted", "AbortError"));
  if (milliseconds <= 0) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const timer = globalThis.setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, milliseconds);
    const abort = () => {
      globalThis.clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", abort, { once: true });
  });
}

export function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== "object") return false;
  const candidate = target as EventTarget & {
    readonly isContentEditable?: boolean;
    readonly tagName?: string;
    readonly getAttribute?: (name: string) => string | null;
  };
  return (
    candidate.isContentEditable === true ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(candidate.tagName ?? "") ||
    candidate.getAttribute?.("contenteditable") === "true"
  );
}
