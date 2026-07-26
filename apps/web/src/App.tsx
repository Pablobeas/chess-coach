import {
  createInitialGame,
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
import {
  createBrowserOpponentEngine,
  getSharedBrowserStockfishController,
} from "./opponentClient";
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
import { VariationHistory } from "./VariationHistory";
import {
  createNavigationTimeline,
  moveNavigationCursor,
  replaceNavigationLine,
  sessionAtNavigationCursor,
} from "./navigationTimeline";
import {
  activeSessionLine,
  createSessionWorkspace,
  createTrialLine,
  deleteSessionLine,
  navigateSessionLine,
  selectSessionLine,
  updateActiveSessionLine,
  type SessionWorkspace,
} from "./sessionWorkspace";
import {
  acceptsAnalysisResult,
  clearProvisionalForLineChange,
  createAnalysisRequestIdentity,
  exportSessionForWorkspace,
  syncActiveLineSession,
} from "./lineTransitions";
import {
  activateWaitingServiceWorker,
  getWaitingServiceWorker,
  PWA_UPDATE_EVENT,
  subscribeToVersionChecks,
} from "./pwaUpdate";

const initialSnapshot = createInitialGame();
type EngineState = "idle" | "thinking" | "ready" | "error";
type PositionNotice = {
  readonly kind: "check" | "checkmate";
  readonly checkedColor: PlayerColor;
};
export type GameTurnStatusView = {
  readonly text: string;
  readonly details: string;
  readonly boardLabel: string;
  readonly terminal: boolean;
};
const colorName = (color: PlayerColor) =>
  color === "white" ? "blancas" : "negras";
const oppositeColor = (color: PlayerColor): PlayerColor =>
  color === "white" ? "black" : "white";

export function describeGameTurnStatus(
  game: Pick<GameSession, "isGameOver" | "isCheckmate" | "turn">,
  playerColor: PlayerColor,
): GameTurnStatusView {
  const playerSummary = `Tú juegas con ${colorName(playerColor)}`;
  if (game.isCheckmate) {
    const winner = colorName(oppositeColor(game.turn));
    return {
      text: "Jaque mate",
      details: `Ganan ${winner} · ${playerSummary}`,
      boardLabel: `jaque mate, ganan ${winner}`,
      terminal: true,
    };
  }
  if (game.isGameOver) {
    return {
      text: "Tablas",
      details: `Empate · ${playerSummary}`,
      boardLabel: "tablas, empate",
      terminal: true,
    };
  }
  const sideToMove = colorName(game.turn);
  return {
    text: `Turno de ${sideToMove}`,
    details: playerSummary,
    boardLabel: `turno de ${sideToMove}`,
    terminal: false,
  };
}

export function workspaceTransitionNotice(
  previous: SessionWorkspace,
  next: SessionWorkspace,
): string {
  if (next.mainLineId !== previous.mainLineId)
    return "La variante se promovió a principal.";
  if (next.activeLineId !== previous.activeLineId && next.lines.length <= previous.lines.length)
    return "La continuación se fusionó con una variante existente.";
  if (next.lines.length < previous.lines.length)
    return "Se eliminó automáticamente la variante más antigua.";
  return "";
}

export function canPlayBoard(
  manuallyPaused: boolean,
  engineThinking: boolean,
  sideToMove: PlayerColor,
  playerColor: PlayerColor,
): boolean {
  return !manuallyPaused && !engineThinking && sideToMove === playerColor;
}

export function GameTurnStatus({
  status,
}: {
  readonly status: GameTurnStatusView;
}) {
  return (
    <p className="turn" role="status" aria-live="polite" aria-atomic="true">
      {status.terminal ? null : (
        <span className="turn-indicator" aria-hidden="true" />
      )}
      {status.text} · {status.details}
    </p>
  );
}

const isDesktopLocalhost = () =>
  typeof window !== "undefined" &&
  ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname);
export const opponentNameForBackend = (backend?: string) =>
  backend === "maia3-local" || (backend === undefined && isDesktopLocalhost())
    ? "Maia-3 local"
    : "Stockfish local";
export const browserOpponentModeForBuild = (isProduction: boolean) =>
  isProduction ? ("hosted" as const) : ("auto" as const);
export const browserOpponentMode = () =>
  browserOpponentModeForBuild(import.meta.env.PROD);
