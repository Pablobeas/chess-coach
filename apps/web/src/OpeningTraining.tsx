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
  type OpeningMatchKindV1,
} from "@chess-coach/coach";
import {
  collectOpeningEvidence,
  type ChessEngine,
  type OpeningEvidenceResult,
} from "@chess-coach/engine";
import { useEffect, useMemo, useRef, useState } from "react";
import { createBrowserStockfishEngine } from "./engineClient";
import { TrainingBoard } from "./TrainingBoard";

const matchCopy: Record<OpeningMatchKindV1, string> = {
  main: "Movimiento principal del repertorio.",
  "valid-alternative": "Alternativa válida del repertorio.",
  transposition: "Transposición: llegas a una posición conocida.",
  outside: "Movimiento fuera del repertorio.",
};

export type OpeningEvidenceCollector = (
  engine: ChessEngine,
  request: Parameters<typeof collectOpeningEvidence>[1],
  signal?: AbortSignal,
) => Promise<OpeningEvidenceResult>;

export interface OpeningTrainingProps {
  readonly course: OpeningCourseV1;
  readonly onContinueGame: (fen: string) => void;
  readonly engineFactory?: () => ChessEngine;
  readonly collectEvidence?: OpeningEvidenceCollector;
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export function OpeningTraining({
  course,
  onContinueGame,
  engineFactory = createBrowserStockfishEngine,
  collectEvidence = collectOpeningEvidence,
}: OpeningTrainingProps) {
  const [color, setColor] = useState<PlayerColor>("white");
  const [mode, setMode] = useState<"explain" | "practice">("explain");
  const [step, setStep] = useState(0);
  const [practice, setPractice] = useState<GameSession>(() =>
    loadPosition(course.nodes[0]!.fen),
  );
  const [notice, setNotice] = useState("");
  const [isAutoplaying, setIsAutoplaying] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisRetry, setAnalysisRetry] = useState(0);
  const timer = useRef<number | undefined>(undefined);
  const engine = useRef<ChessEngine | undefined>(undefined);
  const analysisController = useRef<AbortController | undefined>(undefined);
  const analysisVersion = useRef(0);
  const available = course.supportedColors.includes(color);
  const current = course.explanationSteps[step]!;
  const currentNode = useMemo(
    () => course.nodes.find((node) => node.positionKey === current.positionKey),
    [course, current],
  );
  const practiceNode = useMemo(
    () =>
      course.nodes.find(
        (node) => node.positionKey === positionKeyForFen(practice.fen),
      ),
    [course, practice.fen],
  );

