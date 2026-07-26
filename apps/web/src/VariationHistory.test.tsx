// @vitest-environment jsdom
import { createInitialGame, applyMove } from "@chess-coach/chess-core";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VariationHistory } from "./VariationHistory";
import { createSessionWorkspace, createTrialLine, updateActiveSessionLine } from "./sessionWorkspace";

describe("VariationHistory", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => { container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
  it("renders nested selectable move buttons and confirms only variant deletion", async () => {
    const e4 = applyMove(createInitialGame(), { from: "e2", to: "e4" });
    const workspace = updateActiveSessionLine(createTrialLine(createSessionWorkspace(createInitialGame()), "v1"), (line) => ({ ...line, timeline: { session: e4, cursor: 1 } }));
    const onSelect = vi.fn(); const onDelete = vi.fn();
    await act(async () => root.render(createElement(VariationHistory, { workspace, onSelect, onDelete })));
    const move = [...container.querySelectorAll(".variation-moves button")].find((item) => item.textContent === "e4") as HTMLButtonElement;
    await act(async () => move.click());
    expect(onSelect).toHaveBeenCalledWith("v1", 1);
    expect(container.querySelectorAll(".variation-delete")).toHaveLength(1);
    await act(async () => (container.querySelector(".variation-delete") as HTMLButtonElement).click());
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain("Eliminar esta variante");
  });

  it("selects a variant move with keyboard Enter", async () => {
    const e4 = applyMove(createInitialGame(), { from: "e2", to: "e4" });
    const workspace = updateActiveSessionLine(createTrialLine(createSessionWorkspace(createInitialGame()), "v1"), (line) => ({ ...line, timeline: { session: e4, cursor: 1 } }));
    const onSelect = vi.fn();
    await act(async () => root.render(createElement(VariationHistory, { workspace, onSelect, onDelete: vi.fn() })));
    const move = container.querySelector('.variation-moves button') as HTMLButtonElement;
    move.focus();
    await act(async () => move.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(document.activeElement).toBe(move);
    expect(move.getAttribute('aria-current')).toBe('step');
    await act(async () => move.click());
    expect(onSelect).toHaveBeenCalledWith('v1', 1);
  });
});
