import {
  createInitialGame,
  loadPgn,
  listCaptures,
  restoreSession,
  type GameSession,
  type PieceType,
  type PlayerColor,
} from "@chess-coach/chess-core";
import type { ChessEngine, EngineBackend } from "@chess-coach/engine";
import {
  analyzeMove,
  hintForLevel,
  type MoveLabel,
  type CoachFeedback,
} from "@chess-coach/coach";
import { useEffect, useMemo, useRef, useState } from "react";
import { GameSetup } from "./GameSetup";
import { createBrowserStockfishEngine } from "./engineClient";
import { PieceIcon } from "./PieceIcon";
import {
  boardForFen,
  boardRows,
  createLocalGame,
  legalDestinations,
  playMove,
  playUciMove,
  type Square,
  undoMove,
} from "./localGame";
import {
  clearStoredGame,
  DEFAULT_SETTINGS,
  exportPgn,
  loadStoredGame,
  saveStoredGame,
  type MoveQualityAnnotation,
  type GameSettings,
} from "./persistence";

const initialSnapshot = createInitialGame();
type EngineState = "idle" | "thinking" | "ready" | "error";
const colorName = (color: PlayerColor) =>
  color === "white" ? "blancas" : "negras";
const backendLabel = (backend: EngineBackend) =>
  backend === "stockfish-wasm"
    ? "Stockfish WASM"
    : backend === "stockfish-asmjs"
      ? "Stockfish ASM.js · modo compatible"
      : "Motor determinista";

const qualityMeta: Record<
  MoveLabel,
  { readonly icon: string; readonly label: string; readonly className: string }
> = {
  excellent: { icon: "★", label: "Excelente", className: "excellent" },
  good: { icon: "✓", label: "Buena", className: "good" },
  inaccuracy: { icon: "!", label: "Imprecisión", className: "inaccuracy" },
  mistake: { icon: "?", label: "Error", className: "mistake" },
  blunder: { icon: "‼", label: "Error grave", className: "blunder" },
};

const capturedTypeOrder = ["q", "r", "b", "n", "p", "k"] as const;
const capturedTypeNames: Record<PieceType, string> = {
  q: "dama",
  r: "torre",
  b: "alfil",
  n: "caballo",
  p: "peón",
  k: "rey",
};
const capturedTypePlural: Record<PieceType, string> = {
  q: "damas",
  r: "torres",
  b: "alfiles",
  n: "caballos",
  p: "peones",
  k: "reyes",
};

function QualityBadge({ label }: { readonly label: MoveLabel }) {
  const meta = qualityMeta[label];
  return (
    <span
      className={`quality-badge quality-${meta.className}`}
      title={meta.label}
      aria-label={`Calidad de la jugada: ${meta.label}`}
    >
      <span aria-hidden="true">{meta.icon}</span>
      <span className="visually-hidden">{meta.label}</span>
    </span>
  );
}

function CapturedTray({
  capturer,
  captured,
  label,
}: {
  readonly capturer: PlayerColor;
  readonly captured: readonly {
    readonly color: PlayerColor;
    readonly type: PieceType;
  }[];
  readonly label: string;
}) {
  return (
    <section className="captured-tray" aria-label={label}>
      <h2>{label}</h2>
      <div className="captured-pieces">
        {captured.length === 0 ? (
          <span className="captured-empty">Ninguna</span>
        ) : (
          capturedTypeOrder.flatMap((type) => {
            const pieces = captured.filter((piece) => piece.type === type);
            if (pieces.length === 0) return [];
            const piece = pieces[0];
            if (!piece) return [];
            return [
              <span
                role="img"
                className="captured-group"
                key={`${capturer}-${type}`}
                aria-label={`${pieces.length} ${pieces.length === 1 ? capturedTypeNames[type] : capturedTypePlural[type]} ${piece.color === "white" ? "blancas" : "negras"} capturadas`}
              >
                <PieceIcon color={piece.color} type={piece.type} />
                {pieces.length > 1 ? (
                  <span aria-hidden="true">×{pieces.length}</span>
                ) : null}
              </span>,
            ];
          })
        )}
      </div>
    </section>
  );
}