  useEffect(() => {
    if (mode !== "explain" || !isAutoplaying) return;
    timer.current = window.setInterval(() => {
      setStep((value) => {
        if (value >= course.explanationSteps.length - 1) {
          setIsAutoplaying(false);
          return value;
        }
        return value + 1;
      });
    }, 1800);
    return () => {
      if (timer.current !== undefined) window.clearInterval(timer.current);
      timer.current = undefined;
    };
  }, [course.explanationSteps.length, isAutoplaying, mode]);

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
      practiceNode === undefined ||
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
    const repertoireMoves = practiceNode.moves
      .slice(0, 3)
      .map((move) => move.uci);
    const request = {
      id: `opening:${course.id}:${requestVersion}`,
      fen: practice.fen,
      perspective: color,
      repertoireMoves,
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
    available,
    collectEvidence,
    color,
    course,
    engineFactory,
    mode,
    practice.fen,
    practice.turn,
    practiceNode,
    analysisRetry,
  ]);

  const nextStep = () =>
    setStep((value) => Math.min(course.explanationSteps.length - 1, value + 1));
  const autoplay = () => {
    setIsAutoplaying((value) => !value);
    setNotice(
      isAutoplaying
        ? "Reproducción detenida."
        : "Reproducción automática activa.",
    );
  };
  const selectMode = (nextMode: "explain" | "practice") => {
    setMode(nextMode);
    if (nextMode !== "explain") setIsAutoplaying(false);
  };
  const resetPractice = () => {
    analysisController.current?.abort();
    setPractice(loadPosition(course.nodes[0]!.fen));
    setNotice("");
  };
  const play = (uci: string) => {
    if (isAnalyzing || practice.turn !== color) return;
    try {
      const match = matchOpeningPositionV1(course, practice.fen, uci);
      const after = applyUciMove(practice, uci);
      setPractice(after);
      setNotice(
        `${matchCopy[match.kind]}${match.kind === "outside" ? " Puedes reintentar o continuar fuera del repertorio." : ""}`,
      );
    } catch {
      setNotice("Movimiento no legal. Reintenta la posición.");
    }
  };
  const cancelAnalysis = () => {
    analysisController.current?.abort();
    setNotice("Análisis cancelado. No se aplicó ninguna respuesta automática.");
  };

  return (
    <section className="training-page" aria-labelledby="openings-title">
      <header>
        <p className="eyebrow">Repertorio local</p>
        <h1 id="openings-title">Aperturas</h1>
        <p>
          {course.name} · {course.eco}
        </p>
      </header>
      <div className="training-controls">
        <label className="training-field">
          Color{" "}
          <select
            value={color}
            onChange={(event) => setColor(event.target.value as PlayerColor)}
          >
            <option value="white">Blancas</option>
            <option value="black">Negras</option>
          </select>
        </label>
        <label className="training-field">
          Apertura{" "}
          <select value={course.id} onChange={() => undefined}>
            <option value={course.id}>{course.name}</option>
          </select>
        </label>
        <label className="training-field">
          Modo{" "}
          <select
            value={mode}
            onChange={(event) =>
              selectMode(event.target.value as "explain" | "practice")
            }
          >
            <option value="explain">Explicación</option>
            <option value="practice">Práctica</option>
          </select>
        </label>
      </div>
      {!available ? (
        <p role="alert">Esta apertura MVP se practica con blancas.</p>
      ) : mode === "explain" ? (
        <div className="training-layout">
          <TrainingBoard
            game={loadPosition(currentNode?.fen ?? course.nodes[0]!.fen)}
            orientation="white"
            onMove={() => undefined}
            highlights={current.highlightedSquares}
          />
          <aside className="training-panel">
            <p>
              Paso {step + 1} de {course.explanationSteps.length}
            </p>
            <h2>{current.title}</h2>
            <p>{current.description}</p>
            <p>
              <strong>Plan:</strong> {current.futurePlan}
            </p>
            <p>
              <strong>Objetivo:</strong> {course.generalObjective}
            </p>
            <div className="training-actions">
              <button
                type="button"
                onClick={() => setStep((value) => Math.max(0, value - 1))}
                disabled={step === 0}
              >
                Atrás
              </button>
              <button
                type="button"
                onClick={nextStep}
                disabled={step === course.explanationSteps.length - 1}
              >
                Adelante
              </button>
              <button type="button" className="secondary" onClick={autoplay}>
                {isAutoplaying ? "Detener" : "Autoplay"}
              </button>
              <button type="button" onClick={() => selectMode("practice")}>
                Pasar a práctica
              </button>
            </div>
            <p role="status" aria-live="polite">
              {notice}
            </p>
          </aside>
        </div>
      ) : (
        <div className="training-layout">
          <TrainingBoard
            game={practice}
            orientation="white"
            onMove={play}
            disabled={isAnalyzing || practice.turn !== color}
          />
          <aside className="training-panel">
            <h2>Práctica guiada</h2>
            <p>{course.description}</p>
            <p role="status" aria-live="polite">
              {notice || "Juega una jugada del repertorio."}
            </p>
            {isAnalyzing ? (
              <button
                type="button"
                className="secondary"
                onClick={cancelAnalysis}
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
                onClick={() => selectMode("explain")}
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
