import { Chess, type PieceSymbol, type Square } from "chess.js";

export type PlayerColor = "white" | "black";
export type PromotionPiece = "q" | "r" | "b" | "n";
export type PieceType = PieceSymbol;
export type BoardSquare =
  | "a1"
  | "a2"
  | "a3"
  | "a4"
  | "a5"
  | "a6"
  | "a7"
  | "a8"
  | "b1"
  | "b2"
  | "b3"
  | "b4"
  | "b5"
  | "b6"
  | "b7"
  | "b8"
  | "c1"
  | "c2"
  | "c3"
  | "c4"
  | "c5"
  | "c6"
  | "c7"
  | "c8"
  | "d1"
  | "d2"
  | "d3"
  | "d4"
  | "d5"
  | "d6"
  | "d7"
  | "d8"
  | "e1"
  | "e2"
  | "e3"
  | "e4"
  | "e5"
  | "e6"
  | "e7"
  | "e8"
  | "f1"
  | "f2"
  | "f3"
  | "f4"
  | "f5"
  | "f6"
  | "f7"
  | "f8"
  | "g1"
  | "g2"
  | "g3"
  | "g4"
  | "g5"
  | "g6"
  | "g7"
  | "g8"
  | "h1"
  | "h2"
  | "h3"
  | "h4"
  | "h5"
  | "h6"
  | "h7"
  | "h8";

export interface MoveInput {
  readonly from: string;
  readonly to: string;
  readonly promotion?: PromotionPiece;
}

export interface MoveRecord extends MoveInput {
  readonly san: string;
  readonly uci: string;
}