function getRecoveredState(): {
  readonly session: GameSession;
  readonly settings: GameSettings;
  readonly annotations: readonly MoveQualityAnnotation[];
  readonly feedback?: CoachFeedback;
} | null {
  if (typeof window === "undefined") return null;
  const stored = loadStoredGame(window.localStorage);
  if (!stored) return null;
  try {
    return {
      session: restoreSession(stored.session),
      settings: stored.settings,
      annotations: stored.annotations,
      ...(stored.lastFeedback === undefined
        ? {}
        : { feedback: stored.lastFeedback }),
    };
  } catch {
    clearStoredGame(window.localStorage);
    return null;
  }
}

function applyEngineLine(current: GameSession, uci: string): GameSession {
  return playUciMove(current, uci);
}

export function App() {
  const recovered = useMemo(getRecoveredState, []);
  const [started, setStarted] = useState(() => recovered !== null);
  const [hasSavedGame, setHasSavedGame] = useState(() => recovered !== null);
  const [settings, setSettings] = useState<GameSettings>(
    () => recovered?.settings ?? DEFAULT_SETTINGS,
  );
  const [game, setGame] = useState(() =>
    createLocalGame(recovered?.session ?? initialSnapshot),
  );
  const [moveAnnotations, setMoveAnnotations] = useState<
    readonly MoveQualityAnnotation[]
  >(() => recovered?.annotations ?? []);
  const [feedback, setFeedback] = useState<CoachFeedback | undefined>(
    () => recovered?.feedback,
  );
  const [selected, setSelected] = useState<Square>();
  const [engineState, setEngineState] = useState<EngineState>("idle");
  const [paused, setPaused] = useState(false);
  const [sessionError, setSessionError] = useState<string>();
  const [engineMessage, setEngineMessage] = useState(
    "El motor local está disponible.",
  );
  const generation = useRef(0);
  const annotationGeneration = useRef(0);
  const engineRef = useRef<ChessEngine | null>(null);
  const coachEngineRef = useRef<ChessEngine | null>(null);
  const [engineBackend, setEngineBackend] = useState<EngineBackend>();
  const playerColor: PlayerColor =
    settings.playerColor === "random" ? "white" : settings.playerColor;
  const engineColor: PlayerColor = playerColor === "white" ? "black" : "white";
  const board = useMemo(() => boardForFen(game.fen), [game.fen]);
  const lastMove = game.history.at(-1);
  const lastMoveIndex = game.history.length - 1;
  const lastMoveColor =
    lastMoveIndex >= 0 &&
    ((game.initialFen.split(" ")[1] === "w" && lastMoveIndex % 2 === 0) ||
      (game.initialFen.split(" ")[1] !== "w" && lastMoveIndex % 2 === 1))
      ? "white"
      : "black";
  const captures = useMemo(() => listCaptures(game), [game]);
  const capturedByColor = useMemo(
    () => ({
      white: captures.filter((capture) => capture.capturer === "white"),
      black: captures.filter((capture) => capture.capturer === "black"),
    }),
    [captures],
  );
  const latestAnnotation = moveAnnotations.at(-1);
  const latestAnnotationIsCurrent =
    latestAnnotation !== undefined &&
    game.history[latestAnnotation.historyIndex]?.uci === latestAnnotation.uci;
  const qualityBySquare = useMemo(
    () =>
      latestAnnotationIsCurrent && latestAnnotation
        ? new Map([[latestAnnotation.uci.slice(2, 4), latestAnnotation]])
        : new Map<string, MoveQualityAnnotation>(),
    [latestAnnotation, latestAnnotationIsCurrent],
  );
  const annotationByHistoryIndex = useMemo(
    () =>
      new Map(
        moveAnnotations.map((annotation) => [
          annotation.historyIndex,
          annotation,
        ]),
      ),
    [moveAnnotations],
  );
  const destinations = useMemo(
    () => (selected ? legalDestinations(game, selected) : []),
    [game, selected],
  );

  useEffect(() => {
    if (!started || typeof window === "undefined") return;
    saveStoredGame(
      game,
      settings,
      window.localStorage,
      moveAnnotations,
      feedback,
    );
  }, [feedback, game, moveAnnotations, settings, started]);

  useEffect(
    () => () => {
      void engineRef.current?.dispose();
      void coachEngineRef.current?.dispose();
    },
    [],
  );

  useEffect(() => {
    if (!started || paused || game.turn !== engineColor) return;
    const engineMayStart = game.history.length === 0 && engineColor === "white";
    if (game.history.length === 0 && !engineMayStart) return;
    const controller = new AbortController();
    const currentGeneration = ++generation.current;
    const requestFen = game.fen;
    const requestHistoryLength = game.history.length;
    const requestId = `analysis-${currentGeneration}-${requestHistoryLength}`;
    setEngineState("thinking");
    setEngineMessage("El motor local está analizando la posición.");
    const engine = (engineRef.current ??= createBrowserStockfishEngine());

    void engine
      .analyze(
        {
          id: requestId,
          fen: requestFen,
          perspective: playerColor,
          preset: settings.enginePreset,
          multiPv: 1,
          limit: {
            kind: "time",
            milliseconds: {
              beginner: 250,
              intermediate: 700,
              advanced: 1500,
            }[settings.enginePreset],
          },
        },
        controller.signal,
      )
      .then((result) => {
        if (
          controller.signal.aborted ||
          generation.current !== currentGeneration ||
          result.id !== requestId
        )
          return;
        const uci = result.lines[0]?.moves[0];
        if (!uci) throw new Error("Engine returned no move");
        setGame((current) => {
          if (
            current.fen !== requestFen ||
            current.history.length !== requestHistoryLength
          )
            return current;
          return applyEngineLine(current, uci);
        });
        setEngineState("ready");
        setEngineBackend(engine.getStatus().backend);
        setEngineMessage(
          `${backendLabel(engine.getStatus().backend)}: respuesta aplicada ${uci}. Profundidad ${result.depth}, ${result.nodes.toLocaleString("es-ES")} nodos.`,
        );
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError")
          return;
        if (generation.current !== currentGeneration) return;
        setEngineState("error");
        setSessionError(
          "Stockfish WASM y el modo compatible ASM.js no pudieron iniciarse.",
        );
      });

    return () => {
      controller.abort();
      generation.current += 1;
    };
  }, [
    engineColor,
    game.fen,
    game.history.length,
    game.turn,
    playerColor,
    paused,
    settings.enginePreset,
    started,
  ]);

  if (!started) {
    return (
      <GameSetup
        initialSettings={settings}
        hasSavedGame={hasSavedGame}
        onStart={(nextSettings) => {
          const selectedColor: PlayerColor =
            nextSettings.playerColor === "random"
              ? Math.random() < 0.5
                ? "white"
                : "black"
              : nextSettings.playerColor;
          const resolvedSettings: GameSettings = {
            ...nextSettings,
            playerColor: selectedColor,
          };
          generation.current += 1;
          clearStoredGame();
          setSettings(resolvedSettings);
          setGame(createLocalGame(initialSnapshot));
          setMoveAnnotations([]);
          setFeedback(undefined);
          setHasSavedGame(false);
          setStarted(true);
        }}
        onResume={() => setStarted(true)}
        onClearSavedGame={() => {
          clearStoredGame();
          setHasSavedGame(false);
        }}
      />
    );
  }

  const selectSquare = (square: Square) => {
    if (paused || engineState === "thinking" || game.turn !== playerColor)
      return;
    if (selected && destinations.includes(square)) {
      const annotationRequest = ++annotationGeneration.current;
      setFeedback(undefined);
      setGame((current) => {
        const next = playMove(current, selected, square);
        const analysisEngine = (coachEngineRef.current ??=
          createBrowserStockfishEngine());
        void (async () => {
          const beforeResult = await analysisEngine.analyze({
            id: `coach-before-${current.history.length}`,
            fen: current.fen,
            perspective: playerColor,
            multiPv: 1,
            limit: { kind: "time", milliseconds: 1 },
          });
          const afterResult = await analysisEngine.analyze({
            id: `coach-after-${next.history.length}`,
            fen: next.fen,
            perspective: playerColor,
            multiPv: 1,
            limit: { kind: "time", milliseconds: 1 },
          });
          const beforeLine = beforeResult.lines[0];
          const afterLine = afterResult.lines[0];
          if (!beforeLine || !afterLine) return;
          const nextFeedback = analyzeMove(
            current,
            next,
            beforeLine,
            afterLine,
          );
          if (annotationGeneration.current !== annotationRequest) return;
          setFeedback(nextFeedback);
          setMoveAnnotations((annotations) => [
            ...annotations.filter(
              (annotation) =>
                annotation.historyIndex !== next.history.length - 1,
            ),
            {
              historyIndex: next.history.length - 1,
              uci: next.history.at(-1)?.uci ?? "",
              label: nextFeedback.label,
            },
          ]);
          setEngineBackend(analysisEngine.getStatus().backend);
        })().catch((error: unknown) => {
          setSessionError(
            error instanceof Error
              ? `No se pudo generar el feedback: ${error.message}`
              : "No se pudo generar el feedback de esta jugada.",
          );
        });
        return next;
      });
      setSelected(undefined);
      return;
    }
    setSelected(board.get(square)?.color === game.turn ? square : undefined);
  };

  const reset = () => {
    generation.current += 1;
    annotationGeneration.current += 1;
    setGame(createLocalGame(initialSnapshot));
    setMoveAnnotations([]);
    setSelected(undefined);
    setPaused(false);
    setSessionError(undefined);
    setFeedback(undefined);
    setEngineState("idle");
    setEngineMessage("El motor local está disponible.");
  };

  const undo = () => {
    generation.current += 1;
    annotationGeneration.current += 1;
    const restored = undoMove(game);
    setGame(restored);
    setMoveAnnotations((annotations) =>
      annotations.filter(
        (annotation) => annotation.historyIndex < restored.history.length,
      ),
    );
    setSelected(undefined);
    setPaused(false);
    setSessionError(undefined);
    setFeedback(undefined);
    setEngineState("idle");
    setEngineMessage("El motor local está disponible.");
  };

  const abandon = () => {
    if (!window.confirm("¿Abandonar esta partida y borrar su guardado local?"))
      return;
    generation.current += 1;
    annotationGeneration.current += 1;
    clearStoredGame();
    setHasSavedGame(false);
    setStarted(false);
    setPaused(false);
    setMoveAnnotations([]);
    setFeedback(undefined);
  };

  const downloadPgn = () => {
    const blob = new Blob([exportPgn(game)], {
      type: "application/x-chess-pgn",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "chess-coach-partida.pgn";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const importPgnFile = async (file: File) => {
    try {
      const imported = loadPgn(await file.text());
      generation.current += 1;
      setGame(createLocalGame(imported));
      annotationGeneration.current += 1;
      setMoveAnnotations([]);
      setSelected(undefined);
      setPaused(false);
      setSessionError(undefined);
      setFeedback(undefined);
      setEngineState("idle");
      setEngineMessage("PGN importado. La partida puede continuar.");
    } catch {
      setSessionError("El archivo no contiene un PGN válido o legal.");
    }
  };

  return (
    <main className="shell">
      <section className="game" aria-labelledby="page-title">
        <header className="game-header">
          <div>
            <p className="eyebrow">Partida local · Sin cuenta</p>
            <h1 id="page-title">Tablero de práctica</h1>
          </div>
          <p className="turn" aria-live="polite">
            Turno de {colorName(game.turn)} · Tú juegas con{" "}
            {colorName(playerColor)}
          </p>
        </header>
        <div className="game-layout">
          <section className="board-panel" aria-label="Tablero de ajedrez">
            <p className="board-help" id="board-help">
              Selecciona una pieza y después una casilla marcada para moverla.
            </p>
            <div
              className="board"
              role="grid"
              aria-describedby="board-help"
              aria-label={`Tablero: turno de ${colorName(game.turn)}`}
            >
              {boardRows.map((row) => (
                <div role="row" key={row[0]}>
                  {row.map((square) => {
                    const piece = board.get(square);
                    const file = square.charCodeAt(0) - 97;
                    const rank = Number(square[1]);
                    const isSelected = selected === square;
                    const isDestination = destinations.includes(square);
                    const squareQuality = qualityBySquare.get(square);
                    const isLastMoveFrom = lastMove?.from === square;
                    const isLastMoveTo = lastMove?.to === square;
                    return (
                      <button
                        key={square}
                        type="button"
                        className={`square ${(file + rank) % 2 === 0 ? "light" : "dark"}${isSelected ? " selected" : ""}${isDestination ? " destination" : ""}${isLastMoveFrom ? " last-move-from" : ""}${isLastMoveTo ? " last-move-to" : ""}`}
                        onClick={() => selectSquare(square)}
                        aria-label={`${square}${piece ? `, pieza ${piece.color === "white" ? "blanca" : "negra"}` : ", vacía"}${isDestination ? ", destino legal" : ""}${isLastMoveFrom ? ", origen de la última jugada" : ""}${isLastMoveTo ? ", destino de la última jugada" : ""}${squareQuality ? `, calidad de la jugada: ${qualityMeta[squareQuality.label].label}` : ""}`}
                        aria-pressed={isSelected}
                        disabled={
                          paused ||
                          engineState === "thinking" ||
                          game.turn !== playerColor
                        }
                      >
                        {piece ? (
                          <PieceIcon color={piece.color} type={piece.type} />
                        ) : null}
                        {squareQuality ? (
                          <QualityBadge label={squareQuality.label} />
                        ) : null}
                        {square[0] === "a" ? (
                          <small className="rank">{square[1]}</small>
                        ) : null}
                        {square[1] === "1" ? (
                          <small className="file">{square[0]}</small>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
            {lastMove ? (
              <p className="last-move-note" aria-live="polite">
                Última jugada: <strong>{lastMove.san}</strong> · {lastMove.from}{" "}
                → {lastMove.to} ·{" "}
                {lastMoveColor === playerColor ? "Tú" : "Stockfish"}
              </p>
            ) : null}
            <div className="captured-trays">
              <CapturedTray
                capturer={playerColor}
                captured={capturedByColor[playerColor].map(
                  (capture) => capture.piece,
                )}
                label="Capturadas por ti"
              />
              <CapturedTray
                capturer={engineColor}
                captured={capturedByColor[engineColor].map(
                  (capture) => capture.piece,
                )}
                label="Capturadas por Stockfish"
              />
            </div>
          </section>
          <aside className="side-panel" aria-label="Controles y movimientos">
            <section className="engine-status" aria-live="polite">
              <p className="label">
                {engineBackend ? backendLabel(engineBackend) : "Motor local"} ·{" "}
                {settings.enginePreset}
              </p>
              <strong data-state={engineState}>
                {engineState === "thinking"
                  ? "Analizando"
                  : engineState === "ready"
                    ? "Listo"
                    : engineState === "error"
                      ? "No disponible"
                      : "En espera"}
              </strong>
              <p>{engineMessage}</p>
            </section>
            <div className="controls">
              <button
                type="button"
                onClick={undo}
                disabled={game.history.length === 0}
              >
                Deshacer
              </button>
              <button type="button" className="secondary" onClick={reset}>
                Reiniciar
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => setPaused((value) => !value)}
                disabled={engineState === "thinking"}
              >
                {paused ? "Reanudar" : "Pausar"}
              </button>
              <button type="button" className="secondary" onClick={abandon}>
                Abandonar
              </button>
            </div>
            <div className="file-controls" aria-label="PGN">
              <button type="button" onClick={downloadPgn}>
                Exportar PGN
              </button>
              <label className="file-button">
                Importar PGN
                <input
                  type="file"
                  accept=".pgn,text/plain,application/x-chess-pgn"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void importPgnFile(file);
                    event.target.value = "";
                  }}
                />
              </label>
            </div>
            {sessionError ? (
              <p className="session-error" role="alert">
                {sessionError}
              </p>
            ) : null}
            {feedback ? (
              <section className="feedback" aria-labelledby="feedback-title">
                <div className="moves-heading">
                  <h2 id="feedback-title">Feedback de tu jugada</h2>
                  <strong>{feedback.label}</strong>
                </div>
                <p>{feedback.explanation}</p>
                <p className="feedback-meta">
                  Pérdida esperada: {(feedback.loss * 100).toFixed(1)} puntos
                  porcentuales · Motivo: {feedback.motif}
                  {feedback.isEstimated ? " · estimación calibrada" : ""}
                </p>
                {hintForLevel(feedback, 1, settings.helpLevel) ? (
                  <p>
                    <strong>Pista:</strong>{" "}
                    {hintForLevel(feedback, 1, settings.helpLevel)}
                  </p>
                ) : null}
              </section>
            ) : null}
            <section className="moves" aria-labelledby="moves-title">
              <div className="moves-heading">
                <h2 id="moves-title">Movimientos</h2>
                <span>{game.history.length}</span>
              </div>
              {game.history.length ? (
                <ol>
                  {game.history.map((move, index) => (
                    <li key={`${move.uci}-${index}`}>
                      <span>{index + 1}.</span>
                      <span className="move-entry">
                        {move.san}
                        <small
                          aria-label={`Recorrido ${move.from} a ${move.to}`}
                        >
                          {move.from} → {move.to}
                        </small>
                        {annotationByHistoryIndex.get(index) ? (
                          <QualityBadge
                            label={annotationByHistoryIndex.get(index)!.label}
                          />
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p>Aún no hay movimientos.</p>
              )}
            </section>
          </aside>
        </div>
      </section>
    </main>
  );
}
