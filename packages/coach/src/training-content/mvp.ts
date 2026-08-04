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
  targetPosition: positionKeyForFen(n8.fen),
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
    {
      positionKey: positionKeyForFen(n6a.fen),
      title: "Sostén el centro",
      description: "d3 respalda e4 y deja una salida al alfil de c1.",
      recommendedMove: "d2d3",
      arrows: [{ from: "d2", to: "d3" }],
      highlightedSquares: ["d3", "e4"],
      piecesToHighlight: ["d2"],
      futurePlan: "Enroca antes de decidir cómo abrir el centro.",
    },
  ],
});

interface CourseStepCopy {
  readonly positionIndex: number;
  readonly title: string;
  readonly description: string;
  readonly highlightedSquares: readonly string[];
  readonly futurePlan: string;
}
interface AlternativeLine {
  readonly fromIndex: number;
  readonly move: string;
  readonly continuation: readonly string[];
  readonly idea: string;
}
interface CourseDefinition {
  readonly id: string;
  readonly name: string;
  readonly eco: string;
  readonly description: string;
  readonly generalObjective: string;
  readonly moves: readonly string[];
  readonly ideas: readonly string[];
  readonly steps: readonly CourseStepCopy[];
  readonly alternatives: readonly AlternativeLine[];
}
const sessionsFrom = (
  start: GameSession,
  moves: readonly string[],
): readonly GameSession[] => {
  const sessions = [start];
  for (const move of moves)
    sessions.push(applyUciMove(sessions[sessions.length - 1]!, move));
  return sessions;
};
const arrowForMove = (uci: string) => ({
  from: uci.slice(0, 2),
  to: uci.slice(2, 4),
});

/** Builds FEN-keyed legal graphs from explicit UCI lines, including branches. */
const createOpeningCourse = (definition: CourseDefinition): OpeningCourseV1 => {
  const main = sessionsFrom(initial, definition.moves);
  if (definition.ideas.length !== main.length)
    throw new RangeError("Opening course needs one idea per main node");
  const branches = definition.alternatives.map((alternative) => ({
    alternative,
    sessions: sessionsFrom(main[alternative.fromIndex]!, [
      alternative.move,
      ...alternative.continuation,
    ]),
  }));
  const mainNodes = main.map((session, index) => {
    const next = main[index + 1];
    const alternatives = branches
      .filter(({ alternative }) => alternative.fromIndex === index)
      .map(({ alternative, sessions }) =>
        link(alternative.move, sessions[1]!, "valid-alternative"),
      );
    return node(
      session,
      next === undefined
        ? []
        : [link(definition.moves[index]!, next), ...alternatives],
      definition.ideas[index]!,
      next === undefined,
    );
  });
  const branchNodes = branches.flatMap(({ alternative, sessions }) =>
    sessions.slice(1).map((session, index) => {
      const next = sessions[index + 2];
      return node(
        session,
        next === undefined
          ? []
          : [link(alternative.continuation[index]!, next)],
        alternative.idea,
        next === undefined,
      );
    }),
  );
  return Object.freeze({
    schemaVersion: 1,
    id: definition.id,
    name: definition.name,
    eco: definition.eco,
    supportedColors: ["white" as const],
    root: positionKeyForFen(initial.fen),
    targetPosition: positionKeyForFen(main[main.length - 1]!.fen),
    nodes: Object.freeze([...mainNodes, ...branchNodes]),
    description: definition.description,
    generalObjective: definition.generalObjective,
    explanationSteps: Object.freeze(
      definition.steps.map((step) => {
        const recommendedMove = definition.moves[step.positionIndex]!;
        return {
          positionKey: positionKeyForFen(main[step.positionIndex]!.fen),
          title: step.title,
          description: step.description,
          recommendedMove,
          arrows: [arrowForMove(recommendedMove)],
          highlightedSquares: step.highlightedSquares,
          piecesToHighlight: [recommendedMove.slice(0, 2)],
          futurePlan: step.futurePlan,
        };
      }),
    ),
  });
};

