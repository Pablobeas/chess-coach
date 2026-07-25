import { describe, expect, it } from "vitest";
import {
  applyMove,
  createInitialGame,
  listLegalMoves,
  replayHistory,
} from "@chess-coach/chess-core";
import type { CoachTurnRecord } from "@chess-coach/coach";
import {
  DEFAULT_SETTINGS,
  clearStoredGame,
  loadStoredGame,
  saveStoredGame,
} from "./persistence";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, value),
  };
}

function recordFor(
  before: ReturnType<typeof createInitialGame>,
  after: ReturnType<typeof createInitialGame>,
  actor: "user" | "maia",
): CoachTurnRecord {
  const move = after.history.at(-1)!;
  return {
    schemaVersion: 2,
    turn: {
      ply: after.history.length,
      actor,
      playedUci: move.uci,
      playedSan: move.san,
      beforeFen: before.fen,
      afterFen: after.fen,
      perspective: "white",
    },
    evidence: {
      before: { rank: 1, moves: [], score: { kind: "centipawns", value: 0 } },
      after: { rank: 1, moves: [], score: { kind: "centipawns", value: 0 } },
      perspective: "white",
      playedUci: move.uci,
      verifiedBestVariation: [],
      validation: { playedMoveLegal: true, bestLineFullyLegal: true },
    },
    motif: { kind: "activity", detectorVersion: "motif-v1", evidence: [] },
    hints: [],
  };
}

function sessionWithPlies(count: number) {
  let session = createInitialGame();
  for (let index = 0; index < count; index += 1) {
    const move = listLegalMoves(session.fen)[0];
    if (!move) throw new Error("Expected a legal move");
    session = applyMove(session, move);
  }
  return session;
}

