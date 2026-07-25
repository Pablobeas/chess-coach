// @vitest-environment jsdom
import {
  applyMove,
  createInitialGame,
  listLegalMoves,
} from "@chess-coach/chess-core";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  orderedWorkspaceLines,
  PromotionSuggestion,
  trialLabel,
  WorkspaceLinePanel,
} from "./SessionWorkspaceControls";
import {
  createSessionWorkspace,
  createTrialLine,
  deleteSessionLine,
  promoteSessionLine,
  shouldPromptPromotion,
  updateActiveSessionLine,
} from "./sessionWorkspace";

function buttonByName(container: HTMLElement, name: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button")).find(
    (candidate) =>
      candidate.getAttribute("aria-label") === name ||
      candidate.textContent?.trim() === name,
  );
  if (!button) throw new Error(`Button not found: ${name}`);
  return button;
}

function DeletionHarness({ trialCount }: { readonly trialCount: number }) {
  const [workspace, setWorkspace] = useState(() => {
    let next = createSessionWorkspace(createInitialGame());
    for (let index = 1; index <= trialCount; index += 1) {
      next = createTrialLine(next, `trial-${index}`);
    }
    return next;
  });
  return (
    <WorkspaceLinePanel
      workspace={workspace}
      onSelect={vi.fn()}
      onReturnToMain={vi.fn()}
      onPromote={vi.fn()}
      onDelete={(lineId) =>
        setWorkspace((current) => deleteSessionLine(current, lineId))
      }
      onContextChange={vi.fn()}
    />
  );
}

describe("workspace line presentation", () => {
  it("has no trial labels when the workspace only has a main line", () => {
    const workspace = createSessionWorkspace(createInitialGame());
    expect(orderedWorkspaceLines(workspace).map((line) => line.id)).toEqual([
      "main",
    ]);
  });

  it("always presents the principal line first and derives trial numbers", () => {
    let workspace = createTrialLine(
      createSessionWorkspace(createInitialGame()),
      "trial-a",
    );
    workspace = createTrialLine(workspace, "trial-b");
    workspace = promoteSessionLine(workspace, "trial-a");

    expect(orderedWorkspaceLines(workspace).map((line) => line.id)).toEqual([
      "trial-a",
      "main",
      "trial-b",
    ]);
    expect(trialLabel(workspace, "main")).toBe("Prueba 1");
    expect(trialLabel(workspace, "trial-b")).toBe("Prueba 2");
  });
});

