// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  browserOpponentModeForBuild,
  initialOpponentNameForMode,
  opponentNameForBackend,
  readCurrentBuildId,
} from "./App";

describe("opponent backend labels", () => {
  it("never represents Stockfish as an exact Elo opponent", () => {
    expect(opponentNameForBackend("stockfish-wasm")).toBe("Stockfish local");
    expect(opponentNameForBackend("stockfish-asmjs")).toBe("Stockfish local");
  });

  it("shows the local Maia backend by its real name", () => {
    expect(opponentNameForBackend("maia3-local")).toBe("Maia-3 local");
  });

  it("forces hosted mode in production even when the deployed host is localhost", () => {
    expect(browserOpponentModeForBuild(true)).toBe("hosted");
    expect(browserOpponentModeForBuild(false)).toBe("auto");
    expect(initialOpponentNameForMode("hosted")).toBe("Stockfish local");
    expect(initialOpponentNameForMode("auto")).toBe("Maia-3 local");
  });

  it("keeps the active shell build id when a newer version manifest exists", () => {
    document.head.innerHTML =
      '<meta name="chess-coach-build-id" content="build-n" />';
    expect(readCurrentBuildId()).toBe("build-n");
    // A fetched version.json is deliberately not an input to this reader:
    // N+1 stays an available update until the active controller changes.
    expect(readCurrentBuildId()).not.toBe("build-n1");
  });
});
