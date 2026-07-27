import { Chess } from "chess.js";

import {
  applyMove,
  IllegalMoveError,
  InvalidFenError,
  listLegalMoves,
  loadPosition,
  replayHistory,
  type GameSession,
  type MoveInput,
  type PromotionPiece,
  type ReplayedHistoryEntry,
} from "./index";

declare const positionKeyBrand: unique symbol;

export type PositionKey = string & {
  readonly [positionKeyBrand]: "PositionKey";
};

export interface UciLineReplay {
  readonly initialFen: string;
  readonly finalFen: string;
  readonly session: GameSession;
  readonly history: readonly ReplayedHistoryEntry[];
  readonly positionKeys: readonly PositionKey[];
}

export type ReplayUciLineResult = UciLineReplay;

export class InvalidUciMoveError extends Error {
  constructor(uci: string) {
    super(`Invalid UCI move: ${uci}`);
    this.name = "InvalidUciMoveError";
  }
}

const UCI_MOVE_PATTERN = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/;

function createChess(fen: string): Chess {
  try {
    return new Chess(fen);
  } catch {
    throw new InvalidFenError(fen);
  }
}

function parseUciMove(uci: string): MoveInput {
  const match = UCI_MOVE_PATTERN.exec(uci);
  if (!match) {
    throw new InvalidUciMoveError(uci);
  }

  const promotion = match[3] as PromotionPiece | undefined;

  return {
    from: match[1]!,
    to: match[2]!,
    ...(promotion === undefined ? {} : { promotion }),
  };
}

function freezePositionKeys(
  initialFen: string,
  history: readonly ReplayedHistoryEntry[],
): readonly PositionKey[] {
  return Object.freeze([
    positionKeyForFen(initialFen),
    ...history.map((entry) => positionKeyForFen(entry.afterFen)),
  ]);
}

export function positionKeyForFen(fen: string): PositionKey {
  const [board, turn, castling, enPassant] = createChess(fen).fen().split(" ");

  return `${board} ${turn} ${castling} ${enPassant}` as PositionKey;
}

export function applyUciMove(session: GameSession, uci: string): GameSession {
  const parsed = parseUciMove(uci);
  const legalMove = listLegalMoves(session.fen).find(
    (candidate) => candidate.uci === uci,
  );

  if (!legalMove) {
    throw new IllegalMoveError(parsed);
  }

  return applyMove(
    session,
    legalMove.promotion === undefined
      ? parsed
      : {
          from: parsed.from,
          to: parsed.to,
          promotion: legalMove.promotion,
        },
  );
}

export function replayUciLine(
  initialFen: string,
  moves: readonly string[],
): UciLineReplay {
  let session = loadPosition(initialFen);

  for (const move of moves) {
    session = applyUciMove(session, move);
  }

  const history = replayHistory(session);

  return Object.freeze({
    initialFen,
    finalFen: session.fen,
    session,
    history,
    positionKeys: freezePositionKeys(initialFen, history),
  });
}