export const initialOpponentNameForMode = (mode = browserOpponentMode()) =>
  mode === "hosted" ? "Stockfish local" : "Maia-3 local";
export function readCurrentBuildId(
  documentRef: Document = document,
): string | undefined {
  const value = documentRef
    .querySelector('meta[name="chess-coach-build-id"]')
    ?.getAttribute("content");
  return value && value !== "__CHESS_COACH_BUILD_ID__" ? value : undefined;
}
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
}: {
  readonly feedbackEntry: MoveFeedbackRecord | undefined;
  readonly helpLevel: GameSettings["helpLevel"];
  readonly selectedMaia: boolean;
  readonly lineVisible: boolean;
  readonly onToggleLine: () => void;
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
                {lineVisible ? "Ocultar variante" : "Ver variante"}
              </button>
            ) : null}
          </div>
          {lineVisible && displayedLine.length ? (
            <ol
              className="feedback-line"
              aria-label="Variante recomendada verificada"
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
  readonly workspace: SessionWorkspace;
  readonly settings: GameSettings;
} | null {
  if (typeof window === "undefined") return null;
  const stored = loadStoredGame(window.localStorage);
  if (!stored) return null;
  try {
    return {
      workspace: {
        ...stored.workspace,
        lines: stored.workspace.lines.map((line) => ({
          ...line,
          timeline: {
            ...line.timeline,
            session: restoreSession(line.timeline.session),
          },
        })),
      },
      settings: stored.settings,
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
  const [workspace, setWorkspace] = useState<SessionWorkspace>(
    () => recovered?.workspace ?? createSessionWorkspace(initialSnapshot),
  );
  const activeLine = activeSessionLine(workspace);
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;
  const timeline = activeLine.timeline;
  const moveAnnotations = activeLine.annotations;
  const feedbackByPly = activeLine.feedbackByPly;
  const setTimeline = (
    update: typeof timeline | ((current: typeof timeline) => typeof timeline),
  ) =>
    setWorkspace((current) =>
      updateActiveSessionLine(current, (line) => ({
        ...line,
        timeline: typeof update === "function" ? update(line.timeline) : update,
      })),
    );
  const setMoveAnnotations = (
    update:
      | readonly MoveQualityAnnotation[]
      | ((
          current: readonly MoveQualityAnnotation[],
        ) => readonly MoveQualityAnnotation[]),
  ) =>
    setWorkspace((current) =>
      updateActiveSessionLine(current, (line) => ({
        ...line,
        annotations:
          typeof update === "function" ? update(line.annotations) : update,
      })),
    );
  const setFeedbackByPly = (
    update:
      | readonly MoveFeedbackRecord[]
      | ((
          current: readonly MoveFeedbackRecord[],
        ) => readonly MoveFeedbackRecord[]),
  ) =>
    setWorkspace((current) =>
      updateActiveSessionLine(current, (line) => ({
        ...line,
        feedbackByPly:
          typeof update === "function" ? update(line.feedbackByPly) : update,
      })),
    );
  const [provisionalMoveQuality, setProvisionalMoveQuality] = useState<
    ProvisionalMoveQualityAnnotation | undefined
  >();
  const [feedback, setFeedback] = useState<CoachTurnRecord | undefined>(
    () =>
      recovered?.workspace.lines
        .find((line) => line.id === recovered.workspace.activeLineId)
        ?.feedbackByPly.find(
          (record) => record.historyIndex === activeLine.timeline.cursor - 1,
        )?.record,
  );
  const [positionNotice, setPositionNotice] = useState<PositionNotice>();
  const [selected, setSelected] = useState<Square>();
  const [lineVisiblePly, setLineVisiblePly] = useState<number>();
  const [workspaceContextNotice, setWorkspaceContextNotice] = useState("");
  const [engineState, setEngineState] = useState<EngineState>("idle");
  const [paused, setPaused] = useState(false);
  const [sessionError, setSessionError] = useState<string>();
  const [opponentName, setOpponentName] = useState(initialOpponentNameForMode);
  const [engineMessage, setEngineMessage] = useState(
    () =>
      `${initialOpponentNameForMode()} está disponible como oponente local.`,
  );
  const [opponentRetry, setOpponentRetry] = useState(0);
  const [enginePreparation, setEnginePreparation] = useState<
    "preparing" | "ready" | "unavailable"
  >("preparing");
  const [waitingServiceWorker, setWaitingServiceWorker] =
    useState<ServiceWorkerRegistration>();
  const [buildId] = useState(readCurrentBuildId);
  const generation = useRef(0);
  const coachRequestSequence = useRef(0);
  const activeCoachRequestId = useRef<string | undefined>(undefined);
  const game = useMemo(
    () => createLocalGame(sessionAtNavigationCursor(timeline)),
    [timeline],
  );
  const hasFuture = timeline.cursor < timeline.session.history.length;
  const isBrowsingHistory = hasFuture;
  const previousHistoryLength = useRef(game.history.length);
  const engineRef = useRef<OpponentEngine | null>(null);
  const stockfishControllerRef = useRef(getSharedBrowserStockfishController());
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
  const cancelCoachPrewarms = () => {
    for (const controller of coachPrewarmControllersRef.current)
      controller.abort();
    coachPrewarmControllersRef.current.clear();
  };
  const playerColor: PlayerColor =
    settings.playerColor === "random" ? "white" : settings.playerColor;
  const engineColor: PlayerColor = playerColor === "white" ? "black" : "white";
  const gameTurnStatus = describeGameTurnStatus(game, playerColor);
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
  const feedbackByHistoryIndex = useMemo(
    () => new Map(feedbackByPly.map((entry) => [entry.historyIndex, entry])),
    [feedbackByPly],
  );
  const lastMoveDisplay = lastMove?.san;
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
    saveStoredGame(workspace, settings, window.localStorage);
  }, [workspace, settings, started]);

  useEffect(() => {
    const abortController = new AbortController();
    setEnginePreparation("preparing");
    // The singleton controller is shared by analysis and the browser opponent;
    // setup remains usable while its Worker initializes in the background.
    void stockfishControllerRef.current
      .prewarm(abortController.signal)
      .then(() => {
        if (!abortController.signal.aborted) setEnginePreparation("ready");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError")
          return;
        if (!abortController.signal.aborted)
          setEnginePreparation("unavailable");
      });
    return () => abortController.abort();
  }, []);

  useEffect(() => {
    const onUpdateReady = (event: Event) => {
      const registration = (event as CustomEvent<ServiceWorkerRegistration>)
        .detail;
      if (registration?.waiting) setWaitingServiceWorker(registration);
    };
    window.addEventListener(PWA_UPDATE_EVENT, onUpdateReady);
    void getWaitingServiceWorker()
      .then((registration) => {
        if (registration) setWaitingServiceWorker(registration);
      })
      .catch(() => undefined);
    return () => window.removeEventListener(PWA_UPDATE_EVENT, onUpdateReady);
  }, []);

  useEffect(() => {
    // version.json is only a freshness hint; never issue it while offline.
    return subscribeToVersionChecks(navigator);
  }, []);

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
      isBrowsingHistory ||
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
    isBrowsingHistory,
    paused,
    playerColor,
    settings.enginePreset,
    started,
  ]);

  useEffect(() => {
    if (!started || paused || isBrowsingHistory || game.turn !== engineColor) return;
    const engineMayStart = game.history.length === 0 && engineColor === "white";
    if (game.history.length === 0 && !engineMayStart) return;
    const controller = new AbortController();
    const currentGeneration = ++generation.current;
    const requestFen = game.fen;
    const requestPosition = game;
    const requestHistoryLength = game.history.length;
    const requestLineId = activeLine.id;
    const requestId = `opponent-${currentGeneration}-${requestHistoryLength}`;
    setEngineState("thinking");
    setSessionError(undefined);
    setEngineMessage(
      enginePreparation === "ready"
        ? `${opponentName} está calculando su respuesta.`
        : "Preparando el motor local…",
    );
    const engine = (engineRef.current ??= createBrowserOpponentEngine({
      mode: browserOpponentMode(),
    }));

    void stockfishControllerRef.current
      .ready(controller.signal)
      .then(() =>
        engine.chooseMove(
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
        ),
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
        setWorkspace((current) => {
          const line = activeSessionLine(current);
          const position = sessionAtNavigationCursor(line.timeline);
          if (
            line.id !== requestLineId ||
            position.fen !== requestFen ||
            position.history.length !== requestHistoryLength
          )
            return current;
          const next = syncActiveLineSession(current, applyEngineLine(position, uci));
          setWorkspaceContextNotice(workspaceTransitionNotice(current, next));
          return next;
        });
        setEngineState("ready");
        const resolvedName = opponentNameForBackend(engine.getStatus().backend);
        setOpponentName(resolvedName);
        setEngineMessage(
          `${resolvedName}: respuesta aplicada ${uci}; fuerza aproximada ${settings.opponentElo}.`,
        );
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError")
          return;
        if (generation.current !== currentGeneration) return;
        const detail = error instanceof Error ? error.message : String(error);
        setEngineState("error");
        setEngineMessage(`${opponentName} no pudo completar su jugada.`);
        setSessionError(`${opponentName} no está disponible: ${detail}`);
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
    isBrowsingHistory,
    settings.opponentElo,
    started,
    enginePreparation,
    opponentName,
    opponentRetry,
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
    const analysisIdentity = createAnalysisRequestIdentity(
      workspace,
      `coach-${historyIndex}-${move.uci}-${++coachRequestSequence.current}`,
    );
    activeCoachRequestId.current = analysisIdentity.requestId;
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
        if (
          activeCoachRequestId.current !== analysisIdentity.requestId ||
          !acceptsAnalysisResult(
            workspaceRef.current,
            analysisIdentity,
            analysisIdentity.requestId,
          )
        )
          return;
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
        if (
          activeCoachRequestId.current !== analysisIdentity.requestId ||
          !acceptsAnalysisResult(
            workspaceRef.current,
            analysisIdentity,
            analysisIdentity.requestId,
          )
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
      event.preventDefault();
      if (event.key === "ArrowLeft") undoShortcut.current();
      else if (event.key === "ArrowRight") redoShortcut.current();
    };
    window.addEventListener("keydown", handleHistoryShortcut);
    return () => window.removeEventListener("keydown", handleHistoryShortcut);
  }, [started]);

  if (!started) {
    return (
      <GameSetup
        initialSettings={settings}
        hasSavedGame={hasSavedGame}
        opponentName={opponentName}
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
          setWorkspace(createSessionWorkspace(initialSnapshot));
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
    if (!canPlayBoard(paused, engineState === "thinking", game.turn, playerColor))
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
      const nextSession = playMove(game, selected, square);
      cancelCoachPrewarms();
      coachQueueRef.current?.invalidate();
      generation.current += 1;
      setWorkspace((current) => {
        // A move from a historical cursor is always a candidate. This remains
        // true for an identical UCI move so the opponent is recalculated.
        const source = activeSessionLine(current);
        const forked = source.timeline.cursor < source.timeline.session.history.length
          ? createTrialLine(current, `variation-${Date.now()}`)
          : current;
        const next = syncActiveLineSession(forked, nextSession);
        const notice = workspaceTransitionNotice(forked, next);
        setWorkspaceContextNotice(
          notice ||
            (forked !== current && forked.lines.length <= current.lines.length
              ? "Se eliminó automáticamente la variante más antigua."
              : ""),
        );
        return next;
      });
      if (isBrowsingHistory) setWorkspaceContextNotice("Se creó una variante desde el historial.");
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
    setSelected(undefined);
    setPaused(false);
    setSessionError(undefined);
    setFeedback(undefined);
    setEngineState("idle");
    setMoveAnimation(undefined);
    setEngineMessage(`${opponentName} está disponible como oponente local.`);
  };

  const retryOpponent = () => {
    generation.current += 1;
    // A disposed client cannot be revived. Drop it so the next effect creates
    // a fresh client while preserving the current board and move history.
    disposeEngineRef(engineRef);
    setSelected(undefined);
    setSessionError(undefined);
    setEngineState("idle");
    setEngineMessage(`Reintentando la jugada de ${opponentName}…`);
    setOpponentRetry((attempt) => attempt + 1);
  };

  const installWaitingUpdate = () => {
    if (!waitingServiceWorker) return;
    // Persist immediately: the reload is explicitly requested by the player,
    // never triggered by an update arriving mid-game.
    activateWaitingServiceWorker(waitingServiceWorker, () =>
      saveStoredGame(workspaceRef.current, settings, window.localStorage),
    );
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
    setSessionError(undefined);
    setEngineState("idle");
    setMoveAnimation(undefined);
    setEngineMessage(`${opponentName} está disponible como oponente local.`);
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
    setSessionError(undefined);
    setEngineState("idle");
    setMoveAnimation(undefined);
    setEngineMessage(`${opponentName} está disponible como oponente local.`);
  };

  undoShortcut.current = undo;
  redoShortcut.current = redo;

  const togglePaused = () => {
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
    setWorkspace(createSessionWorkspace(initialSnapshot));
    setHasSavedGame(false);
    setStarted(false);
    setPaused(false);
    setMoveAnnotations([]);
    setFeedbackByPly([]);
    setFeedback(undefined);
    setMoveAnimation(undefined);
  };

  const downloadPgn = () => {
    const blob = new Blob([exportPgn(exportSessionForWorkspace(workspace))], {
      type: "application/x-chess-pgn",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "chess-coach-partida.pgn";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const applyWorkspaceLineChange = (nextWorkspace: SessionWorkspace) => {
    const nextLine = activeSessionLine(nextWorkspace);
    cancelCoachPrewarms();
    coachQueueRef.current?.invalidate();
    generation.current += 1;
    setProvisionalMoveQuality(clearProvisionalForLineChange());
    setWorkspace(nextWorkspace);
    setFeedback(
      nextLine.feedbackByPly.find(
        (entry) => entry.historyIndex === nextLine.timeline.cursor - 1,
      )?.record,
    );
    setSelected(undefined);
    setSessionError(undefined);
    setEngineState("idle");
    setMoveAnimation(undefined);
    setEngineMessage(`${opponentName} está disponible como oponente local.`);
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

  const selectWorkspaceLine = (lineId: string, cursor: number) => {
    applyWorkspaceLineChange(
      navigateSessionLine(selectSessionLine(workspace, lineId), cursor),
    );
    setWorkspaceContextNotice("Ruta activa actualizada.");
  };

  const deleteWorkspaceLine = (lineId: string) => {
    applyWorkspaceLineChange(deleteSessionLine(workspace, lineId));
    setWorkspaceContextNotice("La variante se eliminó.");
  };

  return (
    <main className="shell">
      {waitingServiceWorker ? (
        <aside className="pwa-update" role="status" aria-live="polite">
          <span>Nueva versión lista.</span>
          <button type="button" onClick={installWaitingUpdate}>
            Actualizar
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => setWaitingServiceWorker(undefined)}
          >
            Ahora no
          </button>
        </aside>
      ) : null}
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
            {buildId ? (
              <small
                className="build-version"
                aria-label={`Versión ${buildId}`}
              >
                v{buildId}
              </small>
            ) : null}
          </div>
          <GameTurnStatus status={gameTurnStatus} />
        </header>
        <p className="visually-hidden" role="status" aria-atomic="true">
          {workspaceContextNotice}
        </p>
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
              aria-label={`Tablero: ${gameTurnStatus.boardLabel}`}
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
                          !canPlayBoard(
                            paused,
                            engineState === "thinking",
                            game.turn,
                            playerColor,
                          )
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
                {lastMoveColor === playerColor ? "Tú" : opponentName}
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
                label={`Capturadas por ${opponentName}`}
              />
            </div>
          </section>
          <aside className="side-panel" aria-label="Controles y movimientos">
            <section className="engine-status" aria-live="polite">
              <p className="label">
                {opponentName} · Fuerza aproximada {settings.opponentElo}
              </p>
              <strong data-state={engineState}>
                {engineState === "thinking"
                  ? "Analizando"
                  : engineState === "ready"
                    ? "Listo"
                    : engineState === "error"
                      ? "No disponible"
                      : enginePreparation === "preparing"
                        ? "Preparando"
                        : enginePreparation === "unavailable"
                          ? "No disponible"
                          : "Listo"}
              </strong>
              <p>{engineMessage}</p>
            </section>
            <VariationHistory
              workspace={workspace}
              onSelect={selectWorkspaceLine}
              onDelete={deleteWorkspaceLine}
            />
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
              >
                {paused ? "Reanudar" : "Pausar"}
              </button>
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
                  <button type="button" onClick={retryOpponent}>
                    Reintentar rival local
                  </button>
                ) : null}
              </div>
            ) : null}
          </aside>
        </div>
      </section>
    </main>
  );
}
