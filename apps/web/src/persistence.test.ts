import { describe, expect, it } from "vitest";
import {
  applyMove,
  createInitialGame,
  listLegalMoves,
  loadPosition,
  replayHistory,
} from "@chess-coach/chess-core";
import type { CoachTurnRecord } from "@chess-coach/coach";
import { completeTerminalCheckmateEvidenceV1 } from "@chess-coach/coach";
import {
  DEFAULT_SETTINGS,
  clearStoredGame,
  loadStoredGame,
  saveStoredGame,
} from "./persistence";
import { createPostgameReviewStateV1 } from "./postgameReview";
import { exportSessionForWorkspace } from "./lineTransitions";
import {
  activeSessionLine,
  createSessionWorkspace,
  createTrialLine,
  navigateSessionLine,
  promoteSessionLineAndDeleteFormerMain,
  selectSessionLine,
  updateActiveSessionLine,
} from "./sessionWorkspace";

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

function contextualRecordFor(
  before: ReturnType<typeof createInitialGame>,
  after: ReturnType<typeof createInitialGame>,
): CoachTurnRecord {
  const legacy = recordFor(before, after, "user");
  const move = after.history.at(-1)!;
  return {
    ...legacy,
    schemaVersion: 3,
    explanation: {
      mode: "explained",
      primaryReason: {
        kind: "slow-development",
        confidence: "medium",
        factRefs: [],
      },
      consequence: { kind: "initiative", factRefs: [] },
      bestMovePurposes: ["develops-piece"],
      supportingVariation: [{ uci: move.uci, san: move.san }],
    },
    presentation: {
      locale: "es",
      templateId: "persistence-v3",
      summary: "Desarrollas una pieza y ganas espacio.",
      detail:
        "Desarrollas una pieza y ganas espacio, dejando más opciones para continuar.",
    },
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

const afterE4 = () => applyMove(createInitialGame(), { from: "e2", to: "e4" });
const afterE4E5 = () => applyMove(afterE4(), { from: "e7", to: "e5" });
const afterE4E5Bc4 = () => applyMove(afterE4E5(), { from: "f1", to: "c4" });
const afterE4E5Bc4Nf6 = () =>
  applyMove(afterE4E5Bc4(), { from: "g8", to: "f6" });
const afterE4E5Nf3 = () => applyMove(afterE4E5(), { from: "g1", to: "f3" });
const foolsMate = () =>
  ["f2f3", "e7e5", "g2g4", "d8h4"].reduce(
    (session, uci) =>
      applyMove(session, {
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
      }),
    createInitialGame(),
  );
const terminalStalemate = () =>
  applyMove(loadPosition("7k/8/6QK/8/8/8/8/8 w - - 0 1"), {
    from: "g6",
    to: "f7",
  });

function buildVariantWorkspace() {
  let workspace = navigateSessionLine(createSessionWorkspace(afterE4E5()), 2);
  workspace = updateActiveSessionLine(
    createTrialLine(workspace, "trial-a"),
    (line) => ({
      ...line,
      timeline: { session: afterE4E5Bc4(), cursor: 2 },
      annotations: [{ historyIndex: 2, uci: "f1c4", label: "good" }],
    }),
  );
  workspace = updateActiveSessionLine(
    createTrialLine(workspace, "trial-b"),
    (line) => ({
      ...line,
      timeline: { session: afterE4E5Bc4Nf6(), cursor: 3 },
      feedbackByPly: [
        {
          historyIndex: 2,
          uci: "f1c4",
          actor: "user",
          beforeFen: afterE4E5().fen,
          afterFen: afterE4E5Bc4().fen,
          status: "pending",
        },
        {
          historyIndex: 3,
          uci: "g8f6",
          actor: "maia",
          beforeFen: afterE4E5Bc4().fen,
          afterFen: afterE4E5Bc4Nf6().fen,
          status: "ready",
          record: recordFor(afterE4E5Bc4(), afterE4E5Bc4Nf6(), "maia"),
        },
      ],
    }),
  );
  workspace = navigateSessionLine(selectSessionLine(workspace, "main"), 2);
  workspace = updateActiveSessionLine(
    createTrialLine(workspace, "trial-c"),
    (line) => ({
      ...line,
      timeline: { session: afterE4E5Nf3(), cursor: 1 },
      annotations: [{ historyIndex: 2, uci: "g1f3", label: "excellent" }],
    }),
  );
  workspace = promoteSessionLineAndDeleteFormerMain(workspace, "trial-a");
  return selectSessionLine(workspace, "trial-b");
}

function addLegacyRecovery(
  storage: Storage,
  recovery: {
    session: ReturnType<typeof createInitialGame>;
    cursor: number;
    annotations: unknown[];
    feedbackByPly: unknown[];
  },
  version = 6,
) {
  const stored = JSON.parse(
    storage.getItem("chess-coach:active-game:v1") ?? "{}",
  ) as Record<string, unknown>;
  stored.version = version;
  stored.recovery = recovery;
  storage.setItem("chess-coach:active-game:v1", JSON.stringify(stored));
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

  it("migrates a legacy recovery snapshot into a normal trial line", () => {
    const storage = memoryStorage();
    const first = applyMove(createInitialGame(), { from: "e2", to: "e4" });
    const session = applyMove(first, { from: "e7", to: "e5" });
    saveStoredGame(first, DEFAULT_SETTINGS, storage, [], [], 1);
    addLegacyRecovery(storage, {
      session,
      cursor: 1,
      annotations: [],
      feedbackByPly: [],
    });

    const loaded = loadStoredGame(storage);
    expect(loaded?.workspace).toMatchObject({
      version: 6,
      mainLineId: "main",
      activeLineId: "trial-1",
    });
    expect(loaded?.workspace.lines.map((line) => line.id)).toEqual([
      "main",
      "trial-1",
    ]);
    expect(loaded?.workspace.lines[1]).toMatchObject({
      timeline: {
        cursor: 1,
        session: { history: [{ uci: "e2e4" }, { uci: "e7e5" }] },
      },
      fork: { lineId: "main", ply: 1 },
      annotations: [],
      feedbackByPly: [],
    });
    expect(
      JSON.parse(storage.getItem("chess-coach:active-game:v1") ?? "{}"),
    ).toHaveProperty("recovery");
  });

  it("round-trips a promoted workspace with line order, forks, cursors and isolated feedback", () => {
    const storage = memoryStorage();
    const workspace = buildVariantWorkspace();

    saveStoredGame(workspace, DEFAULT_SETTINGS, storage);

    const restored = loadStoredGame(storage);
    expect(restored).not.toBeNull();
    expect(restored?.workspace.mainLineId).toBe("trial-a");
    expect(restored?.workspace.activeLineId).toBe("trial-b");
    expect(restored?.workspace.lines.map((line) => line.id)).toEqual([
      "trial-a",
      "trial-b",
      "trial-c",
    ]);
    expect(
      restored?.workspace.lines.map((line) => line.timeline.cursor),
    ).toEqual([2, 3, 1]);
    expect(restored?.workspace.lines.map((line) => line.fork ?? null)).toEqual([
      null,
      { lineId: "trial-a", ply: 2 },
      { lineId: "trial-a", ply: 2 },
    ]);
    expect(
      restored?.workspace.lines[1]?.feedbackByPly.map((entry) => entry.status),
    ).toEqual(["unavailable", "ready"]);
    expect(restored?.workspace.lines[0]?.feedbackByPly).toEqual([]);
    expect(restored?.session.history.map((move) => move.uci)).toEqual([
      "e2e4",
      "e7e5",
      "f1c4",
    ]);
    expect(restored?.cursor).toBe(2);

    const navigated = navigateSessionLine(restored!.workspace, 2);
    expect(activeSessionLine(navigated).id).toBe("trial-b");
    expect(activeSessionLine(navigated).timeline.cursor).toBe(2);
    expect(
      exportSessionForWorkspace(navigated).history.map((move) => move.uci),
    ).toEqual(["e2e4", "e7e5", "f1c4"]);
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

  it("skips orphaned and cyclic lines while preserving a valid main workspace", () => {
    const storage = memoryStorage();
    saveStoredGame(buildVariantWorkspace(), DEFAULT_SETTINGS, storage);
    const stored = JSON.parse(
      storage.getItem("chess-coach:active-game:v1") ?? "{}",
    ) as {
      workspace: {
        activeLineId: string;
        lines: Array<Record<string, unknown>>;
      };
    };
    const [main, child, sibling] = stored.workspace.lines;
    stored.workspace.activeLineId = "trial-orphan";
    stored.workspace.lines = [
      child!,
      {
        ...main!,
        id: "trial-cycle-a",
        fork: { lineId: "trial-cycle-b", ply: 2 },
      },
      {
        ...sibling!,
        id: "trial-cycle-b",
        fork: { lineId: "trial-cycle-a", ply: 2 },
      },
      {
        ...sibling!,
        id: "trial-orphan",
        fork: { lineId: "missing-parent", ply: 2 },
      },
      main!,
    ];
    storage.setItem("chess-coach:active-game:v1", JSON.stringify(stored));

    const restored = loadStoredGame(storage);
    expect(restored).not.toBeNull();
    expect(restored?.workspace.mainLineId).toBe("trial-a");
    expect(restored?.workspace.activeLineId).toBe("trial-a");
    expect(restored?.workspace.lines.map((line) => line.id)).toEqual([
      "trial-b",
      "trial-a",
    ]);
    expect(
      restored?.workspace.lines.find((line) => line.id === "trial-b")?.fork,
    ).toEqual({ lineId: "trial-a", ply: 2 });
  });

  it("rejects a legacy recovery snapshot with an invalid cursor", () => {
    const storage = memoryStorage();
    const session = applyMove(createInitialGame(), { from: "e2", to: "e4" });
    saveStoredGame(session, DEFAULT_SETTINGS, storage, [], [], 1);
    addLegacyRecovery(
      storage,
      {
        session,
        cursor: 1,
        annotations: [],
        feedbackByPly: [],
      },
      5,
    );
    const stored = JSON.parse(
      storage.getItem("chess-coach:active-game:v1") ?? "{}",
    ) as { recovery: { cursor: number } };
    stored.recovery.cursor = 99;
    storage.setItem("chess-coach:active-game:v1", JSON.stringify(stored));

    expect(loadStoredGame(storage)).toBeNull();
  });

  it("does not write the retired recovery field in new saves", () => {
    const storage = memoryStorage();
    saveStoredGame(buildVariantWorkspace(), DEFAULT_SETTINGS, storage);

    expect(
      JSON.parse(storage.getItem("chess-coach:active-game:v1") ?? "{}"),
    ).not.toHaveProperty("recovery");
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

  it("loads both v2 and contextual v3 records without inventing a v2 explanation", () => {
    const storage = memoryStorage();
    const before = createInitialGame();
    const after = applyMove(before, { from: "e2", to: "e4" });
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
          record: contextualRecordFor(before, after),
        },
      ],
    );

    const v3 = loadStoredGame(storage)?.feedbackByPly[0]?.record;
    expect(v3).toMatchObject({
      schemaVersion: 3,
      presentation: { summary: "Desarrollas una pieza y ganas espacio." },
    });

    const stored = JSON.parse(
      storage.getItem("chess-coach:active-game:v1") ?? "{}",
    ) as {
      workspace: {
        lines: Array<{ feedbackByPly: Array<{ record: unknown }> }>;
      };
    };
    stored.workspace.lines[0]!.feedbackByPly[0]!.record = recordFor(
      before,
      after,
      "user",
    );
    storage.setItem("chess-coach:active-game:v1", JSON.stringify(stored));

    const v2 = loadStoredGame(storage)?.feedbackByPly[0]?.record;
    expect(v2).toMatchObject({ schemaVersion: 2 });
    expect(v2?.explanation).toBeUndefined();
    expect(v2?.presentation).toBeUndefined();
  });

  it("drops malformed contextual records instead of retaining an unverified explanation", () => {
    const storage = memoryStorage();
    const before = createInitialGame();
    const after = applyMove(before, { from: "e2", to: "e4" });
    const contextual = contextualRecordFor(before, after);
    const malformed = {
      ...contextual,
      presentation: {
        ...contextual.presentation!,
        detail: contextual.presentation!.summary,
      },
    } as unknown as CoachTurnRecord;
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
          record: malformed,
        },
      ],
    );
    expect(loadStoredGame(storage)?.feedbackByPly).toEqual([]);
  });

  it("rejects a ready record whose internal FEN does not match its persisted ply", () => {
    const storage = memoryStorage();
    const before = createInitialGame();
    const after = applyMove(before, { from: "e2", to: "e4" });
    const mismatched = {
      ...contextualRecordFor(before, after),
      turn: {
        ...contextualRecordFor(before, after).turn,
        afterFen: before.fen,
      },
    } as CoachTurnRecord;
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
          record: mismatched,
        },
      ],
    );
    expect(loadStoredGame(storage)?.feedbackByPly).toEqual([]);
  });

  it("keeps an unavailable record-free ply when its replay identity is valid", () => {
    const storage = memoryStorage();
    const before = createInitialGame();
    const after = applyMove(before, { from: "e2", to: "e4" });
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
          status: "unavailable",
        },
      ],
    );
    expect(loadStoredGame(storage)?.feedbackByPly).toMatchObject([
      { status: "unavailable", uci: "e2e4" },
    ]);
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

  it("drops only a terminal pending or unavailable live-feedback entry on load", () => {
    const storage = memoryStorage();
    const mate = foolsMate();
    const history = replayHistory(mate);
    const last = history.at(-1)!;
    const previous = history[0]!;

    saveStoredGame(
      mate,
      DEFAULT_SETTINGS,
      storage,
      [],
      [
        {
          historyIndex: previous.historyIndex,
          uci: previous.move.uci,
          actor: "user",
          beforeFen: previous.beforeFen,
          afterFen: previous.afterFen,
          status: "unavailable",
        },
        {
          historyIndex: last.historyIndex,
          uci: last.move.uci,
          actor: "maia",
          beforeFen: last.beforeFen,
          afterFen: last.afterFen,
          status: "pending",
        },
      ],
    );

    expect(loadStoredGame(storage)?.feedbackByPly).toEqual([
      {
        historyIndex: previous.historyIndex,
        uci: previous.move.uci,
        actor: "user",
        beforeFen: previous.beforeFen,
        afterFen: previous.afterFen,
        status: "unavailable",
      },
    ]);
  });

  it("keeps a terminal ready entry, but removes terminal unavailable from a drawn final move", () => {
    const storage = memoryStorage();
    const beforeMate = applyMove(
      applyMove(applyMove(createInitialGame(), { from: "f2", to: "f3" }), {
        from: "e7",
        to: "e5",
      }),
      {
        from: "g2",
        to: "g4",
      },
    );
    const mate = foolsMate();
    const mateEntry = replayHistory(mate).at(-1)!;
    saveStoredGame(
      mate,
      DEFAULT_SETTINGS,
      storage,
      [],
      [
        {
          historyIndex: mateEntry.historyIndex,
          uci: mateEntry.move.uci,
          actor: "maia",
          beforeFen: mateEntry.beforeFen,
          afterFen: mateEntry.afterFen,
          status: "ready",
          record: recordFor(beforeMate, mate, "maia"),
        },
      ],
    );
    expect(loadStoredGame(storage)?.feedbackByPly[0]?.status).toBe("ready");

    const drawStorage = memoryStorage();
    const draw = terminalStalemate();
    const drawEntry = replayHistory(draw).at(-1)!;
    saveStoredGame(
      draw,
      DEFAULT_SETTINGS,
      drawStorage,
      [],
      [
        {
          historyIndex: drawEntry.historyIndex,
          uci: drawEntry.move.uci,
          actor: "user",
          beforeFen: drawEntry.beforeFen,
          afterFen: draw.fen,
          status: "unavailable",
        },
      ],
    );
    expect(loadStoredGame(drawStorage)?.feedbackByPly).toEqual([]);
  });

  it("keeps the workspace feedback as the source of truth for version 6 saves", () => {
    const storage = memoryStorage();
    const before = createInitialGame();
    const after = applyMove(before, { from: "e2", to: "e4" });
    const workspace = updateActiveSessionLine(
      createSessionWorkspace(after),
      (line) => ({
        ...line,
        feedbackByPly: [
          {
            historyIndex: 0,
            uci: "e2e4",
            actor: "user",
            beforeFen: before.fen,
            afterFen: after.fen,
            status: "ready",
            record: recordFor(before, after, "user"),
          },
        ],
      }),
    );
    saveStoredGame(workspace, DEFAULT_SETTINGS, storage);

    const stored = JSON.parse(
      storage.getItem("chess-coach:active-game:v1") ?? "{}",
    ) as {
      feedbackByPly: Array<Record<string, unknown>>;
      workspace: { lines: Array<{ feedbackByPly: unknown[] }> };
    };
    stored.feedbackByPly = [
      {
        historyIndex: 0,
        uci: "e2e4",
        actor: "user",
        beforeFen: before.fen,
        afterFen: after.fen,
        status: "pending",
      },
    ];
    stored.workspace.lines[0]!.feedbackByPly = [
      {
        historyIndex: 0,
        uci: "e2e4",
        actor: "user",
        beforeFen: before.fen,
        afterFen: after.fen,
        status: "ready",
        record: recordFor(before, after, "user"),
      },
    ];
    storage.setItem("chess-coach:active-game:v1", JSON.stringify(stored));

    const loaded = loadStoredGame(storage);
    expect(loaded?.feedbackByPly).toMatchObject([
      {
        status: "ready",
        uci: "e2e4",
      },
    ]);
    expect(loaded?.workspace.lines[0]?.feedbackByPly[0]?.status).toBe("ready");
  });

  it("round-trips a partial post-game review without restoring any pending analysis", () => {
    const storage = memoryStorage();
    const mate = foolsMate();
    const review = createPostgameReviewStateV1({
      session: mate,
      lineId: "trial-mate",
      playerColor: "black",
      feedbackByPly: [],
    });
    const workspace = {
      ...createSessionWorkspace(mate),
      activeLineId: "main",
      postgameReview: review,
    };

    saveStoredGame(workspace, DEFAULT_SETTINGS, storage);

    const restored = loadStoredGame(storage);
    expect(restored?.workspace.postgameReview).toEqual(review);
    expect(restored?.postgameReview?.status).toBe("partial");
    expect(restored?.postgameReview?.progress).toEqual({
      completed: 0,
      total: 4,
    });
  });

  it("prefers the workspace post-game review over a stale top-level copy", () => {
    const storage = memoryStorage();
    const mate = foolsMate();
    const review = createPostgameReviewStateV1({
      session: mate,
      lineId: "main",
      playerColor: "black",
      feedbackByPly: [],
    });
    saveStoredGame(
      {
        ...createSessionWorkspace(mate),
        postgameReview: review,
      },
      DEFAULT_SETTINGS,
      storage,
    );
    const stored = JSON.parse(
      storage.getItem("chess-coach:active-game:v1") ?? "{}",
    ) as {
      postgameReview: { progress: { completed: number } };
      workspace: { postgameReview: unknown };
    };
    stored.postgameReview.progress.completed = 99;
    storage.setItem("chess-coach:active-game:v1", JSON.stringify(stored));

    const restored = loadStoredGame(storage);
    expect(restored?.workspace.postgameReview).toEqual(review);
    expect(restored?.postgameReview).toEqual(review);
  });

  it("round-trips terminal-checkmate postgame evidence through the version 6 union", () => {
    const storage = memoryStorage();
    const mate = foolsMate();
    const baseReview = createPostgameReviewStateV1({
      session: mate,
      lineId: "main",
      playerColor: "black",
      feedbackByPly: [],
    });
    const terminal = completeTerminalCheckmateEvidenceV1(
      baseReview.snapshot,
      "black",
      {
        rank: 1,
        moves: [],
        score: { kind: "centipawns", value: 120 },
      },
    );
    const review = {
      ...baseReview,
      evidence: [terminal],
      summary: baseReview.summary,
      progress: { completed: 1, total: 4 },
    };

    saveStoredGame(
      {
        ...createSessionWorkspace(mate),
        postgameReview: review,
      },
      DEFAULT_SETTINGS,
      storage,
    );

    const restored = loadStoredGame(storage);
    expect(restored?.workspace.postgameReview?.evidence[0]).toEqual(terminal);
    expect(restored?.postgameReview?.evidence[0]?.kind).toBe(
      "terminal-checkmate",
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
