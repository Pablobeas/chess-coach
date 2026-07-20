import {
  createInitialGame,
  formatMoveReference,
  formatMoveSequence,
  loadPgn,
  listCaptures,
  restoreSession,
  type GameSession,
  type PieceType,
  type PlayerColor,
} from "@chess-coach/chess-core";
import {
  type AnalysisProgress,
  type AnalysisResult,
  type ChessEngine,
  type OpponentEngine,
  type EngineScore,
} from "@chess-coach/engine";
import {
  assessTurn,
  analyzeTurn,
  type MoveLabel,
  type CoachTurnRecord,
} from "@chess-coach/coach";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  orientedBoardRows,
  squareOffset,
  squarePoint,
  visualMoveOffset,
} from "./boardOrientation";
import { createAnalysisCache } from "./analysisCache";
import { GameSetup } from "./GameSetup";
import { createBrowserStockfishEngine } from "./engineClient";
import { coachSearchPlan } from "./coachSearchPlan";
import { prewarmCoachPosition } from "./coachPrewarm";
import { createLocalMaia3Opponent } from "./maia3Client";
import { disposeEngineRef } from "./engineLifecycle";
import {
  createMoveAnimation,
  ENGINE_RESPONSE_DELAY_MS,
  isEditableKeyboardTarget,
  type MoveAnimation,
  PIECE_MOVE_DURATION_MS,
  waitForDelay,
} from "./gameInteractions";
import { PieceIcon } from "./PieceIcon";
import { groupMoveHistory, type HistoryPly } from "./moveHistory";
import {
  boardForFen,
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
  type MoveFeedbackRecord,
  type RecoverySnapshot,
  type GameSettings,
} from "./persistence";
import {
  boardMoveQualityAnnotation,
  MINIMUM_PROVISIONAL_QUALITY_DEPTH,
  type DisplayedMoveQualityAnnotation,
  type ProvisionalMoveQualityAnnotation,
  updateProvisionalMoveQuality,
  visibleMoveQualityAnnotations,
} from "./progressiveMoveQuality";
import { createSerialTaskQueue } from "./serialTaskQueue";
import {
  continueNavigationFromCursor,
  createNavigationTimeline,
  moveNavigationCursor,
  replaceNavigationLine,
  sessionAtNavigationCursor,
} from "./navigationTimeline";

const initialSnapshot = createInitialGame();
type EngineState = "idle" | "thinking" | "ready" | "error";
type PositionNotice = {
  readonly kind: "check" | "checkmate";
  readonly checkedColor: PlayerColor;
};
const colorName = (color: PlayerColor) =>
  color === "white" ? "blancas" : "negras";
const qualityMeta: Record<
  MoveLabel,
  { readonly icon: string; readonly label: string; readonly className: string }
> = {
  best: { icon: "✓", label: "Mejor jugada", className: "best" },
  brilliant: { icon: "✦", label: "Brillante", className: "brilliant" },
  great: { icon: "◆", label: "Gran jugada", className: "great" },
  excellent: { icon: "★", label: "Excelente", className: "excellent" },
  good: { icon: "✓", label: "Buena", className: "good" },
  inaccuracy: { icon: "!", label: "Imprecisión", className: "inaccuracy" },
  mistake: { icon: "?", label: "Error", className: "mistake" },
  blunder: { icon: "‼", label: "Error grave", className: "blunder" },
  miss: { icon: "↗", label: "Oportunidad perdida", className: "miss" },
  "already-lost": {
    icon: "≈",
    label: "Posición ya difícil",
    className: "already-lost",
  },
};