describe("local persistence", () => {
  it("round-trips a versioned session", () => {
    const storage = memoryStorage();
    const session = createInitialGame();
    saveStoredGame(session, DEFAULT_SETTINGS, storage);

    expect(loadStoredGame(storage)).toMatchObject({
      version: 6,
      session: { fen: session.fen, pgn: session.pgn },
      settings: DEFAULT_SETTINGS,
      annotations: [],
      cursor: 0,
      feedbackByPly: [],
    });
  });

  it("rejects malformed or obsolete data and can clear it", () => {
    const storage = memoryStorage();
    storage.setItem(
      "chess-coach:active-game:v1",
      JSON.stringify({ version: 0 }),
    );
    expect(loadStoredGame(storage)).toBeNull();
    clearStoredGame(storage);
    expect(storage.length).toBe(0);
  });

  it("migrates valid annotations and drops annotations for another move", () => {
    const storage = memoryStorage();
    const session = applyMove(createInitialGame(), { from: "e2", to: "e4" });

    saveStoredGame(session, DEFAULT_SETTINGS, storage, [
      { historyIndex: 0, uci: "e2e4", label: "excellent" },
      { historyIndex: 1, uci: "e7e5", label: "blunder" },
    ]);

    expect(loadStoredGame(storage)?.annotations).toEqual([
      { historyIndex: 0, uci: "e2e4", label: "excellent" },
    ]);
  });

  it("migrates a version one game without annotations", () => {
    const storage = memoryStorage();
    saveStoredGame(createInitialGame(), DEFAULT_SETTINGS, storage);
    const legacy = JSON.parse(
      storage.getItem("chess-coach:active-game:v1") ?? "{}",
    ) as Record<string, unknown>;
    legacy.version = 1;
    delete legacy.annotations;
    storage.setItem("chess-coach:active-game:v1", JSON.stringify(legacy));

    expect(loadStoredGame(storage)).toMatchObject({
      version: 6,
      annotations: [],
    });
  });

  it("keeps a complete future line and feedback records at the selected cursor", () => {
    const storage = memoryStorage();
    const first = applyMove(createInitialGame(), { from: "e2", to: "e4" });
    const session = applyMove(first, { from: "e7", to: "e5" });
    saveStoredGame(session, DEFAULT_SETTINGS, storage, [], [], 1);

    expect(loadStoredGame(storage)).toMatchObject({
      version: 6,
      cursor: 1,
      session: { history: [{ uci: "e2e4" }, { uci: "e7e5" }] },
    });
  });

  it("round-trips the one-level recovery snapshot", () => {
    const storage = memoryStorage();
    const first = applyMove(createInitialGame(), { from: "e2", to: "e4" });
    const session = applyMove(first, { from: "e7", to: "e5" });
    saveStoredGame(first, DEFAULT_SETTINGS, storage, [], [], 1, {
      session,
      cursor: 1,
      annotations: [],
      feedbackByPly: [],
    });

    expect(loadStoredGame(storage)?.recovery).toMatchObject({
      cursor: 1,
      session: { history: [{ uci: "e2e4" }, { uci: "e7e5" }] },
      annotations: [],
      feedbackByPly: [],
    });
    expect(loadStoredGame(storage)?.workspace).toMatchObject({
      version: 6,
      mainLineId: "main",
      activeLineId: "trial-1",
    });
  });

  it("rejects a corrupt trial without replacing a valid main line", () => {
    const storage = memoryStorage();
    saveStoredGame(createInitialGame(), DEFAULT_SETTINGS, storage);
    const stored = JSON.parse(
      storage.getItem("chess-coach:active-game:v1") ?? "{}",
    ) as { workspace: { lines: unknown[] } };
    stored.workspace.lines.push({
      id: "trial-bad",
      timeline: { session: {}, cursor: 0 },
    });
    storage.setItem("chess-coach:active-game:v1", JSON.stringify(stored));

    expect(loadStoredGame(storage)?.workspace.lines).toHaveLength(1);
  });

  it("rejects a recovery snapshot with an invalid cursor", () => {
    const storage = memoryStorage();
    const session = applyMove(createInitialGame(), { from: "e2", to: "e4" });
    saveStoredGame(session, DEFAULT_SETTINGS, storage, [], [], 1, {
      session,
      cursor: 1,
      annotations: [],
      feedbackByPly: [],
    });
    const stored = JSON.parse(
      storage.getItem("chess-coach:active-game:v1") ?? "{}",
    ) as { recovery: { cursor: number } };
    stored.recovery.cursor = 99;
    storage.setItem("chess-coach:active-game:v1", JSON.stringify(stored));

    expect(loadStoredGame(storage)).toBeNull();
  });

  it("persists structured records for both user and Maia plies", () => {
    const storage = memoryStorage();
    const first = applyMove(createInitialGame(), { from: "e2", to: "e4" });
    const session = applyMove(first, { from: "e7", to: "e5" });
    saveStoredGame(
      session,
      DEFAULT_SETTINGS,
      storage,
      [],
      [
        {
          historyIndex: 0,
          uci: "e2e4",
          actor: "user",
          beforeFen: createInitialGame().fen,
          afterFen: first.fen,
          status: "ready",
          record: recordFor(createInitialGame(), first, "user"),
        },
        {
          historyIndex: 1,
          uci: "e7e5",
          actor: "maia",
          beforeFen: first.fen,
          afterFen: session.fen,
          status: "ready",
          record: recordFor(first, session, "maia"),
        },
      ],
    );
    expect(
      loadStoredGame(storage)?.feedbackByPly.map((item) => item.actor),
    ).toEqual(["user", "maia"]);
  });

  it("keeps feedback for every ply of a 100-ply legal history", () => {
    const storage = memoryStorage();
    const session = sessionWithPlies(100);
    const feedbackByPly = replayHistory(session).map((entry) => ({
      historyIndex: entry.historyIndex,
      uci: entry.move.uci,
      actor:
        entry.historyIndex % 2 === 0 ? ("user" as const) : ("maia" as const),
      beforeFen: entry.beforeFen,
      afterFen: entry.afterFen,
      status: "unavailable" as const,
    }));

    saveStoredGame(session, DEFAULT_SETTINGS, storage, [], feedbackByPly);

    const restored = loadStoredGame(storage);
    expect(restored?.feedbackByPly).toEqual(feedbackByPly);
    expect(restored?.feedbackByPly).toHaveLength(100);
  });

  it("normalizes legacy SAN hint text when loading a saved game", () => {
    const storage = memoryStorage();
    const before = createInitialGame();
    const after = applyMove(before, { from: "e2", to: "e4" });
    const legacyRecord = recordFor(before, after, "user");
    const record: CoachTurnRecord = {
      ...legacyRecord,
      evidence: {
        ...legacyRecord.evidence,
        verifiedBestVariation: [{ uci: "e2e4", san: "e4" }],
      },
      hints: [
        {
          level: 1,
          templateId: "legacy-1",
          text: "Compara la actividad de tus piezas.",
          target: { kind: "goal" },
        },
        {
          level: 2,
          templateId: "legacy-2",
          text: "Revisa la pieza y las casillas de Be2.",
          target: {
            kind: "piece-zone",
            move: { uci: "e2e4", san: "e4" },
          },
        },
        {
          level: 3,
          templateId: "legacy-3",
          text: "Prueba Be2 y la respuesta Nf6.",
          target: {
            kind: "move",
            move: { uci: "e2e4", san: "e4" },
          },
        },
      ],
    };
    saveStoredGame(
      after,
      DEFAULT_SETTINGS,
      storage,
      [],
      [
        {
          historyIndex: 0,
          uci: "e2e4",
          actor: "user",
          beforeFen: before.fen,
          afterFen: after.fen,
          status: "ready",
          record,
        },
      ],
    );

    const loaded = loadStoredGame(storage);
    expect(loaded?.feedbackByPly[0]?.record?.hints[1]?.text).toBe(
      "Revisa el peón e2-e4.",
    );
    expect(loaded?.feedbackByPly[0]?.record?.hints[2]?.text).toBe(
      "Prueba el peón e2-e4.",
    );
  });

  it("recovers an interrupted pending analysis as unavailable", () => {
    const storage = memoryStorage();
    const before = createInitialGame();
    const session = applyMove(before, { from: "e2", to: "e4" });
    saveStoredGame(
      session,
      DEFAULT_SETTINGS,
      storage,
      [],
      [
        {
          historyIndex: 0,
          uci: "e2e4",
          actor: "user",
          beforeFen: before.fen,
          afterFen: session.fen,
          status: "pending",
        },
      ],
    );

    expect(loadStoredGame(storage)?.feedbackByPly[0]?.status).toBe(
      "unavailable",
    );
  });

  it("adds the default Maia-3 Elo when migrating a version two game", () => {
    const storage = memoryStorage();
    saveStoredGame(createInitialGame(), DEFAULT_SETTINGS, storage);
    const legacy = JSON.parse(
      storage.getItem("chess-coach:active-game:v1") ?? "{}",
    ) as { version: number; settings: Record<string, unknown> };
    legacy.version = 2;
    delete legacy.settings.opponentElo;
    storage.setItem("chess-coach:active-game:v1", JSON.stringify(legacy));

    expect(loadStoredGame(storage)?.settings.opponentElo).toBe(1500);
  });

  it("loads legacy settings but removes retired properties", () => {
    const storage = memoryStorage();
    saveStoredGame(createInitialGame(), DEFAULT_SETTINGS, storage);
    const legacy = JSON.parse(
      storage.getItem("chess-coach:active-game:v1") ?? "{}",
    ) as { settings: Record<string, unknown> };
    legacy.settings.showThreats = true;
    legacy.settings.soundEnabled = false;
    storage.setItem("chess-coach:active-game:v1", JSON.stringify(legacy));

    expect(loadStoredGame(storage)?.settings).toEqual({
      playerColor: "white",
      opponentElo: 1500,
      enginePreset: "intermediate",
      helpLevel: "normal",
      showEvaluation: true,
      showArrows: true,
    });
  });

  it("rejects an out-of-range Maia-3 Elo", () => {
    const storage = memoryStorage();
    saveStoredGame(createInitialGame(), DEFAULT_SETTINGS, storage);
    const malformed = JSON.parse(
      storage.getItem("chess-coach:active-game:v1") ?? "{}",
    ) as { settings: Record<string, unknown> };
    malformed.settings.opponentElo = 2700;
    storage.setItem("chess-coach:active-game:v1", JSON.stringify(malformed));

    expect(loadStoredGame(storage)).toBeNull();
  });
});