describe("WorkspaceLinePanel deletion dialog", () => {
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
    vi.restoreAllMocks();
  });

  async function renderTrialPanel(onDelete = vi.fn()) {
    const workspace = createTrialLine(
      createSessionWorkspace(createInitialGame()),
      "trial-1",
    );
    await act(async () => {
      root.render(
        <WorkspaceLinePanel
          workspace={workspace}
          onSelect={vi.fn()}
          onReturnToMain={vi.fn()}
          onPromote={vi.fn()}
          onDelete={onDelete}
          onContextChange={vi.fn()}
        />,
      );
    });
    await act(async () => buttonByName(container, "Pruebas (1)").click());
    await act(async () =>
      buttonByName(container, "Opciones de Prueba 1").click(),
    );
    return onDelete;
  }

  it("opens a native dialog from the accessible Eliminar action and only deletes on confirmation", async () => {
    const onDelete = await renderTrialPanel();
    const optionsTrigger = buttonByName(container, "Opciones de Prueba 1");
    const stableDialog = container.querySelector("dialog");

    await act(async () => buttonByName(container, "Eliminar").click());
    const dialog = container.querySelector("dialog");
    expect(dialog).toBe(stableDialog);
    expect(dialog?.open).toBe(true);
    expect(dialog?.textContent).toContain("jugadas, comentarios y análisis");
    expect(document.activeElement).toBe(buttonByName(container, "Cancelar"));
    expect(container.querySelector(".trial-options-menu")).toBeNull();

    await act(async () => buttonByName(container, "Cancelar").click());
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(onDelete).not.toHaveBeenCalled();
    expect(container.querySelector("dialog")).toBe(stableDialog);
    expect(container.querySelector("dialog")?.open).toBe(false);
    expect(document.activeElement).toBe(optionsTrigger);

    await act(async () => optionsTrigger.click());
    await act(async () => buttonByName(container, "Eliminar").click());
    await act(async () =>
      container
        .querySelector("dialog")
        ?.dispatchEvent(new Event("cancel", { cancelable: true })),
    );
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(onDelete).not.toHaveBeenCalled();
    expect(container.querySelector("dialog")).toBe(stableDialog);
    expect(container.querySelector("dialog")?.open).toBe(false);
    expect(document.activeElement).toBe(optionsTrigger);

    await act(async () => optionsTrigger.click());
    await act(async () => buttonByName(container, "Eliminar").click());
    await act(async () => buttonByName(container, "Eliminar prueba").click());
    expect(onDelete).toHaveBeenCalledWith("trial-1");
    expect(container.querySelector("dialog")).toBe(stableDialog);
    expect(container.querySelector("dialog")?.open).toBe(false);
  });

  it("falls back to an open native dialog when jsdom has no showModal", async () => {
    expect(HTMLDialogElement.prototype.showModal).toBeUndefined();
    await renderTrialPanel();
    await act(async () => buttonByName(container, "Eliminar").click());
    expect(container.querySelector("dialog")?.hasAttribute("open")).toBe(true);
  });

  it("focuses the stable status after confirming deletion of the final trial", async () => {
    await act(async () => root.render(<DeletionHarness trialCount={1} />));
    await act(async () => buttonByName(container, "Pruebas (1)").click());
    await act(async () =>
      buttonByName(container, "Opciones de Prueba 1").click(),
    );
    await act(async () => buttonByName(container, "Eliminar").click());
    await act(async () => buttonByName(container, "Eliminar prueba").click());
    await new Promise((resolve) => window.setTimeout(resolve, 0));

    const fallback = container.querySelector<HTMLElement>(
      "[data-workspace-deletion-status]",
    );
    expect(fallback?.textContent).toBe(
      "La prueba se eliminó. Estás en la partida principal.",
    );
    expect(document.activeElement).toBe(fallback);
    expect(container.querySelector(".workspace-lines")).toBeNull();
  });

  it("focuses the remaining trials control after deleting one of several trials", async () => {
    await act(async () => root.render(<DeletionHarness trialCount={2} />));
    await act(async () => buttonByName(container, "Pruebas (2)").click());
    await act(async () =>
      buttonByName(container, "Opciones de Prueba 1").click(),
    );
    await act(async () => buttonByName(container, "Eliminar").click());
    await act(async () => buttonByName(container, "Eliminar prueba").click());
    await new Promise((resolve) => window.setTimeout(resolve, 0));

    expect(document.activeElement).toBe(buttonByName(container, "Pruebas (1)"));
  });
});

describe("PromotionSuggestion", () => {
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

  it("only exposes the simplified promotion actions when the prompt is rendered", async () => {
    let workspace = createTrialLine(
      createSessionWorkspace(createInitialGame()),
      "trial-1",
    );
    let session = createInitialGame();
    for (let index = 0; index < 4; index += 1) {
      session = applyMove(session, listLegalMoves(session.fen)[0]!);
    }
    workspace = updateActiveSessionLine(workspace, (line) => ({
      ...line,
      timeline: { session, cursor: session.history.length },
    }));
    expect(shouldPromptPromotion(workspace)).toBe(true);

    await act(async () => {
      root.render(
        <PromotionSuggestion onPromote={vi.fn()} onDismiss={vi.fn()} />,
      );
    });
    expect(buttonByName(container, "Hacer principal")).toBeTruthy();
    expect(buttonByName(container, "Ahora no")).toBeTruthy();
    expect(container.textContent).not.toContain("Volver a la partida");
  });
});
