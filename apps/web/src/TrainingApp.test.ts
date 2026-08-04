// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "./persistence";
import { App, GAME_MAIN_CONTENT_ID, initialSettingsForGame } from "./App";
import { Dropdown, DropdownProvider } from "./Dropdown";
import { PUZZLES_V1 } from "@chess-coach/coach";
import {
  ITALIAN_OPENING_COURSE_V1,
  OPENING_COURSES_V1,
} from "@chess-coach/coach";
import { OpeningTraining } from "./OpeningTraining";
import { PuzzleTraining } from "./PuzzleTraining";
import { vi } from "vitest";
import type { ChessEngine } from "@chess-coach/engine";
import { TrainingApp, routeFromHash } from "./TrainingApp";
import { TrainingSelect } from "./TrainingSelect";

describe("training navigation", () => {
  it("accepts only the four hash routes", () => {
    expect(routeFromHash("#/puzzles")).toBe("/puzzles");
    expect(routeFromHash("#/openings")).toBe("/openings");
    expect(routeFromHash("#/unknown")).toBe("/");
  });
  it("uses the game main landmark as the skip-link target", () => {
    expect(GAME_MAIN_CONTENT_ID).toBe("main-content");
  });
  it("renders that target on the game route's main landmark", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () =>
      root.render(
        createElement(App, {
          initialFen:
            "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
        }),
      ),
    );
    expect(
      container.querySelector(`main#${GAME_MAIN_CONTENT_ID}`),
    ).not.toBeNull();
    await act(async () => root.unmount());
    container.remove();
  });
  it("keeps one Más menu with mobile settings and captured pieces", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () =>
      root.render(
        createElement(App, {
          initialFen:
            "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
        }),
      ),
    );
    const menus = container.querySelectorAll("details.utility-menu");
    expect(menus).toHaveLength(1);
    const menu = menus[0]!;
    expect(menu.querySelector("summary")?.textContent).toContain("Más");
    expect(
      menu.querySelectorAll(".utility-menu-captures .captured-tray"),
    ).toHaveLength(2);
    const evaluation = [
      ...menu.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
    ].find((input) =>
      input.closest("label")?.textContent?.includes("evaluación"),
    )!;
    expect(evaluation).toBeTruthy();
    const previous = evaluation.checked;
    await act(async () => evaluation.click());
    expect(evaluation.checked).toBe(!previous);
    await act(async () => root.unmount());
    container.remove();
  });
  it("does not inherit saved black settings when launching a white training FEN", () => {
    const savedBlack = {
      ...DEFAULT_SETTINGS,
      playerColor: "black" as const,
      opponentElo: 2200,
    };
    expect(
      initialSettingsForGame(
        "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
        savedBlack,
      ),
    ).toEqual(DEFAULT_SETTINGS);
    expect(initialSettingsForGame(undefined, savedBlack)).toEqual(savedBlack);
  });
});

async function selectTrainingOption(
  container: HTMLElement,
  label: string,
  option: string,
) {
  const trigger = [
    ...container.querySelectorAll<HTMLButtonElement>("button"),
  ].find(
    (button) =>
      button.getAttribute("aria-labelledby")?.includes("label") &&
      button.textContent?.includes(label),
  );
  // The accessible label is on the neighbouring span; selecting by visible value is resilient to generated ids.
  const control =
    trigger ??
    [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.includes("Explicación"),
    )!;
  await act(async () => control.click());
  const choice = [
    ...container.querySelectorAll<HTMLButtonElement>('[role="option"]'),
  ].find((button) => button.textContent === option)!;
  await act(async () => choice.click());
}

