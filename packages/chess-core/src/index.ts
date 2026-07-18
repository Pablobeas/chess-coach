import { Chess, type PieceSymbol } from "chess.js";

export type PlayerColor = "white" | "black";
export type PromotionPiece = "q" | "r" | "b" | "n";
export type PieceType = PieceSymbol;

export interface MoveInput {
  readonly from: string;
  readonly to: string;
  readonly promotion?: PromotionPiece;
}

export interface MoveRecord extends MoveInput {
  readonly san: string;
  readonly uci: string;
}

export interface CaptureRecord {
  readonly historyIndex: number;
  readonly capturer: PlayerColor;
  readonly piece: {
    readonly color: PlayerColor;
    readonly type: PieceType;
  };
}

export interface GameSnapshot {
  readonly fen: string;
  readonly pgn: string;
  readonly turn: PlayerColor;
  readonly isGameOver: boolean;
  readonly isCheck: boolean;
  readonly isCheckmate: boolean;
}

export interface GameSession extends GameSnapshot {
  readonly initialFen: string;
  readonly history: readonly MoveRecord[];
}

export class InvalidFenError extends Error {
  constructor(fen: string) {
    super(`Invalid FEN: ${fen}`);
    this.name = "InvalidFenError";
  }
}

export class IllegalMoveError extends Error {
  constructor(move: MoveInput) {
    super(`Illegal move: ${formatMove(move)}`);
    this.name = "IllegalMoveError";
  }
}

export class InvalidGameSessionError extends Error {
  constructor() {
    super("The game session history does not reproduce its current position");
    this.name = "InvalidGameSessionError";
  }
}

const SQUARE_PATTERN = /^[a-h][1-8]$/;

function formatMove(move: MoveInput): string {
  return `${move.from}${move.to}${move.promotion ?? ""}`;
}

function createChess(fen: string): Chess {
  try {
    return new Chess(fen);
  } catch {
    throw new InvalidFenError(fen);
  }
}

function toPlayerColor(turn: "w" | "b"): PlayerColor {
  return turn === "w" ? "white" : "black";
}

function toMoveRecord(move: {
  readonly from: string;
  readonly to: string;
  readonly promotion?: PieceSymbol;
  readonly san: string;
  readonly lan: string;
}): MoveRecord {
  const promotion = move.promotion as PromotionPiece | undefined;

  return Object.freeze({
    from: move.from,
    to: move.to,
    ...(promotion === undefined ? {} : { promotion }),
    san: move.san,
    uci: move.lan,
  });
}

function snapshot(game: Chess): GameSnapshot {
  return Object.freeze({
    fen: game.fen(),
    pgn: game.pgn(),
    turn: toPlayerColor(game.turn()),
    isGameOver: game.isGameOver(),
    isCheck: game.isCheck(),
    isCheckmate: game.isCheckmate(),
  });
}

function createSession(
  game: Chess,
  initialFen: string,
  history: readonly MoveRecord[],
): GameSession {
  return Object.freeze({
    ...snapshot(game),
    initialFen,
    history: Object.freeze([...history]),
  });
}

function replay(session: GameSession): Chess {
  const game = createChess(session.initialFen);

  for (const move of session.history) {
    try {
      game.move({
        from: move.from,
        to: move.to,
        ...(move.promotion === undefined ? {} : { promotion: move.promotion }),
      });
    } catch {
      throw new InvalidGameSessionError();
    }
  }

  if (game.fen() !== session.fen || game.pgn() !== session.pgn) {
    throw new InvalidGameSessionError();
  }

  return game;
}

function assertMoveInput(move: MoveInput): void {
  if (
    !SQUARE_PATTERN.test(move.from) ||
    !SQUARE_PATTERN.test(move.to) ||
    (move.promotion !== undefined &&
      !(["q", "r", "b", "n"] as const).includes(move.promotion))
  ) {
    throw new IllegalMoveError(move);
  }
}

export function createInitialGame(): GameSession {
  const game = new Chess();
  return createSession(game, game.fen(), []);
}

export function loadPosition(fen: string): GameSession {
  return createSession(createChess(fen), fen, []);
}

export function restoreSession(session: GameSession): GameSession {
  return createSession(replay(session), session.initialFen, session.history);
}

export function loadPgn(pgn: string): GameSession {
  const game = new Chess();
  try {
    game.loadPgn(pgn);
  } catch {
    throw new InvalidGameSessionError();
  }
  const history = game
    .history({ verbose: true })
    .map((move) => toMoveRecord(move));
  const initialFen = new Chess().fen();
  return createSession(game, initialFen, history);
}

export function applyMove(session: GameSession, move: MoveInput): GameSession {
  assertMoveInput(move);
  const game = replay(session);

  try {
    const appliedMove = game.move({
      from: move.from,
      to: move.to,
      ...(move.promotion === undefined ? {} : { promotion: move.promotion }),
    });

    return createSession(game, session.initialFen, [
      ...session.history,
      toMoveRecord(appliedMove),
    ]);
  } catch {
    throw new IllegalMoveError(move);
  }
}

export function undoLastMove(session: GameSession): GameSession {
  const game = replay(session);

  if (session.history.length === 0) {
    return session;
  }

  const history = session.history.slice(0, -1);
  game.undo();

  return createSession(game, session.initialFen, history);
}

export function listLegalMoves(fen: string): readonly MoveRecord[] {
  const game = createChess(fen);

  return Object.freeze(
    game.moves({ verbose: true }).map((move) => toMoveRecord(move)),
  );
}

export function listCaptures(session: GameSession): readonly CaptureRecord[] {
  const game = createChess(session.initialFen);
  const captures: CaptureRecord[] = [];

  session.history.forEach((move, historyIndex) => {
    const capturer = toPlayerColor(game.turn());
    const appliedMove = game.move({
      from: move.from,
      to: move.to,
      ...(move.promotion === undefined ? {} : { promotion: move.promotion }),
    });

    if (appliedMove.captured !== undefined) {
      captures.push({
        historyIndex,
        capturer,
        piece: {
          color: capturer === "white" ? "black" : "white",
          type: appliedMove.captured,
        },
      });
    }
  });

  return Object.freeze(captures);
}
