import {
  applyUciMove,
  loadPosition,
  positionKeyForFen,
  type GameSession,
  type PlayerColor,
} from "@chess-coach/chess-core";
import {
  chooseOpeningReplyV1,
  matchOpeningPositionV1,
  type OpeningCourseV1,
  type OpeningExplanationStepV1,
  type OpeningMatchKindV1,
} from "@chess-coach/coach";
import {
  collectOpeningEvidence,
  type ChessEngine,
  type OpeningEvidenceResult,
} from "@chess-coach/engine";
import { useEffect, useMemo, useRef, useState } from "react";
import { createBrowserStockfishEngine } from "./engineClient";
import { TrainingBoard, type TrainingBoardArrow } from "./TrainingBoard";
import { TrainingSelect } from "./TrainingSelect";

const matchCopy: Record<OpeningMatchKindV1, string> = {
  main: "Movimiento principal del repertorio.",
  "valid-alternative": "Alternativa válida del repertorio.",
  transposition: "Transposición: llegas a una posición conocida.",
  outside: "Movimiento fuera del repertorio.",
};

export type ExplanationPhase = "learner" | "reply" | "complete";
export type OpeningLessonLine = {
  readonly learnerMove: string | undefined;
  readonly replyMove: string | undefined;
  readonly replyTarget: string | undefined;
};

/** Reads the linked graph; it never guesses a rival move for lesson playback. */
export function expectedOpeningLessonLine(
  course: OpeningCourseV1,
  step: OpeningExplanationStepV1,
): OpeningLessonLine {
  const node = course.nodes.find(
    (item) => item.positionKey === step.positionKey,
  );
  const learnerEdge = node?.moves.find(
    (move) => move.uci === step.recommendedMove,
  );
  const replyNode = learnerEdge
    ? course.nodes.find((item) => item.positionKey === learnerEdge.target)
    : undefined;
  const reply = replyNode?.moves.find((move) => move.kind === "main");
  return {
    learnerMove: step.recommendedMove,
    replyMove: reply?.uci,
    replyTarget: reply?.target,
  };
}

export type OpeningEvidenceCollector = (
  engine: ChessEngine,
  request: Parameters<typeof collectOpeningEvidence>[1],
  signal?: AbortSignal,
) => Promise<OpeningEvidenceResult>;

export interface OpeningTrainingProps {
  /** Kept for callers with a single persisted course. */
  readonly course?: OpeningCourseV1;
  readonly courses?: readonly OpeningCourseV1[];
  readonly onContinueGame: (fen: string) => void;
  readonly engineFactory?: () => ChessEngine;
  readonly collectEvidence?: OpeningEvidenceCollector;
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
function arrowFromUci(
  uci: string | undefined,
  color: TrainingBoardArrow["color"],
) {
  return uci && /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)
    ? ({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        color,
      } satisfies TrainingBoardArrow)
    : undefined;
}
function courseStart(course: OpeningCourseV1): GameSession {
  return loadPosition(course.nodes[0]!.fen);
}

