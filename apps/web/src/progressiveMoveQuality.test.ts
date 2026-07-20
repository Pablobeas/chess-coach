import { describe, expect, it } from "vitest";
import {
  boardMoveQualityAnnotation,
  MINIMUM_PROVISIONAL_QUALITY_DEPTH,
  updateProvisionalMoveQuality,
  visibleMoveQualityAnnotations,
} from "./progressiveMoveQuality";

describe("progressive move quality", () => {
  it("waits for a useful depth and avoids rerenders while the label is stable", () => {
    const shallow = updateProvisionalMoveQuality(undefined, {
      historyIndex: 4,
      uci: "e2e4",
      label: "good",
      depth: MINIMUM_PROVISIONAL_QUALITY_DEPTH - 1,
    });
    expect(shallow).toBeUndefined();

    const visible = updateProvisionalMoveQuality(undefined, {
      historyIndex: 4,
      uci: "e2e4",
      label: "good",
      depth: MINIMUM_PROVISIONAL_QUALITY_DEPTH,
    });
    expect(visible).toMatchObject({ provisional: true, label: "good" });
    expect(
      updateProvisionalMoveQuality(visible, {
        historyIndex: 4,
        uci: "e2e4",
        label: "good",
        depth: MINIMUM_PROVISIONAL_QUALITY_DEPTH + 4,
      }),
    ).toBe(visible);
  });

  it("replaces a changed provisional label but never regresses depth", () => {
    const current = updateProvisionalMoveQuality(undefined, {
      historyIndex: 4,
      uci: "e2e4",
      label: "good",
      depth: 10,
    });
    expect(
      updateProvisionalMoveQuality(current, {
        historyIndex: 4,
        uci: "e2e4",
        label: "mistake",
        depth: 9,
      }),
    ).toBe(current);
    expect(
      updateProvisionalMoveQuality(current, {
        historyIndex: 4,
        uci: "e2e4",
        label: "excellent",
        depth: 11,
      }),
    ).toMatchObject({ label: "excellent", depth: 11 });
  });

  it("shows only a current provisional and lets the final annotation win", () => {
    const provisional = updateProvisionalMoveQuality(undefined, {
      historyIndex: 0,
      uci: "e2e4",
      label: "good",
      depth: 8,
    });
    expect(
      visibleMoveQualityAnnotations([], provisional, [{ uci: "e2e4" }]),
    ).toHaveLength(1);
    expect(
      visibleMoveQualityAnnotations([], provisional, [{ uci: "d2d4" }]),
    ).toHaveLength(0);

    const completed = [
      { historyIndex: 0, uci: "e2e4", label: "excellent" },
    ] as const;
    expect(
      visibleMoveQualityAnnotations(completed, provisional, [{ uci: "e2e4" }]),
    ).toBe(completed);
  });

  it("keeps the player's latest icon after the engine replies", () => {
    const annotations = [
      { historyIndex: 0, uci: "e2e4", label: "excellent" },
    ] as const;

    expect(
      boardMoveQualityAnnotation(
        annotations,
        [{ uci: "e2e4" }, { uci: "e7e5" }],
        "white",
        "white",
      ),
    ).toBe(annotations[0]);
  });

  it("removes the previous icon as soon as the player moves again", () => {
    const annotations = [
      { historyIndex: 0, uci: "e2e4", label: "excellent" },
    ] as const;

    expect(
      boardMoveQualityAnnotation(
        annotations,
        [{ uci: "e2e4" }, { uci: "e7e5" }, { uci: "g1f3" }],
        "white",
        "white",
      ),
    ).toBeUndefined();
  });

  it("supports a player moving second from a black-to-move position", () => {
    const annotations = [
      { historyIndex: 1, uci: "e2e4", label: "good" },
    ] as const;

    expect(
      boardMoveQualityAnnotation(
        annotations,
        [{ uci: "e7e5" }, { uci: "e2e4" }, { uci: "g8f6" }],
        "white",
        "black",
      ),
    ).toBe(annotations[0]);
  });
});