export const RUY_LOPEZ_OPENING_COURSE_V1 = createOpeningCourse({
  id: "ruy-lopez-mvp",
  name: "Apertura Espanola (Ruy Lopez)",
  eco: "C70",
  description: "Linea basica para desarrollar y aumentar la presion sobre e5.",
  generalObjective:
    "Desarrollar, cuestionar e5 y conservar opciones de enroque.",
  moves: ["e2e4", "e7e5", "g1f3", "b8c6", "f1b5", "a7a6", "b5a4", "g8f6"],
  ideas: [
    "e4 abre lineas para las piezas blancas.",
    "Las negras reclaman el centro.",
    "Cf3 ataca e5 y prepara el enroque.",
    "Cc6 defiende e5 y desarrolla.",
    "Ab5 presiona al defensor de e5.",
    "a6 pregunta al alfil.",
    "Aa4 conserva una diagonal util.",
    "Ambos lados desarrollan una pieza de rey.",
    "La posicion objetivo deja planes centrales abiertos.",
  ],
  steps: [
    {
      positionIndex: 0,
      title: "Abre el juego",
      description: "e4 gana espacio y habilita al alfil y la dama.",
      highlightedSquares: ["e4", "d5"],
      futurePlan: "Ataca e5 con Cf3.",
    },
    {
      positionIndex: 2,
      title: "Ataca e5",
      description: "Cf3 desarrolla y pone una pregunta al peon central negro.",
      highlightedSquares: ["e5", "d4"],
      futurePlan: "Usa el alfil para aumentar la presion.",
    },
    {
      positionIndex: 4,
      title: "Cuestiona al defensor",
      description:
        "Ab5 apunta al caballo de c6, que sostiene e5; no promete ganar un peon por si solo.",
      highlightedSquares: ["c6", "e5"],
      futurePlan: "Conserva una diagonal util si el alfil es atacado.",
    },
    {
      positionIndex: 6,
      title: "Conserva la presion",
      description: "Aa4 mantiene la tension sobre c6 sin apresurar cambios.",
      highlightedSquares: ["a4", "c6"],
      futurePlan: "Enroca antes de decidir la estructura central.",
    },
  ],
  alternatives: [
    {
      fromIndex: 5,
      move: "g8f6",
      continuation: ["b5a4", "f6e4"],
      idea: "La Berlinesa es una alternativa seria; las blancas siguen desarrollando antes de decidir.",
    },
  ],
});

export const SICILIAN_OPENING_COURSE_V1 = createOpeningCourse({
  id: "sicilian-open-basic-mvp",
  name: "Defensa Siciliana: linea abierta basica",
  eco: "B90",
  description:
    "Respuesta blanca abierta contra ...c5, centrada en desarrollo y d4.",
  generalObjective:
    "Abrir el centro preparado, sin prometer una ventaja automatica.",
  moves: [
    "e2e4",
    "c7c5",
    "g1f3",
    "d7d6",
    "d2d4",
    "c5d4",
    "f3d4",
    "g8f6",
    "b1c3",
    "a7a6",
  ],
  ideas: [
    "e4 ocupa espacio.",
    "...c5 desafia el centro desde un flanco.",
    "Cf3 prepara d4.",
    "...d6 respalda el centro negro.",
    "d4 invita a aclarar el centro.",
    "Las negras cambian en d4.",
    "Cxd4 recupera con desarrollo.",
    "...Cf6 ataca e4 y desarrolla.",
    "Cc3 suma control central.",
    "...a6 completa la posicion Najdorf basica y conserva tension central.",
    "La estructura Najdorf con ...a6 controla b5 y prepara ...b5; las blancas suelen continuar con Ae3, f3 y Dd2.",
  ],
  steps: [
    {
      positionIndex: 0,
      title: "Reclama e4",
      description: "e4 crea espacio; ...c5 desafia esa idea desde otro angulo.",
      highlightedSquares: ["e4", "d4"],
      futurePlan: "Desarrolla Cf3 para preparar d4.",
    },
    {
      positionIndex: 2,
      title: "Prepara la ruptura",
      description: "Cf3 desarrolla el caballo y apoya d4.",
      highlightedSquares: ["d4", "e5"],
      futurePlan: "Aclara el centro con d4.",
    },
    {
      positionIndex: 4,
      title: "Abre el centro",
      description:
        "d4 busca intercambiar el peon c por el peon d y abrir lineas.",
      highlightedSquares: ["d4", "c5"],
      futurePlan: "Recaptura con pieza para ganar actividad.",
    },
    {
      positionIndex: 6,
      title: "Recupera desarrollando",
      description: "Cxd4 recupera el peon sin traer la dama demasiado pronto.",
      highlightedSquares: ["d4", "e6"],
      futurePlan: "Completa Cc3 y decide el enroque.",
    },
    {
      positionIndex: 8,
      title: "Completa el desarrollo",
      description:
        "Cc3 suma control central; ambos lados conservan planes distintos.",
      highlightedSquares: ["c3", "d5"],
      futurePlan: "Enroca antes de buscar tacticas.",
    },
  ],
  alternatives: [
    {
      fromIndex: 3,
      move: "b8c6",
      continuation: ["d2d4", "c5d4", "f3d4", "g8f6"],
      idea: "...Cc6 tambien desarrolla; la recaptura con caballo mantiene una estructura abierta.",
    },
  ],
});

