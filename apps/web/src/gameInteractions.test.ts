import { applyMove, createInitialGame } from "@chess-coach/chess-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createMoveAnimation,
  ENGINE_RESPONSE_DELAY_MS,
  isEditableKeyboardTarget,
  opponentMoveSquareAccessibilityLabel,
  opponentMoveSquareRole,
  opponentLastMoveHighlight,
  waitForDelay,
} from "./gameInteractions";

describe("game interactions", () => {
  afterEach(() => vi.useRealTimers());

  it("waits exactly 500 ms before applying an opponent response", async () => {
    vi.useFakeTimers();
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const pending = waitForDelay(
      ENGINE_RESPONSE_DELAY_MS,
      new AbortController().signal,
    );

    expect(ENGINE_RESPONSE_DELAY_MS).toBe(500);
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 500);
    await vi.advanceTimersByTimeAsync(500);

    await expect(pending).resolves.toBeUndefined();
  });

  it("cancels a pending response delay", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const pending = waitForDelay(1, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("highlights the latest visible opponent move until the user moves", () => {
    const initial = createInitialGame();
    const afterPlayerMove = applyMove(initial, { from: "e2", to: "e4" });
    const afterOpponentMove = applyMove(afterPlayerMove, {
      from: "e7",
      to: "e5",
    });

    expect(opponentLastMoveHighlight(afterPlayerMove, "white")).toBeUndefined();
    expect(opponentLastMoveHighlight(afterOpponentMove, "white")).toEqual({
      from: "e7",
      to: "e5",
    });
    expect(
      opponentLastMoveHighlight(
        applyMove(afterOpponentMove, { from: "g1", to: "f3" }),
        "white",
      ),
    ).toBeUndefined();
  });

  it("derives highlights from the active line and player color", () => {
    const afterE4 = applyMove(createInitialGame(), { from: "e2", to: "e4" });
    expect(opponentLastMoveHighlight(afterE4, "black")).toEqual({
      from: "e2",
      to: "e4",
    });
    expect(opponentLastMoveHighlight(afterE4, "white")).toBeUndefined();
  });

  it("provides semantic roles and labels for both highlighted squares", () => {
    const highlight = { from: "e7", to: "e5" } as const;
    const origin = opponentMoveSquareRole("e7", highlight);
    const destination = opponentMoveSquareRole("e5", highlight);

    expect(origin).toBe("from");
    expect(destination).toBe("to");
    expect(opponentMoveSquareRole("e6", highlight)).toBeUndefined();
    expect(opponentMoveSquareAccessibilityLabel(origin)).toContain("origen");
    expect(opponentMoveSquareAccessibilityLabel(destination)).toContain(
      "destino",
    );
  });

  it("ignores keyboard shortcuts in editable controls", () => {
    expect(isEditableKeyboardTarget({ tagName: "INPUT" } as never)).toBe(true);
    expect(isEditableKeyboardTarget({ tagName: "TEXTAREA" } as never)).toBe(
      true,
    );
    expect(isEditableKeyboardTarget({ tagName: "SELECT" } as never)).toBe(true);
    expect(isEditableKeyboardTarget({ tagName: "BUTTON" } as never)).toBe(
      false,
    );
  });

  it("keeps a captured piece visible during movement", () => {
    const afterE4 = applyMove(createInitialGame(), { from: "e2", to: "e4" });
    const afterD5 = applyMove(afterE4, { from: "d7", to: "d5" });
    const animation = createMoveAnimation(afterD5, "e4", "d5");

    expect(animation?.pieces).toHaveLength(1);
    expect(animation?.captured).toMatchObject({ color: "black", type: "p" });
    expect(animation?.captureSquare).toBe("d5");
  });

  it("animates both king and rook when castling", () => {
    let game = createInitialGame();
    for (const move of [
      { from: "e2", to: "e4" },
      { from: "e7", to: "e5" },
      { from: "g1", to: "f3" },
      { from: "b8", to: "c6" },
      { from: "f1", to: "c4" },
      { from: "g8", to: "f6" },
    ]) {
      game = applyMove(game, move);
    }

    expect(createMoveAnimation(game, "e1", "g1")?.pieces).toEqual([
      expect.objectContaining({ from: "e1", to: "g1" }),
      expect.objectContaining({ from: "h1", to: "f1" }),
    ]);
  });
});
