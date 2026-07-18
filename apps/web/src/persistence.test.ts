import { describe, expect, it } from "vitest";
import { createInitialGame } from "@chess-coach/chess-core";
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
      version: 1,
      session: { fen: session.fen, pgn: session.pgn },
      settings: DEFAULT_SETTINGS,
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
});