export const FRENCH_OPENING_COURSE_V1 = createOpeningCourse({
  id: "french-classical-basic-mvp",
  name: "Defensa Francesa: linea clasica basica",
  eco: "C14",
  description:
    "Introduccion a la estructura francesa clasica y su tension central.",
  generalObjective: "Ganar espacio sin olvidar desarrollo ni la tension d4/e5.",
  moves: ["e2e4", "e7e6", "d2d4", "d7d5", "b1c3", "g8f6", "c1g5", "f8e7"],
  ideas: [
    "e4 establece presencia central.",
    "...e6 prepara ...d5.",
    "d4 forma un centro de peones.",
    "...d5 cuestiona ese centro.",
    "Cc3 desarrolla detras del centro.",
    "...Cf6 presiona el centro blanco.",
    "Ag5 desarrolla con una pregunta al caballo.",
    "...Ae7 prepara una respuesta solida.",
    "La tension estrategica queda para el medio juego.",
  ],
  steps: [
    {
      positionIndex: 0,
      title: "Forma un centro",
      description: "e4 toma espacio antes de que ...d5 cuestione el centro.",
      highlightedSquares: ["e4", "d4"],
      futurePlan: "Apoya e4 con d4.",
    },
    {
      positionIndex: 2,
      title: "Apoya e4",
      description:
        "d4 construye dos peones centrales; las negras pueden desafiarlos.",
      highlightedSquares: ["d4", "e4"],
      futurePlan: "Desarrolla Cc3 sin decidir aun los cambios.",
    },
    {
      positionIndex: 4,
      title: "Desarrolla detras del centro",
      description:
        "Cc3 activa una pieza y deja opciones para sostener o avanzar.",
      highlightedSquares: ["c3", "d5"],
      futurePlan: "Observa como ...Cf6 presiona el centro.",
    },
    {
      positionIndex: 6,
      title: "Clava con proposito",
      description:
        "Ag5 desarrolla y senala el caballo de f6; no obliga por si mismo una concesion.",
      highlightedSquares: ["f6", "d8"],
      futurePlan: "Enroca y decide la estructura con piezas listas.",
    },
  ],
  alternatives: [
    {
      fromIndex: 5,
      move: "f8b4",
      continuation: ["e4e5", "b4c3"],
      idea: "La Winawer cambia alfil por caballo; e5 gana espacio y la estructura requiere atencion posterior.",
    },
  ],
});

export const QUEENS_GAMBIT_DECLINED_OPENING_COURSE_V1 = createOpeningCourse({
  id: "queens-gambit-declined-basic-mvp",
  name: "Gambito de Dama Declinado: linea basica",
  eco: "D55",
  description: "Desarrollo clasico contra ...d5 y ...e6, con presion central.",
  generalObjective:
    "Desarrollar detras de la tension d4/c4 y preparar el enroque.",
  moves: [
    "d2d4",
    "d7d5",
    "c2c4",
    "e7e6",
    "b1c3",
    "g8f6",
    "c1g5",
    "f8e7",
    "e2e3",
    "e8g8",
  ],
  ideas: [
    "d4 reclama una casilla central.",
    "...d5 disputa el espacio.",
    "c4 cuestiona el peon de d5.",
    "...e6 sostiene d5.",
    "Cc3 desarrolla detras de los peones.",
    "...Cf6 prepara el enroque.",
    "Ag5 observa el caballo defensor.",
    "...Ae7 corta la clavada.",
    "e3 refuerza d4 y abre el alfil de f1.",
    "El enroque completa esta posicion Ortodoxa basica; la tension central sigue pendiente.",
    "Las negras ya han enrocado; las blancas deben completar Cf3, Ae2/Ad3 y poner el rey a salvo.",
  ],
  steps: [
    {
      positionIndex: 0,
      title: "Ocupa d4",
      description: "d4 toma espacio y permite que c4 cuestione el peon rival.",
      highlightedSquares: ["d4", "e5"],
      futurePlan: "Juega c4 para presionar d5.",
    },
    {
      positionIndex: 2,
      title: "Cuestiona d5",
      description:
        "c4 plantea una tension central que las negras pueden sostener.",
      highlightedSquares: ["c4", "d5"],
      futurePlan: "Desarrolla Cc3 detras de los peones.",
    },
    {
      positionIndex: 4,
      title: "Desarrolla con apoyo",
      description: "Cc3 suma control de d5 y e4 sin resolver la tension.",
      highlightedSquares: ["c3", "d5"],
      futurePlan: "Desarrolla el alfil de c1 con una idea concreta.",
    },
    {
      positionIndex: 6,
      title: "Senala el defensor",
      description: "Ag5 apunta al caballo de f6 y desarrolla antes de enrocar.",
      highlightedSquares: ["f6", "d8"],
      futurePlan: "Refuerza d4 con e3.",
    },
    {
      positionIndex: 8,
      title: "Prepara el rey",
      description:
        "e3 sostiene d4 y abre una diagonal; el enroque negro completa desarrollo.",
      highlightedSquares: ["e3", "d4", "f1"],
      futurePlan: "Enroca y decide cuando cambiar o avanzar en el centro.",
    },
  ],
  alternatives: [
    {
      fromIndex: 3,
      move: "c7c6",
      continuation: ["b1c3", "g8f6"],
      idea: "La estructura con ...c6 es solida; las blancas siguen desarrollando sin ruptura inmediata.",
    },
  ],
});

/** Extensible catalog consumed generically by the training UI. */
export const OPENING_COURSES_V1: readonly OpeningCourseV1[] = Object.freeze([
  ITALIAN_OPENING_COURSE_V1,
  RUY_LOPEZ_OPENING_COURSE_V1,
  SICILIAN_OPENING_COURSE_V1,
  FRENCH_OPENING_COURSE_V1,
  QUEENS_GAMBIT_DECLINED_OPENING_COURSE_V1,
]);
