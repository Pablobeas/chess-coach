import type {
  GameSession,
  PieceType,
  PlayerColor,
} from "@chess-coach/chess-core";
import { boardForFen, type Square } from "./localGame";

export const ENGINE_RESPONSE_DELAY_MS = 0;
export const PIECE_MOVE_DURATION_MS = 250;

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
