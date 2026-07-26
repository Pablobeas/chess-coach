import { describe, expect, it } from "vitest";
import {
  applyMove,
  createInitialGame,
  formatMovePhrase,
  formatMoveReference,
  formatMoveSequence,
  getCastlingRights,
  getMaterialSummary,
  getPieceAt,
  InvalidFenError,
  InvalidGameSessionError,
  InvalidSquareError,
  listAttackers,
  listCaptures,
  listDefenders,
  listLegalMoves,
  listPieces,
  loadPgn,
  loadPosition,
  type PositionPiece,
  replayHistory,
  restoreSession,
  sessionAtPly,
  undoLastMove,
} from "./index";

describe("chess-core", () => {
  it("creates the standard initial position", () => {
    const game = createInitialGame();

    expect(game.turn).toBe("white");
    expect(game.isGameOver).toBe(false);
    expect(game.fen).toContain(" w ");
  });

  it("preserves the active color from FEN", () => {
    const game = loadPosition("8/8/8/8/8/8/4k3/6K1 b - - 0 1");

    expect(game.turn).toBe("black");
    expect(game.isCheck).toBe(false);
    expect(game.isCheckmate).toBe(false);
  });

  it("exposes check and checkmate status in the snapshot", () => {
    const check = loadPosition("7k/6Q1/8/8/8/5K2/8/8 b - - 0 1");
    const checkmate = loadPosition("7k/6Q1/5K2/8/8/8/8/8 b - - 0 1");

    expect(check.isCheck).toBe(true);
    expect(check.isCheckmate).toBe(false);
    expect(checkmate.isCheck).toBe(true);
    expect(checkmate.isCheckmate).toBe(true);
  });

  it("applies a legal move and records an immutable session history", () => {
    const initial = createInitialGame();
    const afterMove = applyMove(initial, { from: "e2", to: "e4" });

    expect(afterMove.turn).toBe("black");
    expect(afterMove.pgn).toContain("1. e4 *");
    expect(afterMove.history).toEqual([
      { from: "e2", to: "e4", san: "e4", uci: "e2e4" },
    ]);
    expect(initial.history).toEqual([]);
    expect(initial.turn).toBe("white");
  });

  it("rejects an illegal move without changing the source session", () => {
    const initial = createInitialGame();

    expect(() => applyMove(initial, { from: "e2", to: "e5" })).toThrow(
      /Illegal move: e2e5/,
    );
    expect(initial.fen).toContain(" w ");
    expect(initial.history).toEqual([]);
  });

  it("undoes the latest move and preserves the rest of the game", () => {
    const afterWhite = applyMove(createInitialGame(), {
      from: "e2",
      to: "e4",
    });
    const afterBlack = applyMove(afterWhite, { from: "e7", to: "e5" });
    const restored = undoLastMove(afterBlack);

    expect(restored.fen).toBe(afterWhite.fen);
    expect(restored.pgn).toBe(afterWhite.pgn);
    expect(restored.history).toEqual(afterWhite.history);
  });

  it("imports PGN and restores a serialized session", () => {
    const imported = loadPgn("1. e4 e5");

    expect(imported.history.map((move) => move.san)).toEqual(["e4", "e5"]);
    expect(restoreSession(JSON.parse(JSON.stringify(imported)))).toEqual(
      imported,
    );
  });

  it("replays a 100-ply history in one ordered pass", () => {
    let session = loadPosition("4k2r/8/8/8/8/8/8/R3K3 w - - 0 1");
    const cycle = ["a1a2", "h8h7", "a2a1", "h7h8"] as const;

    for (let ply = 0; ply < 100; ply += 1) {
      const uci = cycle[ply % cycle.length]!;
      session = applyMove(session, {
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
      });
    }

    const replayed = replayHistory(session);

    expect(replayed).toHaveLength(100);
    expect(replayed[0]).toMatchObject({
      historyIndex: 0,
      beforeFen: session.initialFen,
      move: { uci: "a1a2" },
    });
    expect(replayed.at(-1)).toMatchObject({
      historyIndex: 99,
      afterFen: session.fen,
      move: { uci: "h7h8" },
    });
    expect(restoreSession(JSON.parse(JSON.stringify(session)))).toEqual(
      session,
    );
  });

  it("keeps PGN coherent when a trusted custom position starts with black", () => {
    const before = loadPosition("4k2r/8/8/8/8/8/8/R3K3 b - - 0 7");
    const afterBlack = applyMove(before, { from: "h8", to: "h7" });
    const afterWhite = applyMove(afterBlack, { from: "a1", to: "a2" });

    expect(afterWhite.pgn).toContain("7. ... Rh7 8. Ra2 *");
    expect(restoreSession(JSON.parse(JSON.stringify(afterWhite)))).toEqual(
      afterWhite,
    );
  });

  it("materializes one cursor position from a 100-ply session", () => {
    let session = loadPosition("4k2r/8/8/8/8/8/8/R3K3 w - - 0 1");
    const cycle = ["a1a2", "h8h7", "a2a1", "h7h8"] as const;
    for (let ply = 0; ply < 100; ply += 1) {
      const uci = cycle[ply % cycle.length]!;
      session = applyMove(session, {
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
      });
    }

    const replayed = replayHistory(session);
    const atZero = sessionAtPly(session, 0);
    const atThirtySeven = sessionAtPly(session, 37);

    expect(atZero.fen).toBe(session.initialFen);
    expect(atZero.history).toEqual([]);
    expect(atThirtySeven.history).toEqual(session.history.slice(0, 37));
    expect(atThirtySeven.fen).toBe(replayed[36]?.afterFen);
    expect(restoreSession(JSON.parse(JSON.stringify(atThirtySeven)))).toEqual(
      atThirtySeven,
    );
    expect(sessionAtPly(session, 100)).toBe(session);
    expect(() => sessionAtPly(session, 101)).toThrow(/cursor/i);
  });

  it("validates an untrusted complete session before slicing its history", () => {
    const session = applyMove(createInitialGame(), {
      from: "e2",
      to: "e4",
    });
    const untrusted = JSON.parse(JSON.stringify(session)) as typeof session;
    Object.assign(untrusted, { fen: createInitialGame().fen });

    expect(() => sessionAtPly(untrusted, 0)).toThrow(InvalidGameSessionError);
  });

  it("lists normal, en passant and promotion captures", () => {
    const normal = applyMove(loadPosition("8/8/8/3p4/4P3/8/8/4K2k w - - 0 1"), {
      from: "e4",
      to: "d5",
    });
    expect(listCaptures(normal)).toEqual([
      {
        historyIndex: 0,
        capturer: "white",
        piece: { color: "black", type: "p" },
      },
    ]);

    const enPassant = applyMove(
      applyMove(loadPosition("8/8/8/8/3p4/8/4P3/4K2k w - - 0 1"), {
        from: "e2",
        to: "e4",
      }),
      { from: "d4", to: "e3" },
    );
    expect(listCaptures(enPassant)[0]?.piece.type).toBe("p");

    const promotion = applyMove(
      loadPosition("3rk3/4P3/8/8/8/8/8/4K3 w - - 0 1"),
      { from: "e7", to: "d8", promotion: "q" },
    );
    expect(listCaptures(promotion)[0]?.piece.type).toBe("r");
  });

  it("formats visible moves with piece, origin, destination and capture marker", () => {
    const afterE4 = applyMove(createInitialGame(), { from: "e2", to: "e4" });
    const afterE5 = applyMove(afterE4, { from: "e7", to: "e5" });
    const afterNf3 = applyMove(afterE5, { from: "g1", to: "f3" });
    const afterA6 = applyMove(afterNf3, { from: "a7", to: "a6" });
    const afterCapture = applyMove(afterA6, { from: "f3", to: "e5" });

    expect(
      formatMoveReference(createInitialGame().fen, afterE4.history[0]!),
    ).toBe("Peón e2-e4");
    expect(formatMoveReference(afterE4.fen, afterE5.history[1]!)).toBe(
      "Peón e7-e5",
    );
    expect(formatMoveReference(afterA6.fen, afterCapture.history[4]!)).toBe(
      "Caballo f3xe5",
    );
    expect(formatMovePhrase(afterA6.fen, afterCapture.history[4]!)).toBe(
      "el caballo f3xe5",
    );
  });

  it("preserves check, mate and promotion markers in compact notation", () => {
    const checkBefore = loadPosition("4k3/8/8/8/8/8/4Q3/4K3 w - - 0 1");
    const checkMove = listLegalMoves(checkBefore.fen).find((move) =>
      move.san.includes("+"),
    );
    expect(checkMove).toBeDefined();
    expect(formatMoveReference(checkBefore.fen, checkMove!)).toMatch(/[+]$/);

    const mateBefore = loadPosition("7k/5Q2/5K2/8/8/8/8/8 w - - 0 1");
    const mateMove = listLegalMoves(mateBefore.fen).find((move) =>
      move.san.includes("#"),
    );
    expect(mateMove).toBeDefined();
    expect(formatMoveReference(mateBefore.fen, mateMove!)).toMatch(/#$/);

    const promotionBefore = loadPosition("4k3/3P4/8/8/8/8/8/4K3 w - - 0 1");
    const promotion = applyMove(promotionBefore, {
      from: "d7",
      to: "d8",
      promotion: "q",
    });
    expect(
      formatMoveReference(promotionBefore.fen, promotion.history[0]!),
    ).toContain("Peón d7-d8=Dama");
  });

  it("formats a legal variation from each position in sequence", () => {
    expect(
      formatMoveSequence(createInitialGame().fen, [
        { uci: "e2e4", san: "e4" },
        { uci: "e7e5", san: "e5" },
        { uci: "g1f3", san: "Nf3" },
      ]),
    ).toEqual(["Peón e2-e4", "Peón e7-e5", "Caballo g1-f3"]);
  });

  it("lists immutable pieces, occupancy and promoted material", () => {
    const fen = "4k3/8/8/8/8/8/Q7/Q3K3 w - - 0 1";

    expect(listPieces(fen)).toEqual([
      { square: "e8", color: "black", type: "k" },
      { square: "a2", color: "white", type: "q" },
      { square: "a1", color: "white", type: "q" },
      { square: "e1", color: "white", type: "k" },
    ]);
    expect(getPieceAt(fen, "a2")).toEqual({
      square: "a2",
      color: "white",
      type: "q",
    });
    expect(getPieceAt(fen, "d4")).toBeUndefined();
    expect(getMaterialSummary(fen)).toEqual({
      white: {
        totalPieces: 3,
        byType: { p: 0, n: 0, b: 0, r: 0, q: 2, k: 1 },
      },
      black: {
        totalPieces: 1,
        byType: { p: 0, n: 0, b: 0, r: 0, q: 0, k: 1 },
      },
    });
  });

  it("lists attackers and defenders from immutable square snapshots", () => {
    const fen = "4k3/8/4p3/3p4/2B1P3/8/8/4K3 w - - 0 1";

    expect(listAttackers(fen, "d5", "white")).toEqual([
      { square: "c4", color: "white", type: "b" },
      { square: "e4", color: "white", type: "p" },
    ]);
    expect(listAttackers(fen, "e4", "black")).toEqual([
      { square: "d5", color: "black", type: "p" },
    ]);
    expect(listDefenders(fen, "d5")).toEqual([
      { square: "e6", color: "black", type: "p" },
    ]);
    expect(listDefenders(fen, "c3")).toEqual([]);
  });

  it("derives castling rights directly from FEN", () => {
    expect(
      getCastlingRights("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1"),
    ).toEqual({
      white: { kingside: true, queenside: true },
      black: { kingside: true, queenside: true },
    });
    expect(
      getCastlingRights("r3k2r/8/8/8/8/8/8/R3K2R b Kq - 0 1"),
    ).toEqual({
      white: { kingside: true, queenside: false },
      black: { kingside: false, queenside: true },
    });
    expect(getCastlingRights("4k3/8/8/8/8/8/8/4K3 w - - 0 1")).toEqual({
      white: { kingside: false, queenside: false },
      black: { kingside: false, queenside: false },
    });
  });

  it("rejects invalid squares in position inspection helpers", () => {
    const fen = createInitialGame().fen;

    expect(() => getPieceAt(fen, "z9")).toThrow(InvalidSquareError);
    expect(() => listAttackers(fen, "i4", "white")).toThrow(InvalidSquareError);
    expect(() => listDefenders(fen, "aa")).toThrow(InvalidSquareError);
  });

  it("rejects invalid FEN in position inspection helpers", () => {
    const invalidFen = "not-a-fen";

    expect(() => listPieces(invalidFen)).toThrow(InvalidFenError);
    expect(() => getMaterialSummary(invalidFen)).toThrow(InvalidFenError);
    expect(() => getCastlingRights(invalidFen)).toThrow(InvalidFenError);
  });

  it("returns deeply frozen public inspection snapshots", () => {
    const fen = "r3k2r/8/4p3/3p4/2B1P3/8/Q7/R3K2R w KQkq - 0 1";
    const pieces = listPieces(fen);
    const piece = getPieceAt(fen, "a2")!;
    const attackers = listAttackers(fen, "d5", "white");
    const defenders = listDefenders(fen, "d5");
    const material = getMaterialSummary(fen);
    const castling = getCastlingRights(fen);

    expect(Object.isFrozen(pieces)).toBe(true);
    expect(Object.isFrozen(pieces[0]!)).toBe(true);
    expect(Object.isFrozen(piece)).toBe(true);
    expect(Object.isFrozen(attackers)).toBe(true);
    expect(Object.isFrozen(attackers[0]!)).toBe(true);
    expect(Object.isFrozen(defenders)).toBe(true);
    expect(Object.isFrozen(defenders[0]!)).toBe(true);
    expect(Object.isFrozen(material)).toBe(true);
    expect(Object.isFrozen(material.white)).toBe(true);
    expect(Object.isFrozen(material.white.byType)).toBe(true);
    expect(Object.isFrozen(castling)).toBe(true);
    expect(Object.isFrozen(castling.white)).toBe(true);

    expect(() => {
      (pieces as unknown as PositionPiece[]).push(piece);
    }).toThrow(TypeError);
    expect(() => {
      (pieces[0] as { square: string }).square = "h8";
    }).toThrow(TypeError);
    expect(() => {
      (material.white.byType as { q: number }).q = 99;
    }).toThrow(TypeError);
    expect(() => {
      (castling.white as { kingside: boolean }).kingside = false;
    }).toThrow(TypeError);
  });
});
