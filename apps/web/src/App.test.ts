// @vitest-environment jsdom
import { loadPgn, loadPosition } from "@chess-coach/chess-core";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  GameTurnStatus,
  browserOpponentModeForBuild,
  describeGameTurnStatus,
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

describe("terminal turn status", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("replaces the stale turn label with a checkmate result in the live status", async () => {
    const game = loadPgn("1. f3 e5 2. g4 Qh4# 0-1");

    await act(async () => {
      root.render(
        createElement(GameTurnStatus, {
          status: describeGameTurnStatus(game, "white"),
        }),
      );
    });

    const status = container.querySelector('[role="status"]');
    expect(status?.textContent).toContain("Jaque mate");
    expect(status?.textContent).toContain("Ganan negras");
    expect(status?.textContent).toContain("Tú juegas con blancas");
    expect(status?.textContent).not.toContain("Turno de");
    expect(status?.getAttribute("aria-live")).toBe("polite");
    expect(status?.querySelector(".turn-indicator")).toBeNull();
  });

  it("announces drawn terminal positions without reusing the turn label", async () => {
    const game = loadPosition("7k/5Q2/7K/8/8/8/8/8 b - - 0 1");

    await act(async () => {
      root.render(
        createElement(GameTurnStatus, {
          status: describeGameTurnStatus(game, "black"),
        }),
      );
    });

    const status = container.querySelector('[role="status"]');
    expect(status?.textContent).toContain("Tablas");
    expect(status?.textContent).toContain("Empate");
    expect(status?.textContent).toContain("Tú juegas con negras");
    expect(status?.textContent).not.toContain("Turno de");
  });
});