describe("opening explanation navigation", () => {
  let root: Root;
  let container: HTMLDivElement;
  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });
  it("uses explicit arrow navigation and never renders autoplay controls", async () => {
    await act(async () =>
      root.render(
        createElement(OpeningTraining, {
          course: ITALIAN_OPENING_COURSE_V1,
          onContinueGame: () => undefined,
        }),
      ),
    );
    expect(container.textContent).toContain(
      `Paso 1 de ${ITALIAN_OPENING_COURSE_V1.explanationSteps.length}`,
    );
    const next = container.querySelector<HTMLButtonElement>(
      '[aria-label="Paso siguiente de la explicación"]',
    )!;
    await act(async () => next.click());
    expect(container.textContent).toContain("Paso 2 de");
    expect(container.textContent).not.toContain("Autoplay");
    expect(
      container.querySelectorAll(".training-arrow-player").length,
    ).toBeGreaterThan(0);
    expect(
      container.querySelectorAll(".training-arrow-opponent").length,
    ).toBeGreaterThan(0);
    expect(container.querySelector(".training-board-arrows marker")).toBeNull();
    expect(
      container.querySelectorAll(".training-arrowhead").length,
    ).toBeGreaterThan(0);
    expect(
      container.querySelector(".training-arrowhead-player"),
    ).not.toBeNull();
    expect(
      container.querySelector(".training-arrowhead")?.getAttribute("points"),
    ).not.toContain("NaN");
    await selectTrainingOption(container, "Modo", "Práctica");
    expect(container.textContent).toContain("Práctica guiada");
  });

  it("requires the blue move and then the red reply before advancing", async () => {
    await act(async () =>
      root.render(
        createElement(OpeningTraining, {
          courses: OPENING_COURSES_V1,
          onContinueGame: () => undefined,
        }),
      ),
    );
    const square = (name: string) =>
      container.querySelector<HTMLButtonElement>(
        `button[aria-label^="${name},"]`,
      )!;
    await act(async () => square("d2").click());
    await act(async () => square("d4").click());
    expect(container.textContent).toContain(
      "no es el movimiento de esta lección",
    );
    expect(square("e2").getAttribute("aria-label")).toContain("pieza blanca");
    await act(async () => square("e2").click());
    await act(async () => square("e4").click());
    expect(container.textContent).toContain(
      "respuesta principal marcada en rojo",
    );
    await act(async () => square("e7").click());
    await act(async () => square("e5").click());
    expect(container.textContent).toContain("Paso 2 de");
  });
});

describe("opening game handoff", () => {
  let root: Root;
  let container: HTMLDivElement;
  beforeEach(() => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: () => ({
        matches: true,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }),
    });
    window.localStorage.clear();
    window.location.hash = "#/openings";
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    window.localStorage.clear();
    window.location.hash = "#/";
  });
  it("consumes the opening FEN once so a later game visit restores the played workspace", async () => {
    await act(async () => root.render(createElement(TrainingApp)));
    await selectTrainingOption(container, "Modo", "Práctica");
    const continueButton = [
      ...container.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) => button.textContent === "Continuar como partida")!;
    await act(async () => continueButton.click());
    const square = (name: string) =>
      container.querySelector<HTMLButtonElement>(
        `button[aria-label^="${name},"]`,
      )!;
    await act(async () => square("e2").click());
    await act(async () => square("e4").click());
    expect(square("e4").getAttribute("aria-label")).toContain("pieza blanca");
    await act(async () => {
      window.location.hash = "#/";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    await act(async () => {
      window.location.hash = "#/game";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(square("e4").getAttribute("aria-label")).toContain("pieza blanca");
    expect(square("e2").getAttribute("aria-label")).toContain("vacía");
  });
});

describe("opening engine evidence", () => {
  let root: Root;
  let container: HTMLDivElement;
  const fakeEngine = (): ChessEngine => ({
    analyze: vi.fn(),
    dispose: vi.fn(async () => undefined),
    getStatus: () => ({ backend: "stockfish-wasm", availability: "ready" }),
  });
  const enterPractice = async (
    collectEvidence: NonNullable<
      Parameters<typeof OpeningTraining>[0]["collectEvidence"]
    >,
  ) => {
    await act(async () =>
      root.render(
        createElement(OpeningTraining, {
          course: ITALIAN_OPENING_COURSE_V1,
          onContinueGame: () => undefined,
          engineFactory: fakeEngine,
          collectEvidence,
        }),
      ),
    );
    await selectTrainingOption(container, "Modo", "Práctica");
    const square = (name: string) =>
      container.querySelector<HTMLButtonElement>(
        `button[aria-label^="${name},"]`,
      )!;
    await act(async () => square("e2").click());
    await act(async () => square("e4").click());
    await act(async () => Promise.resolve());
    return square;
  };
  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });
  it("plays an evidence-verified repertoire response", async () => {
    const square = await enterPractice(async (_engine, request) => ({
      kind: "ok",
      id: request.id,
      backend: "stockfish-wasm",
      evidence: {
        best: {
          rank: 1,
          score: { kind: "centipawns", value: 0 },
          moves: ["e7e5"],
        },
        candidates: [
          {
            move: "e7e5",
            line: {
              rank: 1,
              score: { kind: "centipawns", value: 0 },
              moves: ["e7e5"],
            },
          },
        ],
        engineBestMove: "e7e5",
      },
    }));
    expect(square("e5").getAttribute("aria-label")).toContain("pieza negra");
    expect(container.textContent).toContain("repertorio verificada");
  });
  it("uses the engine fallback only when evidence rejects the repertoire", async () => {
    const square = await enterPractice(async (_engine, request) => ({
      kind: "ok",
      id: request.id,
      backend: "stockfish-wasm",
      evidence: {
        best: {
          rank: 1,
          score: { kind: "centipawns", value: 0 },
          moves: ["c7c5"],
        },
        candidates: [
          {
            move: "e7e5",
            line: {
              rank: 1,
              score: { kind: "centipawns", value: -500 },
              moves: ["e7e5", "g1f3"],
            },
          },
        ],
        engineBestMove: "c7c5",
      },
    }));
    expect(square("c5").getAttribute("aria-label")).toContain("pieza negra");
    expect(container.textContent).toContain("fuera del repertorio");
  });
  it("reports unavailable evidence without moving a supposedly safe reply", async () => {
    const square = await enterPractice(async (_engine, request) => ({
      kind: "unavailable",
      id: request.id,
      reason: "worker unavailable",
    }));
    await act(async () => square("e7").click());
    await act(async () => square("e5").click());
    expect(square("e5").getAttribute("aria-label")).toContain("vacía");
    expect(square("e7").getAttribute("aria-label")).toContain("pieza negra");
    expect(square("e7").disabled).toBe(true);
    expect(container.textContent).toContain("No se pudo verificar");
    expect(container.textContent).toContain("Reintentar análisis");
  });
  it("aborts a stale analysis when leaving practice", async () => {
    let captured: AbortSignal | undefined;
    const collectEvidence = vi.fn(
      (_engine: ChessEngine, _request: unknown, signal?: AbortSignal) =>
        new Promise<never>((_resolve, reject) => {
          captured = signal;
          signal?.addEventListener(
            "abort",
            () => reject(new DOMException("cancelled", "AbortError")),
            { once: true },
          );
        }),
    );
    await enterPractice(collectEvidence);
    expect(captured?.aborted).toBe(false);
    const cancel = [
      ...container.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) => button.textContent === "Cancelar análisis")!;
    await act(async () => cancel.click());
    expect(captured?.aborted).toBe(true);
    const square = (name: string) =>
      container.querySelector<HTMLButtonElement>(
        `button[aria-label^="${name},"]`,
      )!;
    await act(async () => square("e7").click());
    await act(async () => square("e5").click());
    expect(square("e5").getAttribute("aria-label")).toContain("vacía");
    expect(square("e7").getAttribute("aria-label")).toContain("pieza negra");
  });
});

