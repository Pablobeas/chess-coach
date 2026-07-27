import {
  applyUciMove,
  createInitialGame,
  positionKeyForFen,
  type GameSession,
} from "@chess-coach/chess-core";
import type { OpeningCourseV1, OpeningNodeV1 } from "../training/openings.js";
import type { PuzzleV1 } from "../training/puzzles.js";

const advance = (
  session: GameSession,
  ...moves: readonly string[]
): GameSession =>
  moves.reduce((position, move) => applyUciMove(position, move), session);
const initial = createInitialGame();
const after = (...moves: readonly string[]) => advance(initial, ...moves);
const verified = {
  engine: "stockfish" as const,
  status: "verified" as const,
  source:
    "Stockfish 18 Lite WASM local; el bundle del navegador se copió byte a byte a un par temporal compatible con Node para analizarlo. Licencia GPL-3.0 (Copying.txt).",
  analysis: {
    version: "Stockfish 18 Lite WASM (Stockfish 18; package 18.0.8)",
    verifiedOn: "2026-07-27",
    license: "GPL-3.0" as const,
    jsSha256:
      "5243FD9B276CAB7DFE3AD1D43AB9EAD73568FAC76468C614242977A210C4A391",
    wasmSha256:
      "A8FBC05EC6920B56D7485826DCB02C5FFD2826BCBF751CF973046F237A9096F1",
    budget: {
      hashMegabytes: 16,
      userMoveNodes: 50_000,
      replyMoveNodes: 50_000,
      userMoveMultiPvLimit: 4,
      materialAdvantageCentipawns: 150,
      policy: {
        userMoveMustMatch: "engine-best-line-in-node",
        replyMoveMustMatch: "engine-best-defense-in-child-node",
        objectiveValidation:
          "terminal mate requires checkmate; material requires positive engine or material proof",
      },
    },
  },
} as const;

/** Legal, curated MVP data. Verification provenance remains deliberately honest. */
export const PUZZLES_V1: readonly PuzzleV1[] = Object.freeze([
  {
    schemaVersion: 1,
    id: "bishop-corridor-mate",
    fen: "6k1/5ppp/8/7Q/2B5/8/6PP/6K1 w - - 0 1",
    sideToMove: "white",
    theme: "mate",
    difficulty: "beginner",
    objective: "Usa la dama y el alfil para forzar un mate en la octava fila.",
    solution: [
      {
        userMove: "h5f7",
        reply: "g8h8",
        next: [{ userMove: "f7e8" }],
      },
    ],
    explanation:
      "El alfil protege f7: la captura da jaque, obliga al rey a h8 y permite el remate de dama en e8.",
    resultingAdvantage: "Jaque mate en e8.",
    verification: verified,
    hints: [
      "Busca un jaque que obligue al rey a h8.",
      "El alfil de c4 protege el punto f7.",
      "Captura el peón de f7 con la dama.",
      "La primera jugada es h5f7+.",
    ],
  },
  {
    schemaVersion: 1,
    id: "bishop-queen-corridor-mate",
    fen: "6k1/5ppp/8/2b5/7q/8/5P1P/6K1 b - - 0 1",
    sideToMove: "black",
    theme: "mate",
    difficulty: "beginner",
    objective: "Aprovecha la protección del alfil para encerrar al rey blanco.",
    solution: [
      { userMove: "h4f2", reply: "g1h1", next: [{ userMove: "f2f1" }] },
    ],
    explanation:
      "El alfil protege f2, así que la dama puede capturar con jaque; tras Rh1, la entrada en f1 es mate.",
    resultingAdvantage: "Jaque mate en f1.",
    verification: verified,
    hints: [
      "Busca una captura con jaque sobre f2.",
      "El alfil de c5 protege la dama en f2.",
      "Tras Rh1, la dama puede ocupar f1.",
      "La primera jugada es h4f2+.",
    ],
  },
  {
    schemaVersion: 1,
    id: "queen-rook-mate",
    fen: "6k1/5ppp/8/7Q/8/8/6PP/5RK1 w - - 0 1",
    sideToMove: "white",
    theme: "mate",
    difficulty: "beginner",
    objective: "Fuerza al rey a la esquina y remata sobre la octava fila.",
    solution: [
      {
        userMove: "h5f7",
        reply: "g8h8",
        next: [{ userMove: "f7e8" }],
      },
    ],
    explanation:
      "La dama captura con jaque y el rey sólo puede ir a h8; el remate en e8 controla toda la octava fila.",
    resultingAdvantage: "Jaque mate en e8.",
    verification: verified,
    hints: [
      "Obliga al rey negro a una casilla de esquina.",
      "La dama puede capturar el peón de f7 con jaque.",
      "Tras ...Rh8 no, busca una dama en e8.",
      "Empieza con h5f7+.",
    ],
  },
  {
    schemaVersion: 1,
    id: "knight-queen-corridor-mate",
    fen: "6k1/5ppp/8/8/7q/3n4/5P1P/6K1 b - - 0 1",
    sideToMove: "black",
    theme: "mate",
    difficulty: "intermediate",
    objective: "Coordina caballo y dama para encerrar al rey blanco.",
    solution: [
      {
        userMove: "h4f2",
        reply: "g1h1",
        next: [{ userMove: "f2f1" }],
      },
    ],
    explanation:
      "El caballo de d3 protege f2; la captura da jaque y la dama remata desde f1 tras la retirada del rey.",
    resultingAdvantage: "Jaque mate en f1.",
    verification: verified,
    hints: [
      "Busca una captura con jaque sobre f2.",
      "El caballo de d3 protege f2.",
      "Después de Rh1, revisa la primera fila.",
      "Empieza con h4f2+.",
    ],
  },
]);