const capturedTypeOrder = ["q", "r", "b", "n", "p", "k"] as const;
function formatEvaluation(score: EngineScore | undefined): string {
  if (!score) return "…";
  if (score.kind === "mate")
    return `${score.moves >= 0 ? "M" : "−M"}${Math.abs(score.moves)}`;
  const value = score.value / 100;
  return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(1).replace(".", ",")}`;
}
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

const motifLabels: Readonly<Record<string, string>> = Object.freeze({
  mate: "mate o amenaza de mate",
  material: "material",
  "hanging-piece": "pieza en peligro",
  tactical: "táctica",
  "king-safety": "seguridad del rey",
  threat: "amenaza",
  structure: "estructura de peones",
  development: "desarrollo",
  activity: "actividad medida",
  equivalent: "alternativas equivalentes",
  neutral: "posición",
  none: "sin motivo adicional",
});

function QualityBadge({
  label,
  provisional = false,
}: {
  readonly label: MoveLabel;
  readonly provisional?: boolean;
}) {
  const meta = qualityMeta[label];
  const description = provisional
    ? `Valoración provisional: ${meta.label}`
    : `Calidad de la jugada: ${meta.label}`;
  return (
    <span
      className={`quality-badge quality-${meta.className}${provisional ? " quality-provisional" : ""}`}
      title={description}
      aria-label={description}
    >
      <span aria-hidden="true">{meta.icon}</span>
      <span className="visually-hidden">{description}</span>
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

function AdvicePanel({
  feedbackEntry,
  helpLevel,
  selectedMaia,
  lineVisible,
  onToggleLine,
  onRetry,
}: {
  readonly feedbackEntry: MoveFeedbackRecord | undefined;
  readonly helpLevel: GameSettings["helpLevel"];
  readonly selectedMaia: boolean;
  readonly lineVisible: boolean;
  readonly onToggleLine: () => void;
  readonly onRetry: () => void;
}) {
  const feedback = feedbackEntry?.record;
  const displayedLine = useMemo(
    () =>
      feedback
        ? formatMoveSequence(
            feedback.turn.beforeFen,
            feedback.evidence.verifiedBestVariation,
          )
        : [],
    [feedback?.turn.beforeFen, feedback?.evidence.verifiedBestVariation],
  );
  if (helpLevel === "none") return null;
  return (
    <aside className="advice-panel" aria-label="Consejos del entrenador">
      <p className="visually-hidden" aria-live="polite" aria-atomic="true">
        {feedbackEntry?.status === "pending"
          ? "Estoy revisando tu jugada."
          : feedbackEntry?.status === "ready" && feedbackEntry.actor === "user"
            ? `Feedback listo para ${feedbackEntry.record?.turn.playedSan ?? "tu jugada"}.`
            : feedbackEntry?.status === "unavailable"
              ? "El análisis local de esta jugada no está disponible."
              : ""}
      </p>
      {feedbackEntry?.status === "pending" ? (
        <section
          className="feedback feedback-empty"
          aria-labelledby="feedback-title"
        >
          <h2 id="feedback-title">Estoy revisando esa decisión…</h2>
          <p>El tablero sigue disponible mientras termina el análisis local.</p>
        </section>
      ) : feedbackEntry?.status === "unavailable" ? (
        <section
          className="feedback feedback-empty"
          aria-labelledby="feedback-title"
        >
          <h2 id="feedback-title">No pude terminar este análisis</h2>
          <p>
            La partida sigue siendo válida; puedes continuar o volver a esta
            jugada después.
          </p>
        </section>
      ) : feedback ? (
        <section className="feedback" aria-labelledby="feedback-title">
          <div className="moves-heading">
            <h2 id="feedback-title">Feedback de tu jugada</h2>
            <strong>
              {feedback.assessment
                ? qualityMeta[feedback.assessment.label].label
                : ""}
            </strong>
          </div>
          <p>{feedback.copy?.text}</p>
          <p className="feedback-meta">
            Motivo: {motifLabels[feedback.motif.kind] ?? "posición"}
            {feedback.motif.confidence
              ? ` · confianza ${feedback.motif.confidence}`
              : ""}
          </p>
          <div className="feedback-actions">
            {displayedLine.length ? (
              <button
                type="button"
                className="secondary"
                onClick={onToggleLine}
              >
                {lineVisible ? "Ocultar línea" : "Mostrar línea"}
              </button>
            ) : null}
            {feedback.turn.actor === "user" &&
            feedback.evidence.bestMove &&
            feedback.evidence.bestMove.uci !== feedback.turn.playedUci ? (
              <button type="button" onClick={onRetry}>
                Probar alternativa
              </button>
            ) : null}
          </div>
          {lineVisible && displayedLine.length ? (
            <ol
              className="feedback-line"
              aria-label="Línea principal verificada"
            >
              {displayedLine.map((move, index) => (
                <li key={`${move}-${index}`}>{move}</li>
              ))}
            </ol>
          ) : null}
          {helpLevel === "guided" && feedback.hints.length ? (
            <details>
              <summary>Pistas para profundizar</summary>
              <ol>
                {feedback.hints.map((hint) => (
                  <li key={hint.level}>{hint.text}</li>
                ))}
              </ol>
            </details>
          ) : null}
        </section>
      ) : selectedMaia ? (
        <section
          className="feedback feedback-empty"
          aria-labelledby="feedback-title"
        >
          <h2 id="feedback-title">Respuesta de Maia-3</h2>
          <p>
            Esta jugada conserva su evaluación en el historial. Selecciona una
            de tus jugadas para recuperar el comentario.
          </p>
        </section>
      ) : (
        <section
          className="feedback feedback-empty"
          aria-labelledby="feedback-title"
        >
          <h2 id="feedback-title">Consejos del entrenador</h2>
          <p>Haz una jugada para recibir una explicación y una pista.</p>
        </section>
      )}
    </aside>
  );
}

function getRecoveredState(): {
  readonly session: GameSession;
  readonly settings: GameSettings;
  readonly annotations: readonly MoveQualityAnnotation[];
  readonly feedbackByPly: readonly MoveFeedbackRecord[];
  readonly cursor: number;
  readonly recovery?: RecoverySnapshot;
} | null {
  if (typeof window === "undefined") return null;
  const stored = loadStoredGame(window.localStorage);
  if (!stored) return null;
  try {
    return {
      session: restoreSession(stored.session),
      settings: stored.settings,
      annotations: stored.annotations,
      feedbackByPly: stored.feedbackByPly,
      cursor: stored.cursor,
      ...(stored.recovery === undefined ? {} : { recovery: stored.recovery }),
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
  const [timeline, setTimeline] = useState(() =>
    createNavigationTimeline(
      recovered?.session ?? initialSnapshot,
      recovered?.cursor,
    ),
  );
  const [moveAnnotations, setMoveAnnotations] = useState<
    readonly MoveQualityAnnotation[]
  >(() => recovered?.annotations ?? []);
  const [provisionalMoveQuality, setProvisionalMoveQuality] = useState<
    ProvisionalMoveQualityAnnotation | undefined
  >();
  const [feedback, setFeedback] = useState<CoachTurnRecord | undefined>(
    () =>
      recovered?.feedbackByPly.find(
        (record) => record.historyIndex === recovered.cursor - 1,
      )?.record,
  );
  const [feedbackByPly, setFeedbackByPly] = useState<
    readonly MoveFeedbackRecord[]
  >(() => recovered?.feedbackByPly ?? []);
  const [recoverySnapshot, setRecoverySnapshot] = useState<
    RecoverySnapshot | undefined
  >(() => recovered?.recovery);
  const [positionNotice, setPositionNotice] = useState<PositionNotice>();
  const [selected, setSelected] = useState<Square>();
  const [lineVisiblePly, setLineVisiblePly] = useState<number>();
  const [engineState, setEngineState] = useState<EngineState>("idle");
  const [paused, setPaused] = useState(
    () =>
      recovered !== null && recovered.cursor < recovered.session.history.length,
  );
  const [sessionError, setSessionError] = useState<string>();
  const [engineMessage, setEngineMessage] = useState(
    "Maia-3 5M está disponible como oponente local.",
  );
  const [maiaRetry, setMaiaRetry] = useState(0);
  const generation = useRef(0);
  const game = useMemo(
    () => createLocalGame(sessionAtNavigationCursor(timeline)),
    [timeline],
  );
  const hasFuture = timeline.cursor < timeline.session.history.length;
  const previousHistoryLength = useRef(game.history.length);
  const engineRef = useRef<OpponentEngine | null>(null);
  const coachEngineRef = useRef<ChessEngine | null>(null);
  const coachAnalysisCacheRef = useRef<ReturnType<
    typeof createAnalysisCache
  > | null>(null);
  const coachAnalysisCache = (coachAnalysisCacheRef.current ??=
    createAnalysisCache());
  const coachPrewarmControllersRef = useRef(new Set<AbortController>());
  const coachQueueRef = useRef<ReturnType<typeof createSerialTaskQueue> | null>(
    null,
  );
  if (coachQueueRef.current === null)
    coachQueueRef.current = createSerialTaskQueue();
  const [moveAnimation, setMoveAnimation] = useState<MoveAnimation>();
  const animationTimer = useRef<number | undefined>(undefined);
  const undoShortcut = useRef<() => void>(() => undefined);
  const redoShortcut = useRef<() => void>(() => undefined);
  const continueShortcut = useRef<() => void>(() => undefined);
  const cancelCoachPrewarms = () => {
    for (const controller of coachPrewarmControllersRef.current)
      controller.abort();
    coachPrewarmControllersRef.current.clear();
  };
  const playerColor: PlayerColor =
    settings.playerColor === "random" ? "white" : settings.playerColor;
  const engineColor: PlayerColor = playerColor === "white" ? "black" : "white";
  const board = useMemo(() => boardForFen(game.fen), [game.fen]);
  const visualBoardRows = useMemo(
    () => orientedBoardRows(playerColor),
    [playerColor],
  );
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
  const displayedMoveAnnotations = useMemo(
    () =>
      visibleMoveQualityAnnotations(
        moveAnnotations,
        provisionalMoveQuality,
        game.history,
      ),
    [game.history, moveAnnotations, provisionalMoveQuality],
  );
  const boardAnnotation = useMemo(
    () =>
      boardMoveQualityAnnotation(
        displayedMoveAnnotations,
        game.history,
        playerColor,
        game.initialFen.split(" ")[1] === "w" ? "white" : "black",
      ),
    [displayedMoveAnnotations, game.history, game.initialFen, playerColor],
  );
  const qualityBySquare = useMemo(
    () =>
      boardAnnotation
        ? new Map<string, DisplayedMoveQualityAnnotation>([
            [boardAnnotation.uci.slice(2, 4), boardAnnotation],
          ])
        : new Map<string, DisplayedMoveQualityAnnotation>(),
    [boardAnnotation],
  );
  const lastMoveArrow = lastMove
    ? {
        ...squarePoint(lastMove.from as Square, playerColor),
        to: squarePoint(lastMove.to as Square, playerColor),
      }
    : undefined;
  const annotationByHistoryIndex = useMemo(
    () =>
      new Map(
        displayedMoveAnnotations.map((annotation) => [
          annotation.historyIndex,
          annotation,
        ]),
      ),
    [displayedMoveAnnotations],
  );
  const fullLine = timeline.session;
  const feedbackByHistoryIndex = useMemo(
    () => new Map(feedbackByPly.map((entry) => [entry.historyIndex, entry])),
    [feedbackByPly],
  );
  const historyGroups = useMemo(() => groupMoveHistory(fullLine), [fullLine]);
  const lastMovePly = historyGroups
    .flatMap((group) => [group.white, group.black])
    .find((ply) => ply?.historyIndex === lastMoveIndex);
  const lastMoveDisplay =
    lastMove && lastMovePly
      ? formatMoveReference(lastMovePly.beforeFen, lastMove)
      : lastMove?.san;
  const selectedFeedbackEntry = feedbackByHistoryIndex.get(
    game.history.length - 1,
  );
  const latestUserFeedbackEntry = useMemo(
    () =>
      [...feedbackByPly]
        .reverse()
        .find(
          (entry) =>
            entry.actor === "user" && entry.historyIndex < game.history.length,
        ),
    [feedbackByPly, game.history.length],
  );
  const adviceEntry =
    selectedFeedbackEntry?.actor === "user"
      ? selectedFeedbackEntry
      : !hasFuture
        ? latestUserFeedbackEntry
        : undefined;
  const destinations = useMemo(
    () => (selected ? legalDestinations(game, selected) : []),
    [game, selected],
  );

  const beginMoveAnimation = (
    position: GameSession,
    from: Square,
    to: Square,
  ) => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    setMoveAnimation(createMoveAnimation(position, from, to));
  };

  useEffect(() => {
    if (!moveAnimation) return;
    window.clearTimeout(animationTimer.current);
    animationTimer.current = window.setTimeout(
      () => setMoveAnimation(undefined),
      PIECE_MOVE_DURATION_MS,
    );
    return () => window.clearTimeout(animationTimer.current);
  }, [moveAnimation]);

  useEffect(() => {
    if (!started || typeof window === "undefined") return;
    window.scrollTo({ top: 0, left: 0 });
  }, [started]);

  useEffect(() => {
    if (!started || typeof window === "undefined") return;
    saveStoredGame(
      timeline.session,
      settings,
      window.localStorage,
      moveAnnotations,
      feedbackByPly,
      timeline.cursor,
      recoverySnapshot,
    );
  }, [
    feedbackByPly,
    game,
    moveAnnotations,
    recoverySnapshot,
    settings,
    started,
    timeline,
  ]);

  useEffect(() => {
    const previousLength = previousHistoryLength.current;
    previousHistoryLength.current = game.history.length;
    if (game.history.length <= previousLength) return;

    if (game.isCheckmate) {
      setPositionNotice({ kind: "checkmate", checkedColor: game.turn });
    } else if (game.isCheck) {
      setPositionNotice({ kind: "check", checkedColor: game.turn });
    } else {
      setPositionNotice(undefined);
    }
  }, [game]);

  useEffect(() => {
    if (!positionNotice) return;
    const timer = window.setTimeout(
      () => setPositionNotice(undefined),
      positionNotice.kind === "checkmate" ? 5200 : 2800,
    );
    return () => window.clearTimeout(timer);
  }, [positionNotice]);

  useEffect(
    () => () => {
      // Always detach before dispose. StrictMode and HMR may run this cleanup
      // and then remount the component while preserving its refs.
      disposeEngineRef(engineRef);
      disposeEngineRef(coachEngineRef);
      cancelCoachPrewarms();
      coachQueueRef.current?.dispose();
    },
    [],
  );

  useEffect(() => {
    if (
      !started ||
      paused ||
      hasFuture ||
      game.isGameOver ||
      game.turn !== playerColor
    )
      return;
    const engine = (coachEngineRef.current ??= createBrowserStockfishEngine());
    const controller = new AbortController();
    coachPrewarmControllersRef.current.add(controller);
    // This is the exact request the next user move will consume. Starting it
    // during think time moves work off the post-move critical path; the cache
    // shares the same in-flight promise if the player moves before it finishes.
    void prewarmCoachPosition({
      cache: coachAnalysisCache,
      engine,
      fen: game.fen,
      perspective: playerColor,
      preset: settings.enginePreset,
      historyIndex: game.history.length,
      signal: controller.signal,
    })
      .catch(() => undefined)
      .finally(() => coachPrewarmControllersRef.current.delete(controller));
  }, [
    coachAnalysisCache,
    game.fen,
    game.history.length,
    game.isGameOver,
    game.turn,
    hasFuture,
    paused,
    playerColor,
    settings.enginePreset,
    started,
  ]);

  useEffect(() => {
    if (!started || paused || hasFuture || game.turn !== engineColor) return;
    const engineMayStart = game.history.length === 0 && engineColor === "white";
    if (game.history.length === 0 && !engineMayStart) return;
    const controller = new AbortController();
    const currentGeneration = ++generation.current;
    const requestFen = game.fen;
    const requestPosition = game;
    const requestHistoryLength = game.history.length;
    const requestId = `opponent-${currentGeneration}-${requestHistoryLength}`;
    setEngineState("thinking");
    setSessionError(undefined);
    setEngineMessage("Maia-3 está eligiendo una jugada humana plausible.");
    const engine = (engineRef.current ??= createLocalMaia3Opponent());

    void engine
      .chooseMove(
        {
          id: requestId,
          fen: requestFen,
          initialFen: game.initialFen,
          moves: game.history.map((move) => move.uci),
          selfElo: settings.opponentElo,
          opponentElo: settings.opponentElo,
          temperature: 1,
          multiPv: 5,
        },
        controller.signal,
      )
      .then(async (result) => {
        if (
          controller.signal.aborted ||
          generation.current !== currentGeneration ||
          result.id !== requestId
        )
          return;
        const uci = result.move;
        await waitForDelay(ENGINE_RESPONSE_DELAY_MS, controller.signal);
        if (
          controller.signal.aborted ||
          generation.current !== currentGeneration
        )
          return;
        beginMoveAnimation(
          requestPosition,
          uci.slice(0, 2) as Square,
          uci.slice(2, 4) as Square,
        );
        setTimeline((current) => {
          const position = sessionAtNavigationCursor(current);
          if (
            position.fen !== requestFen ||
            position.history.length !== requestHistoryLength
          )
            return current;
          return replaceNavigationLine(applyEngineLine(position, uci));
        });
        setEngineState("ready");
        setEngineMessage(
          `Maia-3 5M local: respuesta aplicada ${uci} para Elo ${settings.opponentElo}.`,
        );
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError")
          return;
        if (generation.current !== currentGeneration) return;
        const detail = error instanceof Error ? error.message : String(error);
        setEngineState("error");
        setEngineMessage("Maia-3 no pudo completar su jugada.");
        setSessionError(`Maia-3 local no está disponible: ${detail}`);
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
    hasFuture,
    settings.opponentElo,
    started,
    maiaRetry,
  ]);

  useEffect(() => {
    const historyIndex = game.history.length - 1;
    const move = game.history[historyIndex];
    if (!started || historyIndex < 0 || !move) return;
    if (
      feedbackByPly.some(
        (entry) =>
          entry.historyIndex === historyIndex && entry.uci === move.uci,
      )
    )
      return;

    const after = game;
    const before = undoMove(after);
    const actor = lastMoveColor === playerColor ? "user" : "maia";

    // Maia's reply is already produced by the opponent engine. Running two
    // additional Stockfish searches for every Maia ply makes the serial coach
    // queue grow during a normal game, especially in the middlegame. The
    // feedback panel already has a neutral fallback when no record exists, so
    // reserve the expensive coaching analysis for the player's decisions.
    if (actor === "maia") return;

    const identity = {
      historyIndex,
      uci: move.uci,
      actor,
      beforeFen: before.fen,
      afterFen: after.fen,
    } as const;
    setFeedbackByPly((entries) => [
      ...entries.filter((entry) => entry.historyIndex !== historyIndex),
      { ...identity, status: "pending" },
    ]);
    setProvisionalMoveQuality(undefined);

    coachQueueRef.current?.enqueue(async (signal) => {
      const engine = (coachEngineRef.current ??=
        createBrowserStockfishEngine());
      const searchPlan = coachSearchPlan(settings.enginePreset);
      try {
        let beforeForProgress: AnalysisResult | undefined;
        let latestAfterProgress: AnalysisProgress | undefined;
        let lastAssessedDepth = 0;
        const publishProvisional = (progress: AnalysisProgress) => {
          if (progress.reset) {
            latestAfterProgress = undefined;
            lastAssessedDepth = 0;
            setProvisionalMoveQuality((current) =>
              current?.historyIndex === historyIndex && current.uci === move.uci
                ? undefined
                : current,
            );
            return;
          }
          latestAfterProgress = progress;
          if (
            signal.aborted ||
            progress.depth < MINIMUM_PROVISIONAL_QUALITY_DEPTH ||
            progress.depth <= lastAssessedDepth
          )
            return;
          const completedBefore = beforeForProgress;
          const beforeLine = completedBefore?.lines[0];
          const afterLine = progress.lines.find((line) => line.rank === 1);
          if (!completedBefore || !beforeLine || !afterLine) return;
          try {
            const assessment = assessTurn(
              before,
              after,
              beforeLine,
              afterLine,
              {
                actor,
                helpLevel: settings.helpLevel,
                perspective: playerColor,
                beforeLines: completedBefore.lines,
                afterLines: progress.lines,
                requireCompleteVariations: true,
              },
            );
            if (!assessment || signal.aborted) return;
            lastAssessedDepth = progress.depth;
            setProvisionalMoveQuality((current) =>
              updateProvisionalMoveQuality(current, {
                historyIndex,
                uci: move.uci,
                label: assessment.label,
                depth: progress.depth,
              }),
            );
          } catch {
            // Early UCI lines are untrusted and may contain an incomplete PV.
            // The final validated analysis remains authoritative.
          }
        };
        const beforePromise = coachAnalysisCache
          .analyze(
            engine,
            {
              id: `coach-${actor}-before-${historyIndex}`,
              fen: before.fen,
              perspective: playerColor,
              preset: settings.enginePreset,
              multiPv: searchPlan.beforeMultiPv,
              limit: searchPlan.limit,
            },
            signal,
          )
          .then((result) => {
            beforeForProgress = result;
            if (latestAfterProgress) publishProvisional(latestAfterProgress);
            return result;
          });
        const afterPromise = coachAnalysisCache.analyze(
          engine,
          {
            id: `coach-${actor}-after-${historyIndex}`,
            fen: after.fen,
            perspective: playerColor,
            preset: settings.enginePreset,
            multiPv: searchPlan.afterMultiPv,
            limit: searchPlan.limit,
          },
          signal,
          publishProvisional,
        );
        const [beforeResult, afterResult] = await Promise.all([
          beforePromise,
          afterPromise,
        ]);
        const beforeLine = beforeResult.lines[0];
        const afterLine = afterResult.lines[0];
        if (!beforeLine || !afterLine) throw new Error("Missing analysis line");
        const record = analyzeTurn(before, after, beforeLine, afterLine, {
          actor,
          helpLevel: settings.helpLevel,
          perspective: playerColor,
          beforeLines: beforeResult.lines,
          afterLines: afterResult.lines,
        });
        if (signal.aborted) return;
        setFeedbackByPly((entries) =>
          entries.map((entry) =>
            entry.historyIndex === historyIndex &&
            entry.uci === move.uci &&
            entry.beforeFen === before.fen &&
            entry.afterFen === after.fen
              ? { ...identity, status: "ready", record }
              : entry,
          ),
        );
        if (actor === "user") {
          const assessment = record.assessment;
          if (assessment) {
            setMoveAnnotations((annotations) => [
              ...annotations.filter(
                (annotation) => annotation.historyIndex !== historyIndex,
              ),
              {
                historyIndex,
                uci: move.uci,
                label: assessment.label,
              },
            ]);
          }
        }
        setProvisionalMoveQuality((current) =>
          current?.historyIndex === historyIndex && current.uci === move.uci
            ? undefined
            : current,
        );
      } catch (error) {
        if (
          signal.aborted ||
          (error instanceof DOMException && error.name === "AbortError")
        )
          return;
        setProvisionalMoveQuality((current) =>
          current?.historyIndex === historyIndex && current.uci === move.uci
            ? undefined
            : current,
        );
        setFeedbackByPly((entries) =>
          entries.map((entry) =>
            entry.historyIndex === historyIndex && entry.uci === move.uci
              ? { ...identity, status: "unavailable" }
              : entry,
          ),
        );
      }
    });
  }, [
    feedbackByPly,
    game,
    lastMoveColor,
    playerColor,
    settings.enginePreset,
    settings.helpLevel,
    started,
  ]);

  useEffect(() => {
    if (!started) return;
    const handleHistoryShortcut = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        isEditableKeyboardTarget(event.target) ||
        (event.key !== "ArrowLeft" &&
          event.key !== "ArrowRight" &&
          event.key !== "Enter")
      )
        return;
      if (
        event.key === "Enter" &&
        event.target instanceof HTMLElement &&
        event.target.closest(
          "button, summary, label, input, select, textarea, a[href]",
        )
      )
        return;
      if (event.key === "Enter" && !hasFuture) return;
      event.preventDefault();
      if (event.key === "ArrowLeft") undoShortcut.current();
      else if (event.key === "ArrowRight") redoShortcut.current();
      else continueShortcut.current();
    };
    window.addEventListener("keydown", handleHistoryShortcut);
    return () => window.removeEventListener("keydown", handleHistoryShortcut);
  }, [hasFuture, started]);

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
          cancelCoachPrewarms();
          setProvisionalMoveQuality(undefined);
          coachQueueRef.current?.invalidate();
          generation.current += 1;
          clearStoredGame();
          setSettings(resolvedSettings);
          setTimeline(replaceNavigationLine(initialSnapshot));
          setMoveAnnotations([]);
          setFeedbackByPly([]);
          setFeedback(undefined);
          setRecoverySnapshot(undefined);
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
      setProvisionalMoveQuality(undefined);
      setFeedback(undefined);
      setFeedbackByPly((records) =>
        records.filter((record) => record.historyIndex < game.history.length),
      );
      beginMoveAnimation(game, selected, square);
      setMoveAnnotations((items) =>
        items.filter((item) => item.historyIndex < game.history.length),
      );
      setTimeline(replaceNavigationLine(playMove(game, selected, square)));
      setSelected(undefined);
      return;
    }
    setSelected(board.get(square)?.color === game.turn ? square : undefined);
  };

  const reset = () => {
    cancelCoachPrewarms();
    setProvisionalMoveQuality(undefined);
    coachQueueRef.current?.invalidate();
    generation.current += 1;
    const initialGame = createLocalGame(initialSnapshot);
    previousHistoryLength.current = initialGame.history.length;
    setTimeline(replaceNavigationLine(initialGame));
    setMoveAnnotations([]);
    setFeedbackByPly([]);
    setRecoverySnapshot(undefined);
    setSelected(undefined);
    setPaused(false);
    setSessionError(undefined);
    setFeedback(undefined);
    setEngineState("idle");
    setMoveAnimation(undefined);
    setEngineMessage("Maia-3 5M está disponible como oponente local.");
  };

  const retryMaia = () => {
    generation.current += 1;
    // A disposed client cannot be revived. Drop it so the next effect creates
    // a fresh client while preserving the current board and move history.
    disposeEngineRef(engineRef);
    setSelected(undefined);
    setSessionError(undefined);
    setEngineState("idle");
    setEngineMessage("Reintentando la jugada de Maia-3…");
    setMaiaRetry((attempt) => attempt + 1);
  };

  const undo = () => {
    if (game.history.length === 0) return;
    cancelCoachPrewarms();
    setProvisionalMoveQuality(undefined);
    coachQueueRef.current?.invalidate();
    setFeedbackByPly((items) =>
      items.filter((item) => item.status !== "pending"),
    );
    generation.current += 1;
    const restored = undoMove(game);
    setTimeline(moveNavigationCursor(timeline, timeline.cursor - 1));
    setFeedback(
      feedbackByPly.find(
        (record) => record.historyIndex === restored.history.length - 1,
      )?.record,
    );
    setSelected(undefined);
    setPaused(true);
    setSessionError(undefined);
    setEngineState("idle");
    setMoveAnimation(undefined);
    setEngineMessage("Maia-3 5M está disponible como oponente local.");
  };

  const redo = () => {
    if (!hasFuture) return;
    cancelCoachPrewarms();
    setProvisionalMoveQuality(undefined);
    coachQueueRef.current?.invalidate();
    setFeedbackByPly((items) =>
      items.filter((item) => item.status !== "pending"),
    );
    generation.current += 1;
    const nextCursor = timeline.cursor + 1;
    previousHistoryLength.current = nextCursor;
    setTimeline(moveNavigationCursor(timeline, nextCursor));
    setFeedback(
      feedbackByPly.find((record) => record.historyIndex === nextCursor - 1)
        ?.record,
    );
    setSelected(undefined);
    setPaused(nextCursor < timeline.session.history.length);
    setSessionError(undefined);
    setEngineState("idle");
    setMoveAnimation(undefined);
    setEngineMessage("Maia-3 5M está disponible como oponente local.");
  };

  undoShortcut.current = undo;
  redoShortcut.current = redo;

  const togglePaused = () => {
    if (paused && hasFuture) return;
    if (!paused) {
      cancelCoachPrewarms();
      setProvisionalMoveQuality(undefined);
      generation.current += 1;
      setEngineState("idle");
      setEngineMessage(
        "Partida pausada. La respuesta pendiente fue cancelada.",
      );
    }
    setPaused((value) => !value);
  };

  const abandon = () => {
    if (!window.confirm("¿Abandonar esta partida y borrar su guardado local?"))
      return;
    cancelCoachPrewarms();
    setProvisionalMoveQuality(undefined);
    coachQueueRef.current?.invalidate();
    generation.current += 1;
    clearStoredGame();
    setHasSavedGame(false);
    setStarted(false);
    setPaused(false);
    setMoveAnnotations([]);
    setFeedbackByPly([]);
    setFeedback(undefined);
    setRecoverySnapshot(undefined);
    setMoveAnimation(undefined);
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
      cancelCoachPrewarms();
      setProvisionalMoveQuality(undefined);
      coachQueueRef.current?.invalidate();
      generation.current += 1;
      const importedGame = createLocalGame(imported);
      previousHistoryLength.current = importedGame.history.length;
      setTimeline(replaceNavigationLine(importedGame));
      setMoveAnnotations([]);
      setFeedbackByPly([]);
      setRecoverySnapshot(undefined);
      setSelected(undefined);
      setPaused(false);
      setSessionError(undefined);
      setFeedback(undefined);
      setEngineState("idle");
      setMoveAnimation(undefined);
      setEngineMessage("PGN importado. La partida puede continuar.");
    } catch {
      setSessionError("El archivo no contiene un PGN válido o legal.");
    }
  };

  const selectHistoryPly = (cursor: number) => {
    if (cursor < 0 || cursor > timeline.session.history.length) return;
    cancelCoachPrewarms();
    setProvisionalMoveQuality(undefined);
    coachQueueRef.current?.invalidate();
    setFeedbackByPly((items) =>
      items.filter((item) => item.status !== "pending"),
    );
    generation.current += 1;
    setTimeline(moveNavigationCursor(timeline, cursor));
    setSelected(undefined);
    setPaused(cursor < timeline.session.history.length);
    setFeedback(
      feedbackByPly.find((record) => record.historyIndex === cursor - 1)
        ?.record,
    );
    setEngineState("idle");
    setEngineMessage(
      cursor < timeline.session.history.length
        ? "Vista histórica: el tablero está en pausa."
        : "Maia-3 5M está disponible como oponente local.",
    );
  };

  const continueFromHere = () => {
    if (!hasFuture) return;
    const checkpoint: RecoverySnapshot = {
      session: timeline.session,
      cursor: timeline.cursor,
      annotations: moveAnnotations,
      feedbackByPly,
    };
    cancelCoachPrewarms();
    setProvisionalMoveQuality(undefined);
    coachQueueRef.current?.invalidate();
    generation.current += 1;
    setRecoverySnapshot(checkpoint);
    setTimeline(continueNavigationFromCursor(timeline));
    setMoveAnnotations((items) =>
      items.filter((item) => item.historyIndex < game.history.length),
    );
    setFeedbackByPly((items) =>
      items.filter((item) => item.historyIndex < game.history.length),
    );
    setSelected(undefined);
    setEngineState("idle");
    setPaused(false);
    setEngineMessage("Continuación creada desde la posición seleccionada.");
  };

  const recoverPreviousBranch = () => {
    if (!recoverySnapshot) return;
    cancelCoachPrewarms();
    setProvisionalMoveQuality(undefined);
    coachQueueRef.current?.invalidate();
    generation.current += 1;
    previousHistoryLength.current = recoverySnapshot.cursor;
    setTimeline(
      createNavigationTimeline(
        recoverySnapshot.session,
        recoverySnapshot.cursor,
      ),
    );
    setMoveAnnotations(recoverySnapshot.annotations);
    setFeedbackByPly(recoverySnapshot.feedbackByPly);
    setFeedback(
      recoverySnapshot.feedbackByPly.find(
        (record) => record.historyIndex === recoverySnapshot.cursor - 1,
      )?.record,
    );
    setRecoverySnapshot(undefined);
    setSelected(undefined);
    setPaused(
      recoverySnapshot.cursor < recoverySnapshot.session.history.length,
    );
    setSessionError(undefined);
    setEngineState("idle");
    setMoveAnimation(undefined);
    setEngineMessage("Rama anterior recuperada. Puedes continuar desde aquí.");
  };

  continueShortcut.current = continueFromHere;

  const retryAlternative = () => {
    const record = adviceEntry?.record;
    if (
      !record ||
      record.turn.actor !== "user" ||
      game.history.length !== record.turn.ply
    )
      return;
    const before = undoMove(game);
    cancelCoachPrewarms();
    setProvisionalMoveQuality(undefined);
    coachQueueRef.current?.invalidate();
    generation.current += 1;
    setLineVisiblePly(undefined);
    setTimeline(moveNavigationCursor(timeline, before.history.length));
    setPaused(false);
    setEngineState("idle");
    setEngineMessage("Encuentra una alternativa y comprueba tu idea.");
  };

  const renderHistoryPly = (
    ply: HistoryPly | undefined,
    moveNumber: number,
  ) => {
    if (!ply) return <span className="move-slot-empty" aria-hidden="true" />;
    const analysis = feedbackByHistoryIndex.get(ply.historyIndex);
    const evaluation =
      analysis?.status === "unavailable"
        ? "—"
        : formatEvaluation(analysis?.record?.evidence.after.score);
    const annotation = annotationByHistoryIndex.get(ply.historyIndex);
    const quality =
      ply.color === playerColor && annotation
        ? `${annotation.provisional ? "valoración provisional, " : ""}${qualityMeta[annotation.label].label}`
        : undefined;
    const displayedMove = ply.display;
    return (
      <button
        type="button"
        className="move-entry san-button"
        aria-current={
          game.history.length === ply.historyIndex + 1 ? "step" : undefined
        }
        aria-label={`Jugada ${moveNumber} de ${colorName(ply.color)}, ${displayedMove}${settings.showEvaluation ? `, evaluación ${evaluation}` : ""}${quality ? `, ${quality}` : ""}`}
        onClick={() => selectHistoryPly(ply.historyIndex + 1)}
      >
        <span>{displayedMove}</span>
        {settings.showEvaluation ? (
          <small className="move-evaluation" aria-hidden="true">
            {evaluation}
          </small>
        ) : null}
        {ply.color === playerColor && annotation ? (
          <QualityBadge
            label={annotation.label}
            provisional={annotation.provisional === true}
          />
        ) : null}
      </button>
    );
  };

  return (
    <main className="shell">
      {positionNotice ? (
        <div
          className={`position-notice position-notice-${positionNotice.kind}`}
          role="alert"
          aria-live="assertive"
        >
          <span className="position-notice-icon" aria-hidden="true">
            {positionNotice.kind === "checkmate" ? "♛" : "!"}
          </span>
          <span>
            <strong>
              {positionNotice.kind === "checkmate" ? "¡Jaque mate!" : "¡Jaque!"}
            </strong>
            <small>
              El rey de {colorName(positionNotice.checkedColor)} está en{" "}
              {positionNotice.kind === "checkmate" ? "jaque mate" : "jaque"}.
            </small>
          </span>
        </div>
      ) : null}
      <section className="game" aria-labelledby="page-title">
        <header className="game-header">
          <div className="game-heading">
            <p className="eyebrow">Partida local · Sin cuenta</p>
            <h1 id="page-title">Tablero de práctica</h1>
          </div>
          <p className="turn" aria-live="polite">
            <span className="turn-indicator" aria-hidden="true" />
            Turno de {colorName(game.turn)} · Tú juegas con{" "}
            {colorName(playerColor)}
          </p>
        </header>
        <div className="game-layout">
          <AdvicePanel
            feedbackEntry={adviceEntry}
            helpLevel={settings.helpLevel}
            lineVisible={lineVisiblePly === adviceEntry?.historyIndex}
            onToggleLine={() =>
              setLineVisiblePly((current) =>
                current === adviceEntry?.historyIndex
                  ? undefined
                  : adviceEntry?.historyIndex,
              )
            }
            onRetry={retryAlternative}
            selectedMaia={hasFuture && selectedFeedbackEntry?.actor === "maia"}
          />
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
              {visualBoardRows.map((row, rowIndex) => (
                <div role="row" key={row[0]}>
                  {row.map((square, columnIndex) => {
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
                        className={`square ${(file + rank) % 2 === 0 ? "light" : "dark"}${isSelected ? " selected" : ""}${isDestination ? " destination" : ""}`}
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
                          <span
                            className={
                              moveAnimation?.pieces.some(
                                (animated) => animated.to === square,
                              )
                                ? "piece-position piece-position-hidden"
                                : "piece-position"
                            }
                          >
                            <PieceIcon color={piece.color} type={piece.type} />
                          </span>
                        ) : null}
                        {squareQuality ? (
                          <QualityBadge
                            label={squareQuality.label}
                            provisional={squareQuality.provisional === true}
                          />
                        ) : null}
                        {columnIndex === 0 ? (
                          <small className="rank">{square[1]}</small>
                        ) : null}
                        {rowIndex === visualBoardRows.length - 1 ? (
                          <small className="file">{square[0]}</small>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              ))}
              {moveAnimation ? (
                <div className="piece-motion-layer" aria-hidden="true">
                  {moveAnimation.captured && moveAnimation.captureSquare ? (
                    <span
                      className="animated-piece captured-piece-ghost"
                      style={squareOffset(
                        moveAnimation.captureSquare,
                        playerColor,
                      )}
                    >
                      <PieceIcon
                        color={moveAnimation.captured.color}
                        type={moveAnimation.captured.type}
                      />
                    </span>
                  ) : null}
                  {moveAnimation.pieces.map((animated) => (
                    <span
                      className="animated-piece moving-piece"
                      key={`${animated.from}-${animated.to}`}
                      style={{
                        ...squareOffset(animated.from, playerColor),
                        ...visualMoveOffset(
                          animated.from,
                          animated.to,
                          playerColor,
                        ),
                      }}
                    >
                      <PieceIcon
                        color={animated.piece.color}
                        type={animated.piece.type}
                      />
                    </span>
                  ))}
                </div>
              ) : null}
              {settings.showArrows && lastMoveArrow ? (
                <svg
                  className={`move-arrow-overlay move-arrow-${lastMoveColor === playerColor ? "player" : "engine"}`}
                  viewBox="0 0 8 8"
                  preserveAspectRatio="none"
                  aria-hidden="true"
                >
                  <defs>
                    <marker
                      id="move-arrow-head-player"
                      markerWidth="0.42"
                      markerHeight="0.42"
                      markerUnits="userSpaceOnUse"
                      refX="0.9"
                      refY="0.5"
                      viewBox="0 0 1 1"
                      orient="auto"
                    >
                      <path d="M0 0L1 0.5L0 1Z" />
                    </marker>
                    <marker
                      id="move-arrow-head-engine"
                      markerWidth="0.42"
                      markerHeight="0.42"
                      markerUnits="userSpaceOnUse"
                      refX="0.9"
                      refY="0.5"
                      viewBox="0 0 1 1"
                      orient="auto"
                    >
                      <path d="M0 0L1 0.5L0 1Z" />
                    </marker>
                  </defs>
                  <line
                    x1={lastMoveArrow.x}
                    y1={lastMoveArrow.y}
                    x2={lastMoveArrow.to.x}
                    y2={lastMoveArrow.to.y}
                    markerEnd={`url(#move-arrow-head-${lastMoveColor === playerColor ? "player" : "engine"})`}
                  />
                </svg>
              ) : null}
            </div>
            {lastMove ? (
              <p className="last-move-note" aria-live="polite">
                Última jugada: <strong>{lastMoveDisplay}</strong> ·{" "}
                {lastMoveColor === playerColor ? "Tú" : "Maia-3"}
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
                label="Capturadas por Maia-3"
              />
            </div>
          </section>
          <aside className="side-panel" aria-label="Controles y movimientos">
            <section className="engine-status" aria-live="polite">
              <p className="label">
                Maia-3 5M local · Elo {settings.opponentElo}
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
            <div className="session-actions" aria-label="Acciones de partida">
              <div
                className="history-controls"
                aria-label="Navegación de jugadas"
              >
                <button
                  type="button"
                  className="history-arrow"
                  onClick={undo}
                  disabled={game.history.length === 0}
                  aria-label="Retroceder una jugada (Flecha izquierda)"
                  title="Retroceder una jugada (←)"
                >
                  ←
                </button>
                <button
                  type="button"
                  className="history-arrow"
                  onClick={redo}
                  disabled={!hasFuture}
                  aria-label="Avanzar una jugada (Flecha derecha)"
                  title="Avanzar una jugada (→)"
                >
                  →
                </button>
              </div>
              <button
                type="button"
                className="pause-button"
                onClick={togglePaused}
                disabled={paused && hasFuture}
              >
                {paused ? "Reanudar" : "Pausar"}
              </button>
              {hasFuture ? (
                <button
                  type="button"
                  data-shortcut="continue"
                  onClick={continueFromHere}
                >
                  Continuar desde aquí
                </button>
              ) : null}
              <details className="utility-menu">
                <summary aria-label="Abrir más acciones de partida">
                  <span aria-hidden="true">•••</span>
                  <span>Más</span>
                </summary>
                <div className="utility-menu-panel">
                  <p className="utility-menu-title">Opciones de partida</p>
                  <button type="button" onClick={reset}>
                    Reiniciar partida
                  </button>
                  {recoverySnapshot ? (
                    <button
                      type="button"
                      onClick={recoverPreviousBranch}
                      aria-label="Recuperar la rama anterior guardada"
                    >
                      Recuperar rama anterior
                    </button>
                  ) : null}
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
                  <div className="utility-menu-separator" />
                  <button
                    type="button"
                    className="danger-action"
                    onClick={abandon}
                  >
                    Abandonar partida
                  </button>
                </div>
              </details>
            </div>
            {sessionError ? (
              <div className="session-error" role="alert">
                <p>{sessionError}</p>
                {engineState === "error" ? (
                  <button type="button" onClick={retryMaia}>
                    Reintentar Maia-3
                  </button>
                ) : null}
              </div>
            ) : null}
            <section className="moves" aria-labelledby="moves-title">
              <div className="moves-heading">
                <h2 id="moves-title">Movimientos</h2>
                <span>{game.history.length}</span>
              </div>
              {historyGroups.length ? (
                <ol>
                  {historyGroups.map((group) => (
                    <li key={group.moveNumber}>
                      <span className="move-number">{group.moveNumber}.</span>
                      {renderHistoryPly(group.white, group.moveNumber)}
                      {renderHistoryPly(group.black, group.moveNumber)}
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
