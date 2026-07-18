import { describe, expect, it } from "vitest";
import { applyMove, createInitialGame } from "@chess-coach/chess-core";
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

describe("local persistence", () => {
  it("round-trips a versioned session", () => {
    const storage = memoryStorage();
    const session = createInitialGame();
    saveStoredGame(session, DEFAULT_SETTINGS, storage);

    expect(loadStoredGame(storage)).toMatchObject({
      version: 2,
      session: { fen: session.fen, pgn: session.pgn },
      settings: DEFAULT_SETTINGS,
      annotations: [],
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
      version: 2,
      annotations: [],
    });
  });
});