/** Engine/history move shape accepted by the user-facing compact formatter. */
export interface MoveNotationInput {
  readonly uci: string;
  readonly san?: string;
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

export interface ReplayedHistoryEntry {
  readonly historyIndex: number;
  readonly beforeFen: string;
  readonly afterFen: string;
  readonly move: MoveRecord;
}

export interface PositionPiece {
  readonly square: BoardSquare;
  readonly color: PlayerColor;
  readonly type: PieceType;
}

export interface PieceCountByType {
  readonly p: number;
  readonly n: number;
  readonly b: number;
  readonly r: number;
  readonly q: number;
  readonly k: number;
}

export interface MaterialCount {
  readonly totalPieces: number;
  readonly byType: PieceCountByType;
}

export interface MaterialSummary {
  readonly white: MaterialCount;
  readonly black: MaterialCount;
}

export interface SideCastlingRights {
  readonly kingside: boolean;
  readonly queenside: boolean;
}

export interface CastlingRights {
  readonly white: SideCastlingRights;
  readonly black: SideCastlingRights;
}

type MutablePieceCountByType = {
  -readonly [Key in keyof PieceCountByType]: PieceCountByType[Key];
};

export class InvalidFenError extends Error {
  constructor(fen: string) {
    super(`Invalid FEN: ${fen}`);
    this.name = "InvalidFenError";
  }
}

export class InvalidSquareError extends Error {
  constructor(square: string) {
    super(`Invalid square: ${square}`);
    this.name = "InvalidSquareError";
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

function toSquare(square: string): Square {
  if (!SQUARE_PATTERN.test(square)) {
    throw new InvalidSquareError(square);
  }

  return square as Square;
}

function toPlayerColor(turn: "w" | "b"): PlayerColor {
  return turn === "w" ? "white" : "black";
}

function toInternalColor(color: PlayerColor): "w" | "b" {
  return color === "white" ? "w" : "b";
}

function toPositionPiece(
  square: string,
  piece: { readonly color: "w" | "b"; readonly type: PieceSymbol },
): PositionPiece {
  return Object.freeze({
    square: square as BoardSquare,
    color: toPlayerColor(piece.color),
    type: piece.type,
  });
}

function createEmptyPieceCountByType(): MutablePieceCountByType {
  return {
    p: 0,
    n: 0,
    b: 0,
    r: 0,
    q: 0,
    k: 0,
  };
}

function freezeMaterialCount(byType: MutablePieceCountByType): MaterialCount {
  return Object.freeze({
    totalPieces:
      byType.p + byType.n + byType.b + byType.r + byType.q + byType.k,
    byType: Object.freeze({ ...byType }),
  });
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

const trustedSessions = new WeakSet<GameSession>();
const previousSessions = new WeakMap<GameSession, GameSession>();

function detachedSessionSnapshot(session: GameSession): GameSession {
  const detached = Object.freeze({ ...session });
  trustedSessions.add(detached);
  return detached;
}

function createSession(
  game: Chess,
  initialFen: string,
  history: readonly MoveRecord[],
  pgn = game.pgn(),
): GameSession {
  const session = Object.freeze({
    ...snapshot(game),
    pgn,
    initialFen,
    history: Object.freeze([...history]),
  });
  trustedSessions.add(session);
  return session;
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

/**
 * Reconstructs every historical position with a single mutable chess.js
 * instance. Consumers that need FENs for many plies must use this instead of
 * repeatedly undoing or applying prefixes of the same session.
 */
export function replayHistory(
  session: GameSession,
): readonly ReplayedHistoryEntry[] {
  const game = createChess(session.initialFen);
  const entries: ReplayedHistoryEntry[] = [];

  for (const [historyIndex, move] of session.history.entries()) {
    const beforeFen = game.fen();
    try {
      game.move({
        from: move.from,
        to: move.to,
        ...(move.promotion === undefined ? {} : { promotion: move.promotion }),
      });
    } catch {
      throw new InvalidGameSessionError();
    }
    entries.push(
      Object.freeze({
        historyIndex,
        beforeFen,
        afterFen: game.fen(),
        move,
      }),
    );
  }

  if (game.fen() !== session.fen || game.pgn() !== session.pgn) {
    throw new InvalidGameSessionError();
  }

  return Object.freeze(entries);
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

function appendMoveToPgn(
  pgn: string,
  fen: string,
  san: string,
  hasHistory: boolean,
): string {
  const result = pgn.match(/(?:1-0|0-1|1\/2-1\/2|\*)\s*$/);
  if (!result || result.index === undefined) {
    throw new InvalidGameSessionError();
  }
  const prefix = pgn.slice(0, result.index).trimEnd();
  const fields = fen.split(/\s+/);
  const activeColor = fields[1];
  const fullmove = Number(fields[5]);
  if (
    (activeColor !== "w" && activeColor !== "b") ||
    !Number.isInteger(fullmove) ||
    fullmove < 1
  ) {
    throw new InvalidGameSessionError();
  }
  const notation =
    activeColor === "w"
      ? `${fullmove}. ${san}`
      : hasHistory
        ? san
        : `${fullmove}. ... ${san}`;
  const separator = prefix.includes("\n\n") ? " " : "\n\n";
  return `${prefix}${separator}${notation} ${result[0].trim()}`;
}

const DISPLAY_PIECE_NAMES: Readonly<Record<PieceSymbol, string>> =
  Object.freeze({
    p: "Peón",
    n: "Caballo",
    b: "Alfil",
    r: "Torre",
    q: "Dama",
    k: "Rey",
  });

function parseUciNotation(uci: string): MoveInput | undefined {
  const match = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/.exec(uci);
  if (!match) return undefined;
  const promotion = match[3] as PromotionPiece | undefined;
  return {
    from: match[1]!,
    to: match[2]!,
    ...(promotion === undefined ? {} : { promotion }),
  };
}

function lowercaseFirst(value: string): string {
  return `${value.slice(0, 1).toLowerCase()}${value.slice(1)}`;
}

/**
 * Formats a legal move for the visible UI without exposing SAN as the only
 * explanation. The returned form is compact: `Alfil b1-e2` or `Alfil b4xa5`.
 */
export function formatMoveReference(
  fen: string,
  move: MoveNotationInput,
): string {
  const parsed = parseUciNotation(move.uci);
  if (!parsed) return `Movimiento ${move.uci}`;
  const position = createChess(fen);
  const piece = position.get(parsed.from as Square)?.type;
  let legal: ReturnType<Chess["move"]>;
  try {
    legal = position.move(parsed);
  } catch {
    return `Movimiento ${parsed.from}-${parsed.to}`;
  }
  const pieceName = piece === undefined ? "Pieza" : DISPLAY_PIECE_NAMES[piece];
  const separator = legal.san.includes("x") ? "x" : "-";
  const promotion = legal.promotion
    ? `=${DISPLAY_PIECE_NAMES[legal.promotion]}`
    : "";
  const check = legal.san.includes("#")
    ? "#"
    : legal.san.includes("+")
      ? "+"
      : "";
  return `${pieceName} ${parsed.from}${separator}${parsed.to}${promotion}${check}`;
}

/** Formats a move for use inside a Spanish sentence. */
export function formatMovePhrase(fen: string, move: MoveNotationInput): string {
  return `el ${lowercaseFirst(formatMoveReference(fen, move))}`;
}

/** Formats and legally advances a complete engine variation. */
export function formatMoveSequence(
  fen: string,
  moves: readonly MoveNotationInput[],
): readonly string[] {
  let position = loadPosition(fen);
  const formatted: string[] = [];
  for (const move of moves) {
    formatted.push(formatMoveReference(position.fen, move));
    const parsed = parseUciNotation(move.uci);
    if (!parsed) continue;
    try {
      position = applyMove(position, parsed);
    } catch {
      break;
    }
  }
  return Object.freeze(formatted);
}

export function createInitialGame(): GameSession {
  const game = new Chess();
  return createSession(game, game.fen(), []);
}

export function loadPosition(fen: string): GameSession {
  return createSession(createChess(fen), fen, []);
}

export function listPieces(fen: string): readonly PositionPiece[] {
  const game = createChess(fen);
  const pieces: PositionPiece[] = [];

  for (const rank of game.board()) {
    for (const piece of rank) {
      if (piece === null) continue;
      pieces.push(toPositionPiece(piece.square, piece));
    }
  }

  return Object.freeze(pieces);
}

export function getPieceAt(
  fen: string,
  square: string,
): PositionPiece | undefined {
  const game = createChess(fen);
  const targetSquare = toSquare(square);
  const piece = game.get(targetSquare);

  return piece === undefined
    ? undefined
    : toPositionPiece(targetSquare, {
        color: piece.color,
        type: piece.type,
      });
}

export function listAttackers(
  fen: string,
  square: string,
  color: PlayerColor,
): readonly PositionPiece[] {
  const game = createChess(fen);
  const targetSquare = toSquare(square);

  return Object.freeze(
    game
      .attackers(targetSquare, toInternalColor(color))
      .map((attackerSquare) => {
        const piece = game.get(attackerSquare);
        if (piece === undefined) {
          throw new InvalidFenError(fen);
        }

        return toPositionPiece(attackerSquare, {
          color: piece.color,
          type: piece.type,
        });
      }),
  );
}

export function listDefenders(
  fen: string,
  square: string,
): readonly PositionPiece[] {
  const game = createChess(fen);
  const targetSquare = toSquare(square);
  const occupant = game.get(targetSquare);

  if (occupant === undefined) {
    return Object.freeze([]);
  }

  return Object.freeze(
    game
      .attackers(targetSquare, occupant.color)
      .map((defenderSquare) => {
        const piece = game.get(defenderSquare);
        if (piece === undefined) {
          throw new InvalidFenError(fen);
        }

        return toPositionPiece(defenderSquare, {
          color: piece.color,
          type: piece.type,
        });
      }),
  );
}

export function getMaterialSummary(fen: string): MaterialSummary {
  const white = createEmptyPieceCountByType();
  const black = createEmptyPieceCountByType();

  for (const piece of listPieces(fen)) {
    const counts = piece.color === "white" ? white : black;
    counts[piece.type] += 1;
  }

  return Object.freeze({
    white: freezeMaterialCount(white),
    black: freezeMaterialCount(black),
  });
}

export function getCastlingRights(fen: string): CastlingRights {
  const game = createChess(fen);
  const white = game.getCastlingRights("w");
  const black = game.getCastlingRights("b");

  return Object.freeze({
    white: Object.freeze({
      kingside: white.k,
      queenside: white.q,
    }),
    black: Object.freeze({
      kingside: black.k,
      queenside: black.q,
    }),
  });
}

export function restoreSession(session: GameSession): GameSession {
  return createSession(replay(session), session.initialFen, session.history);
}

/**
 * Materializes one historical cursor with a single forward replay. Sessions
 * created by this module are already trusted; deserialized input is fully
 * validated before any prefix is returned.
 */
export function sessionAtPly(
  session: GameSession,
  cursor: number,
): GameSession {
  if (
    !Number.isInteger(cursor) ||
    cursor < 0 ||
    cursor > session.history.length
  ) {
    throw new RangeError("The session cursor must be within the game history");
  }

  const trusted = trustedSessions.has(session);
  const validated = trusted ? undefined : replay(session);
  if (cursor === session.history.length) {
    return trusted
      ? session
      : createSession(validated!, session.initialFen, session.history);
  }

  const game = createChess(session.initialFen);
  for (let index = 0; index < cursor; index += 1) {
    const move = session.history[index];
    if (move === undefined) throw new InvalidGameSessionError();
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

  return createSession(
    game,
    session.initialFen,
    session.history.slice(0, cursor),
  );
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
  const trusted = trustedSessions.has(session);
  const game = trusted ? createChess(session.fen) : replay(session);

  try {
    const appliedMove = game.move({
      from: move.from,
      to: move.to,
      ...(move.promotion === undefined ? {} : { promotion: move.promotion }),
    });

    const next = createSession(
      game,
      session.initialFen,
      [...session.history, toMoveRecord(appliedMove)],
      trusted
        ? appendMoveToPgn(
            session.pgn,
            session.fen,
            appliedMove.san,
            session.history.length > 0,
          )
        : game.pgn(),
    );
    // Keep only a detached direct predecessor. Retaining the original session
    // would connect WeakMap keys into a strong chain of every historical
    // GameSession and make memory grow quadratically during a long game.
    previousSessions.set(next, detachedSessionSnapshot(session));
    return next;
  } catch {
    throw new IllegalMoveError(move);
  }
}

export function undoLastMove(session: GameSession): GameSession {
  const previous = previousSessions.get(session);
  if (previous !== undefined) return previous;
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