export function OpeningTraining({
  course: suppliedCourse,
  courses,
  onContinueGame,
  engineFactory = createBrowserStockfishEngine,
  collectEvidence = collectOpeningEvidence,
}: OpeningTrainingProps) {
  const catalog = courses ?? (suppliedCourse ? [suppliedCourse] : []);
  if (catalog.length === 0)
    throw new RangeError("Opening training requires a course");
  const [courseId, setCourseId] = useState(
    () => suppliedCourse?.id ?? catalog[0]!.id,
  );
  const course = catalog.find((item) => item.id === courseId) ?? catalog[0]!;
  const [color, setColor] = useState<PlayerColor>("white");
  const [mode, setMode] = useState<"explain" | "practice">("explain");
  const [step, setStep] = useState(0);
  const [explainFen, setExplainFen] = useState(() => courseStart(course).fen);
  const [phase, setPhase] = useState<ExplanationPhase>("learner");
  const [practice, setPractice] = useState<GameSession>(() =>
    courseStart(course),
  );
  const [practiceArrows, setPracticeArrows] = useState<
    readonly TrainingBoardArrow[]
  >([]);
  const [notice, setNotice] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisRetry, setAnalysisRetry] = useState(0);
  const engine = useRef<ChessEngine | undefined>(undefined);
  const analysisController = useRef<AbortController | undefined>(undefined);
  const analysisVersion = useRef(0);
  const available = course.supportedColors.includes(color);
  const current = course.explanationSteps[step]!;
  const lessonLine = useMemo(
    () => expectedOpeningLessonLine(course, current),
    [course, current],
  );
  const explainGame = useMemo(() => loadPosition(explainFen), [explainFen]);
  const practiceNode = useMemo(
    () =>
      course.nodes.find(
        (node) => node.positionKey === positionKeyForFen(practice.fen),
      ),
    [course, practice.fen],
  );
  const explanationArrows = useMemo(
    () =>
      [
        arrowFromUci(lessonLine.learnerMove, "player"),
        arrowFromUci(lessonLine.replyMove, "opponent"),
      ].filter((arrow): arrow is TrainingBoardArrow => arrow !== undefined),
    [lessonLine],
  );

  const resetExplanation = (nextStep = 0, nextCourse = course) => {
    const next = nextCourse.explanationSteps[nextStep]!;
    const node =
      nextCourse.nodes.find((item) => item.positionKey === next.positionKey) ??
      nextCourse.nodes[0]!;
    setStep(nextStep);
    setExplainFen(node.fen);
    setPhase("learner");
    setNotice("");
  };
  const selectCourse = (nextId: string) => {
    const nextCourse = catalog.find((item) => item.id === nextId);
    if (!nextCourse) return;
    analysisController.current?.abort();
    setCourseId(nextId);
    setColor("white");
    setMode("explain");
    setPractice(courseStart(nextCourse));
    setPracticeArrows([]);
    setIsAnalyzing(false);
    setAnalysisRetry(0);
    resetExplanation(0, nextCourse);
  };

  useEffect(
    () => () => {
      analysisController.current?.abort();
      void engine.current?.dispose();
    },
    [],
  );
  useEffect(() => {
    analysisController.current?.abort();
    const requestVersion = ++analysisVersion.current;
    if (
      mode !== "practice" ||
      !available ||
      practice.turn === color ||
      !practiceNode ||
      practiceNode.moves.length === 0 ||
      practiceNode.isOpeningEnd
    ) {
      setIsAnalyzing(false);
      return;
    }
    const controller = new AbortController();
    analysisController.current = controller;
    setIsAnalyzing(true);
    setNotice("Analizando respuestas…");
    const request = {
      id: `opening:${course.id}:${requestVersion}`,
      fen: practice.fen,
      perspective: color,
      repertoireMoves: practiceNode.moves.slice(0, 3).map((move) => move.uci),
      limit: { kind: "time" as const, milliseconds: 500 },
      candidateLimit: { kind: "time" as const, milliseconds: 350 },
    };
    const activeEngine = (engine.current ??= engineFactory());
    void collectEvidence(activeEngine, request, controller.signal)
      .then((result) => {
        if (
          controller.signal.aborted ||
          requestVersion !== analysisVersion.current
        )
          return;
        if (result.kind === "unavailable") {
          setNotice(
            "No se pudo verificar una respuesta con el motor local. No se aplicó ninguna respuesta automática.",
          );
          return;
        }
        try {
          const reply = chooseOpeningReplyV1(
            course,
            practice.fen,
            result.evidence,
          );
          setPractice((currentPractice) =>
            currentPractice.fen === practice.fen
              ? applyUciMove(currentPractice, reply.move)
              : currentPractice,
          );
          const opponent = arrowFromUci(reply.move, "opponent");
          setPracticeArrows((arrows) => [
            ...arrows.filter((arrow) => arrow.color !== "opponent"),
            ...(opponent ? [opponent] : []),
          ]);
          setNotice(
            reply.source === "opening"
              ? "Respuesta de repertorio verificada por el motor local."
              : "El motor local eligió una respuesta fuera del repertorio porque no había una alternativa verificada dentro del margen de seguridad.",
          );
        } catch {
          setNotice(
            "La evidencia del motor no permitió verificar una respuesta. No se aplicó ninguna respuesta automática.",
          );
        }
      })
      .catch((error: unknown) => {
        if (!isAbort(error) && requestVersion === analysisVersion.current)
          setNotice(
            "No se pudo verificar una respuesta con el motor local. No se aplicó ninguna respuesta automática.",
          );
      })
      .finally(() => {
        if (requestVersion === analysisVersion.current) setIsAnalyzing(false);
      });
    return () => controller.abort();
  }, [
    analysisRetry,
    available,
    collectEvidence,
    color,
    course,
    engineFactory,
    mode,
    practice.fen,
    practice.turn,
    practiceNode,
  ]);

  const playExplanation = (uci: string) => {
    const expected =
      phase === "learner"
        ? lessonLine.learnerMove
        : phase === "reply"
          ? lessonLine.replyMove
          : undefined;
    if (!expected) {
      setNotice(
        phase === "complete"
          ? "Lección completada."
          : "Esta línea no tiene una respuesta principal verificable; puedes pasar al siguiente paso.",
      );
      return;
    }
    if (uci !== expected) {
      setNotice(
        "Ese movimiento es legal, pero no es el movimiento de esta lección. Reintenta sin cambiar la posición.",
      );
      return;
    }
    try {
      const after = applyUciMove(explainGame, uci);
      if (phase === "learner") {
        setExplainFen(after.fen);
        setPhase("reply");
        setNotice(
          "Bien. Ahora ejecuta la respuesta principal marcada en rojo.",
        );
        return;
      }
      const nextStep = step + 1;
      if (nextStep < course.explanationSteps.length) {
        const next = course.explanationSteps[nextStep]!;
        if (positionKeyForFen(after.fen) !== next.positionKey) {
          setNotice(
            "La respuesta no enlaza con el siguiente paso; la posición se conserva para reintentar.",
          );
          return;
        }
        resetExplanation(nextStep);
        setNotice("Respuesta correcta. Continúa con el siguiente paso.");
        return;
      }
      if (
        course.targetPosition &&
        positionKeyForFen(after.fen) !== course.targetPosition
      ) {
        setNotice(
          "La respuesta no alcanza la posición objetivo; la posición se conserva para reintentar.",
        );
        return;
      }
      setExplainFen(after.fen);
      setPhase("complete");
      setNotice("Lección completada: alcanzaste la posición objetivo.");
    } catch {
      setNotice("Movimiento no legal. Reintenta la posición.");
    }
  };
  const play = (uci: string) => {
    if (isAnalyzing || practice.turn !== color) return;
    try {
      const match = matchOpeningPositionV1(course, practice.fen, uci);
      setPractice(applyUciMove(practice, uci));
      const player = arrowFromUci(uci, "player");
      setPracticeArrows(player ? [player] : []);
      setNotice(
        `${matchCopy[match.kind]}${match.kind === "outside" ? " Puedes reintentar o continuar fuera del repertorio." : ""}`,
      );
    } catch {
      setNotice("Movimiento no legal. Reintenta la posición.");
    }
  };
  const resetPractice = () => {
    analysisController.current?.abort();
    setPractice(courseStart(course));
    setPracticeArrows([]);
    setNotice("");
  };
  const navigateStep = (direction: -1 | 1) =>
    resetExplanation(
      Math.max(
        0,
        Math.min(course.explanationSteps.length - 1, step + direction),
      ),
    );

  return (
    <section className="training-page" aria-labelledby="openings-title">
      <header>
        <p className="eyebrow">Repertorio local</p>
        <h1 id="openings-title">Aperturas</h1>
        <p>
          {course.name} · {course.eco}
        </p>
        <p>{course.generalObjective}</p>
      </header>
      <div className="training-controls">
        <TrainingSelect
          label="Color"
          value={color}
          onChange={setColor}
          options={[
            { value: "white", label: "Blancas" },
            { value: "black", label: "Negras" },
          ]}
        />
        <TrainingSelect
          label="Apertura"
          value={course.id}
          onChange={selectCourse}
          options={catalog.map((item) => ({
            value: item.id,
            label: `${item.name} · ${item.eco}`,
          }))}
        />
        <TrainingSelect
          label="Modo"
          value={mode}
          onChange={setMode}
          options={[
            { value: "explain", label: "Explicación" },
            { value: "practice", label: "Práctica" },
          ]}
        />
      </div>
      {!available ? (
        <p role="alert">Esta apertura no está disponible con ese color.</p>
      ) : mode === "explain" ? (
        <div className="training-layout">
          <TrainingBoard
            game={explainGame}
            orientation={color}
            onMove={playExplanation}
            disabled={phase === "complete"}
            highlights={current.highlightedSquares}
            arrows={explanationArrows}
          />
          <aside className="training-panel">
            <p aria-live="polite">
              Paso {step + 1} de {course.explanationSteps.length}
            </p>
            <h2>{current.title}</h2>
            <p>{current.description}</p>
            <p>
              <strong>Plan:</strong> {current.futurePlan}
            </p>
            <ArrowLegend
              context={
                phase === "reply" ? "respuesta ejecutada" : "tu movimiento"
              }
            />
            <p role="status" aria-live="polite">
              {notice ||
                (phase === "learner"
                  ? "Ejecuta el movimiento azul."
                  : phase === "reply"
                    ? "Ejecuta la respuesta roja."
                    : "Lección completada.")}
            </p>
            <div className="training-actions">
              <button
                type="button"
                aria-label="Paso anterior de la explicación"
                onClick={() => navigateStep(-1)}
                disabled={step === 0}
              >
                ←
              </button>
              <button
                type="button"
                aria-label="Paso siguiente de la explicación"
                onClick={() => navigateStep(1)}
                disabled={step === course.explanationSteps.length - 1}
              >
                →
              </button>
              <button type="button" onClick={() => setMode("practice")}>
                Practicar
              </button>
            </div>
          </aside>
        </div>
      ) : (
        <div className="training-layout">
          <TrainingBoard
            game={practice}
            orientation={color}
            onMove={play}
            disabled={isAnalyzing || practice.turn !== color}
            arrows={practiceArrows}
          />
          <aside className="training-panel">
            <h2>Práctica guiada</h2>
            <p>{course.description}</p>
            <ArrowLegend context="tu última jugada" />
            <p role="status" aria-live="polite">
              {notice || "Juega una jugada del repertorio."}
            </p>
            {isAnalyzing ? (
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  analysisController.current?.abort();
                  setNotice(
                    "Análisis cancelado. No se aplicó ninguna respuesta automática.",
                  );
                }}
              >
                Cancelar análisis
              </button>
            ) : practice.turn !== color ? (
              <button
                type="button"
                className="secondary"
                onClick={() => setAnalysisRetry((value) => value + 1)}
              >
                Reintentar análisis
              </button>
            ) : null}
            <div className="training-actions">
              <button type="button" onClick={resetPractice}>
                Reiniciar
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => setMode("explain")}
              >
                Ver explicación
              </button>
              <button
                type="button"
                onClick={() => onContinueGame(practice.fen)}
              >
                Continuar como partida
              </button>
            </div>
          </aside>
        </div>
      )}
    </section>
  );
}

function ArrowLegend({ context }: { readonly context: string }) {
  return (
    <p className="training-arrow-legend">
      <span>
        <i className="legend-player" aria-hidden="true" />
        Azul: {context}
      </span>
      <span>
        <i className="legend-opponent" aria-hidden="true" />
        Rojo: respuesta rival
      </span>
    </p>
  );
}