const n0 = initial;
const n1 = after("e2e4");
const n2 = after("e2e4", "e7e5");
const n3 = after("e2e4", "e7e5", "g1f3");
const n4 = after("e2e4", "e7e5", "g1f3", "b8c6");
const n5 = after("e2e4", "e7e5", "g1f3", "b8c6", "f1c4");
const n6a = after("e2e4", "e7e5", "g1f3", "b8c6", "f1c4", "f8c5");
const n6b = after("e2e4", "e7e5", "g1f3", "b8c6", "f1c4", "g8f6");
const n7a = advance(n6a, "d2d3");
const n7b = advance(n6b, "d2d3");
const n8 = advance(n7a, "g8f6");
const node = (
  session: GameSession,
  moves: OpeningNodeV1["moves"],
  idea: string,
  end = false,
): OpeningNodeV1 => ({
  positionKey: positionKeyForFen(session.fen),
  fen: session.fen,
  moves,
  strategicIdea: idea,
  highlightedSquares: ["e4", "e5", "f7"],
  arrows: [],
  ...(end ? { isOpeningEnd: true as const } : {}),
});
const link = (
  uci: string,
  target: GameSession,
  kind: "main" | "valid-alternative" = "main",
) => ({ uci, target: positionKeyForFen(target.fen), kind });
const nodes: readonly OpeningNodeV1[] = [
  node(n0, [link("e2e4", n1)], "Gana espacio y abre líneas."),
  node(n1, [link("e7e5", n2)], "Las negras ocupan el centro."),
  node(n2, [link("g1f3", n3)], "El caballo ataca e5 y prepara el enroque."),
  node(n3, [link("b8c6", n4)], "Las negras defienden e5."),
  node(n4, [link("f1c4", n5)], "El alfil crea presión sobre f7."),
  node(
    n5,
    [link("f8c5", n6a), link("g8f6", n6b, "valid-alternative")],
    "Dos respuestas italianas razonables.",
  ),
  node(n6a, [link("d2d3", n7a)], "d3 sostiene el centro."),
  node(n6b, [link("d2d3", n7b)], "El orden cambia, el plan no."),
  node(n7a, [link("g8f6", n8)], "La primera rama llega a la posición común."),
  node(n7b, [link("f8c5", n8)], "Transposición a la misma posición común."),
  node(n8, [], "Desarrollo completado; empieza el plan de medio juego.", true),
];

export const ITALIAN_OPENING_COURSE_V1: OpeningCourseV1 = Object.freeze({
  schemaVersion: 1,
  id: "italian-game-mvp",
  name: "Apertura Italiana",
  eco: "C50",
  supportedColors: ["white" as const],
  root: positionKeyForFen(n0.fen),
  nodes,
  description:
    "Un repertorio inicial de blancas para desarrollar, enrocar y presionar f7.",
  generalObjective: "Desarrollar con propósito y llegar a un rey seguro.",
  explanationSteps: [
    {
      positionKey: positionKeyForFen(n0.fen),
      title: "Ocupa el centro",
      description: "e4 gana espacio y libera al alfil.",
      recommendedMove: "e2e4",
      arrows: [{ from: "e2", to: "e4" }],
      highlightedSquares: ["e4", "d5"],
      piecesToHighlight: ["e2"],
      futurePlan: "Desarrolla el caballo de rey.",
    },
    {
      positionKey: positionKeyForFen(n2.fen),
      title: "Desarrolla el caballo",
      description: "Cf3 ataca e5 y prepara el enroque.",
      recommendedMove: "g1f3",
      arrows: [{ from: "g1", to: "f3" }],
      highlightedSquares: ["e5", "d4"],
      piecesToHighlight: ["g1"],
      futurePlan: "Activa el alfil de f1.",
    },
    {
      positionKey: positionKeyForFen(n4.fen),
      title: "Presiona f7",
      description: "Ac4 mira el punto más sensible del rey negro al inicio.",
      recommendedMove: "f1c4",
      arrows: [{ from: "f1", to: "c4" }],
      highlightedSquares: ["f7"],
      piecesToHighlight: ["f1"],
      futurePlan: "Enroca antes de abrir el centro.",
    },
  ],
});
