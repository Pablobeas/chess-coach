import { applyMove, createInitialGame } from "@chess-coach/chess-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createMoveAnimation,
  ENGINE_RESPONSE_DELAY_MS,
  isEditableKeyboardTarget,
  waitForDelay,
} from "./gameInteractions";

describe("game interactions", () => {
  afterEach(() => vi.useRealTimers());

  it("resolves an empty response delay without scheduling a timer", async () => {
    vi.useFakeTimers();
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    await expect(
      waitForDelay(ENGINE_RESPONSE_DELAY_MS, new AbortController().signal),
    ).resolves.toBeUndefined();

    expect(ENGINE_RESPONSE_DELAY_MS).toBe(0);
    expect(setTimeoutSpy).not.toHaveBeenCalled();
  });

  it("cancels a pending response delay", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const pending = waitForDelay(1, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
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