describe("dropdown", () => {
  let root: Root;
  let container: HTMLDivElement;
  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });
  it("keeps one panel mounted, closes on selection and restores trigger focus", async () => {
    await act(async () =>
      root.render(
        createElement(
          DropdownProvider,
          null,
          createElement(Dropdown, {
            label: "Opciones",
            children: createElement(
              "button",
              { type: "button", role: "menuitem" },
              "Elegir",
            ),
          }),
        ),
      ),
    );
    const trigger = container.querySelector<HTMLButtonElement>("button")!;
    await act(async () => trigger.click());
    expect(container.querySelector('[role="menu"]')).not.toBeNull();
    const item = container.querySelectorAll<HTMLButtonElement>("button")[1]!;
    await act(async () => item.click());
    expect(container.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});

describe("training select", () => {
  let root: Root;
  let container: HTMLDivElement;
  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });
  it("supports keyboard selection, Escape focus restoration, and outside dismissal", async () => {
    const changes: string[] = [];
    await act(async () =>
      root.render(
        createElement(TrainingSelect, {
          label: "Ejercicio",
          value: "one",
          options: [
            { value: "one", label: "Uno" },
            { value: "two", label: "Dos" },
          ],
          onChange: (value) => changes.push(value),
        }),
      ),
    );
    const trigger = container.querySelector<HTMLButtonElement>("button")!;
    await act(async () => trigger.click());
    expect(container.querySelector('[role="listbox"]')).not.toBeNull();
    await act(async () =>
      trigger.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      ),
    );
    expect(changes).toEqual(["two"]);
    await act(async () => trigger.click());
    await act(async () =>
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ),
    );
    expect(container.querySelector('[role="listbox"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    await act(async () => trigger.click());
    await act(async () =>
      document.body.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true }),
      ),
    );
    expect(container.querySelector('[role="listbox"]')).toBeNull();
  });
});

describe("puzzle interaction", () => {
  let root: Root;
  let container: HTMLDivElement;
  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });
  it("accepts a board origin/destination and announces the automatic reply", async () => {
    await act(async () =>
      root.render(
        createElement(PuzzleTraining, {
          puzzles: PUZZLES_V1,
          completedIds: [],
          onComplete: () => undefined,
        }),
      ),
    );
    const square = (name: string) =>
      container.querySelector<HTMLButtonElement>(
        `button[aria-label^="${name},"]`,
      )!;
    await act(async () => {
      square("h5").click();
    });
    await act(async () => {
      square("f7").click();
    });
    expect(container.textContent).toContain(
      "El rival responde automáticamente",
    );
    expect(square("h8").getAttribute("aria-label")).toContain("pieza negra");
  });
});
