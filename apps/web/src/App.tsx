import {
  createInitialGame,
  formatMoveSequence,
  loadPgn,
  listCaptures,
  replayHistory,
  restoreSession,
  sessionAtPly,
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
import { PostgameReviewScreen } from "./PostgameReviewScreen";
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
  opponentLastMoveHighlight,
  opponentMoveSquareAccessibilityLabel,
  opponentMoveSquareRole,
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
  createPostgameReviewStateV1,
  isPostgameReviewPendingForMove,
  listPostgameReviewTasks,
  markPostgameReviewUnavailable,
  mergePostgameReviewEvidence,
  postgameEvidenceFromAnalysis,
  seedPostgameReviewFromFeedback,
} from "./postgameReview";
import {
  acceptsAnalysisResult,
  clearProvisionalForLineChange,
  createAnalysisRequestIdentity,
  exportSessionForWorkspace,
  syncActiveLineSession,
  type AnalysisRequestIdentity,
} from "./lineTransitions";
import {
  activateWaitingServiceWorker,
  getWaitingServiceWorker,
  PWA_UPDATE_EVENT,
  subscribeToVersionChecks,
} from "./pwaUpdate";

const initialSnapshot = createInitialGame();
type EngineState = "idle" | "thinking" | "ready" | "error";
const COACH_SLOW_THRESHOLD_MS = 4_000;
export const COACH_DEADLINE_MS = 18_000;
export type CoachFailureStage =
  "before" | "after" | "analyzeTurn" | "acceptance";
export type CoachFailureAction =
  "auto-retry" | "wait-for-player-turn" | "unavailable" | "stale";

const FEN_IN_ERROR_MESSAGE =
  /\b(?:[prnbqkPRNBQK1-8]+\/){7}[prnbqkPRNBQK1-8]+\s[wb]\s(?:-|[KQkq]+)\s(?:-|[a-h][36])\s\d+\s\d+\b/;
const SAFE_COACH_ERROR_NAMES = new Set([
  "AbortError",
  "Error",
  "EngineUnavailableError",
  "EngineBootstrapError",
  "InvalidAnalysisRequestError",
]);

export function coachDebugEnabled(search?: string): boolean {
  const resolvedSearch =
    search ?? (typeof window === "undefined" ? "" : window.location.search);
  return new URLSearchParams(resolvedSearch).get("coachDebug") === "1";
}

function normalizedCoachErrorName(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    typeof (error as { readonly name?: unknown }).name === "string"
  ) {
    const name = (error as { readonly name: string }).name;
    return SAFE_COACH_ERROR_NAMES.has(name) ? name : "[unknown-error-name]";
  }
  return "UnknownError";
}

export function coachFailureStageForPrimaryLines(
  beforeLines: readonly { readonly rank: number }[],
  afterLines: readonly { readonly rank: number }[],
): "analyzeTurn" | "acceptance" {
  return beforeLines[0] && afterLines[0] ? "analyzeTurn" : "acceptance";
}

function normalizedCoachErrorMessage(error: unknown): string {
  const value =
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof (error as { readonly message?: unknown }).message === "string"
      ? (error as { readonly message: string }).message
      : "";
  if (/\b(?:fen|pgn)\b/i.test(value) || FEN_IN_ERROR_MESSAGE.test(value)) {
    return "[redacted-position-data]";
  }
  return value.replace(/\s+/g, " ").trim().slice(0, 160) || "[no-message]";
}

export function reportCoachFailureDebug({
  stage,
  error,
  signalAborted,
  identityActive,
  autoAttempt,
  action,
}: {
  readonly stage: CoachFailureStage;
  readonly error: unknown;
  readonly signalAborted: boolean;
  readonly identityActive: boolean;
  readonly autoAttempt: number;
  readonly action: CoachFailureAction;
}): void {
  if (!coachDebugEnabled()) return;
  console.warn("[coach-debug] analysis failed", {
    stage,
    errorName: normalizedCoachErrorName(error),
    errorMessage: normalizedCoachErrorMessage(error),
    signalAborted,
    identityActive,
    autoAttempt,
    action,
  });
}

export function isCurrentCoachRequest(
  pending: { readonly identity: { readonly requestId: string } } | undefined,
  requestId: string,
): boolean {
  return pending?.identity.requestId === requestId;
}

export function coachFailureAction(
  error: unknown,
  outerSignalAborted: boolean,
  identityActive: boolean,
  autoAttempts: number,
): CoachFailureAction {
  if (!identityActive || outerSignalAborted) return "stale";
  if (isAbortErrorLike(error) && autoAttempts < 1) return "auto-retry";
  return "unavailable";
}

export function coachFailureActionForTurn(
  error: unknown,
  outerSignalAborted: boolean,
  identityActive: boolean,
  autoAttempts: number,
  isPlayerTurn: boolean,
): CoachFailureAction {
  if (!identityActive || outerSignalAborted) return "stale";
  if (isAbortErrorLike(error) && !isPlayerTurn) return "wait-for-player-turn";
  return coachFailureAction(
    error,
    outerSignalAborted,
    identityActive,
    autoAttempts,
  );
}

export function shouldWaitForCoachRetry(
  retryTarget: Pick<RetryAnalysisTarget, "autoAttempts"> | undefined,
  gameTurn: PlayerColor,
  playerColor: PlayerColor,
): boolean {
  return (
    retryTarget !== undefined &&
    retryTarget.autoAttempts > 0 &&
    gameTurn !== playerColor
  );
}

export function clearExpiredCoachRetryTarget(
  target: RetryAnalysisTarget | undefined,
  identity: Pick<
    AnalysisRequestIdentity,
    | "lineId"
    | "lineRole"
    | "fork"
    | "historyIndex"
    | "uci"
    | "beforeFen"
    | "afterFen"
  >,
): RetryAnalysisTarget | undefined {
  if (!target) return undefined;
  const sameFork =
    target.fork?.lineId === identity.fork?.lineId &&
    target.fork?.ply === identity.fork?.ply;
  return target.lineId === identity.lineId &&
    target.lineRole === identity.lineRole &&
    sameFork &&
    target.historyIndex === identity.historyIndex &&
    target.uci === identity.uci &&
    target.beforeFen === identity.beforeFen &&
    target.afterFen === identity.afterFen
    ? undefined
    : target;
}

export function coachRemainingDelay(
  budgetMs: number,
  startedAt: number,
  now: number,
): number {
  return Math.max(0, budgetMs - (now - startedAt));
}

export function isAbortErrorLike(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { readonly name?: unknown }).name === "AbortError"
  );
}

export function shouldReplacePendingFeedback(
  hasMatchingFeedback: boolean,
  retryTarget: Pick<RetryAnalysisTarget, "historyIndex" | "uci"> | undefined,
  historyIndex: number,
  uci: string,
): boolean {
  return (
    !hasMatchingFeedback ||
    (retryTarget?.historyIndex === historyIndex && retryTarget.uci === uci)
  );
}

export interface RetryAnalysisTarget {
  readonly lineId: string;
  readonly lineRole: "main" | "trial";
  readonly fork?: { readonly lineId: string; readonly ply: number };
  readonly historyIndex: number;
  readonly uci: string;
  readonly beforeFen: string;
  readonly afterFen: string;
  readonly autoAttempts: number;
  /** Set only while this retry request is actively queued or running. */
  readonly attemptRequestId?: string;
}

export function rebuildCoachRetryTurn(
  workspace: SessionWorkspace,
  target: RetryAnalysisTarget,
): { readonly before: GameSession; readonly after: GameSession } {
  if (!isRetryTargetActive(workspace, target))
    throw new Error("Retry target is no longer active");
  const session = activeSessionLine(workspace).timeline.session;
  const before = sessionAtPly(session, target.historyIndex);
  const after = sessionAtPly(session, target.historyIndex + 1);
  if (
    before.fen !== target.beforeFen ||
    after.fen !== target.afterFen ||
    after.history.at(-1)?.uci !== target.uci
  )
    throw new Error("Retry target no longer reconstructs its original move");
  return { before, after };
}

export function isRetryAttemptInFlight(
  target: Pick<RetryAnalysisTarget, "attemptRequestId"> | undefined,
  pending: { readonly identity: { readonly requestId: string } } | undefined,
): boolean {
  return (
    target?.attemptRequestId !== undefined &&
    target.attemptRequestId === pending?.identity.requestId
  );
}

export function shouldStartCoachRetry(
  target: RetryAnalysisTarget | undefined,
  pending: { readonly identity: { readonly requestId: string } } | undefined,
  gameTurn: PlayerColor,
  playerColor: PlayerColor,
): boolean {
  return (
    target !== undefined &&
    !shouldWaitForCoachRetry(target, gameTurn, playerColor) &&
    !isRetryAttemptInFlight(target, pending)
  );
}

export function retryAnalysisTarget(
  workspace: SessionWorkspace,
  entry: Pick<
    MoveFeedbackRecord,
    "historyIndex" | "uci" | "beforeFen" | "afterFen"
  >,
): RetryAnalysisTarget {
  const line = activeSessionLine(workspace);
  return {
    lineId: line.id,
    lineRole: line.id === workspace.mainLineId ? "main" : "trial",
    ...(line.fork === undefined ? {} : { fork: line.fork }),
    historyIndex: entry.historyIndex,
    uci: entry.uci,
    beforeFen: entry.beforeFen,
    afterFen: entry.afterFen,
    autoAttempts: 0,
  };
}

export function isRetryTargetActive(
  workspace: SessionWorkspace,
  target: RetryAnalysisTarget,
): boolean {
  const line = activeSessionLine(workspace);
  const entry = replayHistory(line.timeline.session)[target.historyIndex];
  return (
    line.id === target.lineId &&
    (line.id === workspace.mainLineId ? "main" : "trial") === target.lineRole &&
    line.fork?.lineId === target.fork?.lineId &&
    line.fork?.ply === target.fork?.ply &&
    entry?.move.uci === target.uci &&
    entry.beforeFen === target.beforeFen &&
    entry.afterFen === target.afterFen
  );
}

export function finalizePendingCoachAttempt(
  workspace: SessionWorkspace,
  identity: AnalysisRequestIdentity,
): SessionWorkspace {
  const line = workspace.lines.find((item) => item.id === identity.lineId);
  if (!line) return workspace;
  const feedbackByPly = line.feedbackByPly.map((entry) =>
    entry.historyIndex === identity.historyIndex &&
    entry.uci === identity.uci &&
    entry.actor === identity.actor &&
    entry.beforeFen === identity.beforeFen &&
    entry.afterFen === identity.afterFen &&
    entry.status === "pending"
      ? { ...entry, status: "unavailable" as const }
      : entry,
  );
  return {
    ...workspace,
    revision: workspace.revision + 1,
    lines: workspace.lines.map((item) =>
      item.id === line.id
        ? { ...item, revision: item.revision + 1, feedbackByPly }
        : item,
    ),
  };
}
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
  if (
    next.activeLineId !== previous.activeLineId &&
    next.lines.length <= previous.lines.length
  )
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

export function shouldCapturePostgameReview(
  workspace: SessionWorkspace,
): boolean {
  const line = activeSessionLine(workspace);
  return (
    workspace.postgameReview === undefined &&
    line.timeline.cursor === line.timeline.session.history.length &&
    line.timeline.session.isCheckmate
  );
}

export function postgameReviewAutoOpenDelayMs(
  prefersReducedMotion: boolean,
): number {
  return prefersReducedMotion ? 0 : PIECE_MOVE_DURATION_MS + 120;
}

/** A review is announced once by identity; progress updates must not reopen it. */
export function postgameReviewAutoOpenCandidate(
  reviewId: string | undefined,
  isCheckmate: boolean,
  autoOpenedReviewId: string | undefined,
): string | undefined {
  return isCheckmate &&
    reviewId !== undefined &&
    reviewId !== autoOpenedReviewId
    ? reviewId
    : undefined;
}

export function shouldAnalyzeLiveCoachMove(
  actor: "user" | "maia",
  after: Pick<GameSession, "isGameOver">,
): boolean {
  return actor === "user" && !after.isGameOver;
}

export function shouldRequestOpponentMove(args: {
  readonly started: boolean;
  readonly paused: boolean;
  readonly isBrowsingHistory: boolean;
  readonly isGameOver: boolean;
  readonly turn: PlayerColor;
  readonly engineColor: PlayerColor;
}): boolean {
  return (
    args.started &&
    !args.paused &&
    !args.isBrowsingHistory &&
    !args.isGameOver &&
    args.turn === args.engineColor
  );
}

export interface PostgameAnalysisPosition {
  readonly id: string;
  readonly fen: string;
  readonly perspective: PlayerColor;
}

export function postgameAnalysisPositionsForTask(
  task: Readonly<{
    kind: "decision" | "terminal-checkmate";
    reviewId: string;
    moveIndex: number;
    color: PlayerColor;
    beforeFen: string;
    afterFen: string;
  }>,
): readonly PostgameAnalysisPosition[] {
  return task.kind === "terminal-checkmate"
    ? [
        {
          id: `${task.reviewId}:before:${task.moveIndex}`,
          fen: task.beforeFen,
          perspective: task.color,
        },
      ]
    : [
        {
          id: `${task.reviewId}:before:${task.moveIndex}`,
          fen: task.beforeFen,
          perspective: task.color,
        },
        {
          id: `${task.reviewId}:after:${task.moveIndex}`,
          fen: task.afterFen,
          perspective: task.color,
        },
      ];
}

export async function resolvePostgameReviewTask(args: {
  readonly task: Readonly<{
    kind: "decision" | "terminal-checkmate";
    reviewId: string;
    moveIndex: number;
    color: PlayerColor;
    beforeFen: string;
    afterFen: string;
  }>;
  readonly review: Readonly<{
    snapshot: {
      terminalFen: string;
      moves: readonly {
        beforeFen: string;
        afterFen: string;
      }[];
    };
  }>;
  readonly analyzePosition: (
    request: PostgameAnalysisPosition,
  ) => Promise<AnalysisResult>;
}): Promise<ReturnType<typeof postgameEvidenceFromAnalysis>> {
  const calls = postgameAnalysisPositionsForTask(args.task);
  const results = await Promise.all(
    calls.map((request) => args.analyzePosition(request)),
  );
  const bestLine = results[0]?.lines[0];
  if (!bestLine) throw new Error("Missing postgame best line");
  if (args.task.kind === "terminal-checkmate") {
    return postgameEvidenceFromAnalysis({
      kind: "terminal-checkmate",
      review: args.review as Parameters<
        typeof postgameEvidenceFromAnalysis
      >[0]["review"],
      moveIndex: args.task.moveIndex,
      bestLine,
    });
  }
  const playedLine = results[1]?.lines[0];
  if (!playedLine) throw new Error("Missing postgame played line");
  return postgameEvidenceFromAnalysis({
    kind: "decision",
    review: args.review as Parameters<
      typeof postgameEvidenceFromAnalysis
    >[0]["review"],
    moveIndex: args.task.moveIndex,
    bestLine,
    playedLine,
  });
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

/**
 * v3 carries the only contextual text we may show. Older records keep their
 * saved wording rather than deriving a new claim from historic evidence.
 */
export function feedbackPresentationFor(
  feedback: CoachTurnRecord,
): Readonly<{ summary: string; detail: string }> {
  if (feedback.presentation) return feedback.presentation;
  return Object.freeze({
    summary: "El análisis detallado de esta jugada no está disponible.",
    detail:
      "Esta partida se guardó con una versión anterior del entrenador. Puedes continuar jugando o analizar una jugada nueva.",
  });
}

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

export function AdvicePanel({
  feedbackEntry,
  helpLevel,
  selectedMaia,
  lineVisible,
  onToggleLine,
  slow,
  onRetry,
}: {
  readonly feedbackEntry: MoveFeedbackRecord | undefined;
  readonly helpLevel: GameSettings["helpLevel"];
  readonly selectedMaia: boolean;
  readonly lineVisible: boolean;
  readonly onToggleLine: () => void;
  readonly slow: boolean;
  readonly onRetry: () => void;
}) {
  const [detailOpen, setDetailOpen] = useState(false);
  const detailTriggerRef = useRef<HTMLButtonElement>(null);
  const mobileDetailTriggerRef = useRef<HTMLButtonElement>(null);
  const detailCloseRef = useRef<HTMLButtonElement>(null);
  const detailWasOpenRef = useRef(false);
  useEffect(() => {
    if (!detailOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDetailOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [detailOpen]);
  useEffect(() => {
    if (detailOpen) detailCloseRef.current?.focus();
    if (!detailOpen && detailWasOpenRef.current) {
      const trigger =
        [mobileDetailTriggerRef.current, detailTriggerRef.current].find(
          (element) => element?.getClientRects().length,
        ) ??
        document.querySelector<HTMLButtonElement>(".feedback-detail-trigger");
      trigger?.focus();
    }
    detailWasOpenRef.current = detailOpen;
  }, [detailOpen]);
  const feedback = feedbackEntry?.record;
  const displayedLine = useMemo(
    () =>
      feedback
        ? formatMoveSequence(
            feedback.turn.beforeFen,
            feedback.explanation?.supportingVariation ??
              feedback.evidence.verifiedBestVariation,
          )
        : [],
    [
      feedback?.turn.beforeFen,
      feedback?.evidence.verifiedBestVariation,
      feedback?.explanation?.supportingVariation,
    ],
  );
  const presentation = feedback ? feedbackPresentationFor(feedback) : undefined;
  const compactSummary = feedback
    ? Object.freeze({
        title: `${feedback.turn.playedSan} · ${
          feedback.assessment
            ? qualityMeta[feedback.assessment.label].label
            : "Analizada"
        }`,
        reason: presentation?.summary ?? "",
      })
    : undefined;
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
          {slow ? (
            <p className="feedback-slow" role="status">
              El análisis tarda más de lo habitual. Puedes continuar; este
              intento terminará con una opción para reintentarlo.
            </p>
          ) : null}
          <h2 id="feedback-title">Estoy revisando esa decisión…</h2>
          <p>El tablero sigue disponible mientras termina el análisis local.</p>
        </section>
      ) : feedbackEntry?.status === "unavailable" ? (
        <section
          className="feedback feedback-empty"
          aria-labelledby="feedback-title"
        >
          <div className="feedback-actions">
            <button type="button" onClick={onRetry}>
              Reintentar análisis
            </button>
          </div>
          <h2 id="feedback-title">No pude terminar este análisis</h2>
          <p>
            La partida sigue siendo válida; puedes continuar o volver a esta
            jugada después.
          </p>
        </section>
      ) : feedback ? (
        <section
          className="feedback feedback-ready"
          aria-labelledby="feedback-title"
        >
          <button
            ref={mobileDetailTriggerRef}
            type="button"
            className="feedback-mobile-summary"
            onClick={() => setDetailOpen(true)}
            aria-label={`Abrir análisis de ${feedback.turn.playedSan}. ${compactSummary?.title}. ${compactSummary?.reason}.`}
          >
            <span>{compactSummary?.title}</span>
            <span>{compactSummary?.reason}</span>
          </button>
          <div className="feedback-ready-content">
            <div className="moves-heading">
              <h2 id="feedback-title">Feedback de tu jugada</h2>
              <strong>
                {feedback.assessment
                  ? qualityMeta[feedback.assessment.label].label
                  : ""}
              </strong>
            </div>
            <p className="feedback-copy">{presentation?.summary}</p>
            <div className="feedback-actions">
              <button
                ref={detailTriggerRef}
                type="button"
                className="secondary feedback-detail-trigger"
                onClick={() => setDetailOpen(true)}
              >
                Ver explicación
              </button>
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
          </div>
          {detailOpen ? (
            <div
              className="feedback-dialog-backdrop"
              role="presentation"
              onMouseDown={() => setDetailOpen(false)}
            >
              <section
                className="feedback-dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby="feedback-detail-title"
                onMouseDown={(event) => event.stopPropagation()}
              >
                <div className="moves-heading">
                  <h2 id="feedback-detail-title">
                    Análisis de {feedback.turn.playedSan}
                  </h2>
                  <button
                    ref={detailCloseRef}
                    type="button"
                    className="secondary"
                    onClick={() => setDetailOpen(false)}
                  >
                    Cerrar
                  </button>
                </div>
                <p>{presentation?.detail}</p>
                {displayedLine.length ? (
                  <ol className="feedback-line" aria-label="Mejor variante">
                    {displayedLine.map((move, index) => (
                      <li key={`${move}-${index}`}>{move}</li>
                    ))}
                  </ol>
                ) : null}
              </section>
            </div>
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

export function MobileEvaluationBar({
  visible,
  label,
}: {
  readonly visible: boolean;
  readonly label: string;
}) {
  if (!visible) return null;
  return (
    <div
      className="mobile-evaluation"
      role="status"
      aria-label={`Evaluación local: ${label}`}
    >
      <span className="mobile-evaluation-fill" aria-hidden="true" />
      <span>Evaluación local: {label}</span>
    </div>
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

export type OpponentResponseRequest = {
  readonly lineId: string;
  readonly cursor: number;
  readonly fen: string;
  readonly historyLength: number;
};

export function opponentResponseStillMatches(
  request: OpponentResponseRequest,
  current: OpponentResponseRequest,
): boolean {
  return (
    request.lineId === current.lineId &&
    request.cursor === current.cursor &&
    request.fen === current.fen &&
    request.historyLength === current.historyLength
  );
}

/**
 * Applies a response only to the exact line/route that requested it. Returning
 * the original workspace is a deliberate no-op: callers must not animate or
 * announce a response that was not committed.
 */
export function applyCurrentOpponentResponse(
  workspace: SessionWorkspace,
  request: OpponentResponseRequest,
  uci: string,
): SessionWorkspace {
  const line = activeSessionLine(workspace);
  const position = sessionAtNavigationCursor(line.timeline);
  if (
    !opponentResponseStillMatches(request, {
      lineId: line.id,
      cursor: line.timeline.cursor,
      fen: position.fen,
      historyLength: position.history.length,
    })
  )
    return workspace;
  return syncActiveLineSession(workspace, applyEngineLine(position, uci));
}

/**
 * Safari can report a layout viewport behind its browser controls while the
 * visual viewport is shorter. Keep the mobile shell tied to the latter; CSS
 * retains 100dvh as its no-JavaScript fallback.
 */
export function bindVisualViewportHeight(
  windowRef: Window = window,
  documentRef: Document = document,
): () => void {
  const sync = () => {
    const height = windowRef.visualViewport?.height ?? windowRef.innerHeight;
    documentRef.documentElement.style.setProperty(
      "--app-viewport-height",
      `${Math.round(height)}px`,
    );
  };
  const visualViewport = windowRef.visualViewport;
  sync();
  windowRef.addEventListener("resize", sync, { passive: true });
  visualViewport?.addEventListener("resize", sync, { passive: true });
  visualViewport?.addEventListener("scroll", sync, { passive: true });
  return () => {
    windowRef.removeEventListener("resize", sync);
    visualViewport?.removeEventListener("resize", sync);
    visualViewport?.removeEventListener("scroll", sync);
  };
}

export function App() {
  useEffect(() => bindVisualViewportHeight(), []);
  useEffect(
    () => () => {
      if (postgameReviewTimerRef.current !== undefined)
        window.clearTimeout(postgameReviewTimerRef.current);
    },
    [],
  );
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
  const postgameReview = workspace.postgameReview;
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
  const [postgameReviewOpen, setPostgameReviewOpen] = useState(false);
  const postgameSummaryTriggerRef = useRef<HTMLButtonElement>(null);
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
  const coachAttemptControllersRef = useRef(new Map<string, AbortController>());
  const coachAttemptDeadlinesRef = useRef(
    new Map<string, ReturnType<typeof window.setTimeout>>(),
  );
  const postgameReviewTimerRef = useRef<number | undefined>(undefined);
  const postgameAutoOpenedReviewRef = useRef<string | undefined>(undefined);
  const clearPostgameReviewPresentation = () => {
    if (postgameReviewTimerRef.current !== undefined)
      window.clearTimeout(postgameReviewTimerRef.current);
    postgameReviewTimerRef.current = undefined;
    postgameAutoOpenedReviewRef.current = undefined;
    setPostgameReviewOpen(false);
  };
  const postgameReviewTaskRef = useRef<
    | {
        readonly reviewId: string;
        readonly kind: "decision" | "terminal-checkmate";
        readonly moveIndex: number;
        readonly beforeFen: string;
        readonly afterFen: string;
      }
    | undefined
  >(undefined);
  const [coachPending, setCoachPending] = useState<{
    readonly identity: AnalysisRequestIdentity;
    readonly startedAt: number;
  }>();
  const coachPendingRef = useRef<typeof coachPending>(undefined);
  coachPendingRef.current = coachPending;
  const releaseCoachAttempt = (requestId: string) => {
    const deadline = coachAttemptDeadlinesRef.current.get(requestId);
    if (deadline !== undefined) window.clearTimeout(deadline);
    coachAttemptDeadlinesRef.current.delete(requestId);
    coachAttemptControllersRef.current.delete(requestId);
  };
  const abortCoachAttempt = (requestId: string) => {
    const controller = coachAttemptControllersRef.current.get(requestId);
    controller?.abort();
    releaseCoachAttempt(requestId);
  };
  const clearPendingCoachState = (identity: AnalysisRequestIdentity) => {
    const wasCurrent =
      coachPendingRef.current?.identity.requestId === identity.requestId;
    if (wasCurrent) coachPendingRef.current = undefined;
    setCoachPending((current) =>
      current?.identity.requestId === identity.requestId ? undefined : current,
    );
    if (wasCurrent) setCoachSlow(false);
    if (activeCoachRequestId.current === identity.requestId)
      activeCoachRequestId.current = undefined;
    releaseCoachAttempt(identity.requestId);
  };
  const finalizeStaleCoachAttempt = (identity: AnalysisRequestIdentity) => {
    // A newer retry may be analyzing the same ply. Feedback does not carry a
    // request id, so only the request currently registered as pending may
    // transition that ply to unavailable.
    if (coachPendingRef.current?.identity.requestId !== identity.requestId)
      return;
    abortCoachAttempt(identity.requestId);
    setWorkspace((current) => finalizePendingCoachAttempt(current, identity));
    setProvisionalMoveQuality((current) =>
      current?.historyIndex === identity.historyIndex &&
      current.uci === identity.uci
        ? undefined
        : current,
    );
    setRetryTarget((current) =>
      clearExpiredCoachRetryTarget(current, identity),
    );
    clearPendingCoachState(identity);
  };
  const scheduleCoachDeadline = (
    identity: AnalysisRequestIdentity,
    startedAt: number,
  ) => {
    abortCoachAttempt(identity.requestId);
    const controller = new AbortController();
    coachAttemptControllersRef.current.set(identity.requestId, controller);
    const deadline = window.setTimeout(
      () => {
        if (coachPendingRef.current?.identity.requestId !== identity.requestId)
          return;
        controller.abort();
        finalizeStaleCoachAttempt(identity);
      },
      coachRemainingDelay(COACH_DEADLINE_MS, startedAt, Date.now()),
    );
    coachAttemptDeadlinesRef.current.set(identity.requestId, deadline);
    return controller;
  };
  const cancelPendingCoachAttempt = () => {
    const pending = coachPendingRef.current;
    if (!pending) return;
    const { identity } = pending;
    finalizeStaleCoachAttempt(identity);
  };
  const [coachSlow, setCoachSlow] = useState(false);
  const [coachRetry, setCoachRetry] = useState(0);
  const [retryTarget, setRetryTarget] = useState<RetryAnalysisTarget>();
  const retryLineRef = useRef<string | undefined>(undefined);
  const [mobileTreeOpen, setMobileTreeOpen] = useState(false);
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const mobileTreeTriggerRef = useRef<HTMLButtonElement>(null);
  const mobileMoreTriggerRef = useRef<HTMLButtonElement>(null);
  const mobileTreeCloseRef = useRef<HTMLButtonElement>(null);
  const mobileMoreCloseRef = useRef<HTMLButtonElement>(null);
  const treeWasOpenRef = useRef(false);
  const moreWasOpenRef = useRef(false);
  useEffect(() => {
    const pending = coachPendingRef.current;
    if (
      !pending ||
      acceptsAnalysisResult(
        workspace,
        pending.identity,
        pending.identity.requestId,
      )
    )
      return;
    // Promotion, fusion and a changed fork make the original request invalid.
    // Finalize the origin only if it still exists; a deleted line has no
    // feedback to mutate, but its transient request state must still disappear.
    finalizeStaleCoachAttempt(pending.identity);
  }, [coachPending, workspace]);
  useEffect(() => {
    const lineKey = `${activeLine.id}:${activeLine.fork?.lineId ?? ""}:${activeLine.fork?.ply ?? ""}`;
    if (retryLineRef.current !== undefined && retryLineRef.current !== lineKey)
      setRetryTarget(undefined);
    retryLineRef.current = lineKey;
  }, [activeLine.fork?.lineId, activeLine.fork?.ply, activeLine.id]);
  const game = useMemo(
    () => createLocalGame(sessionAtNavigationCursor(timeline)),
    [timeline],
  );
  const currentGameTurnRef = useRef(game.turn);
  currentGameTurnRef.current = game.turn;
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
  const opponentMoveHighlight = opponentLastMoveHighlight(game, playerColor);
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
  useEffect(() => {
    if (!coachPending) {
      setCoachSlow(false);
      return;
    }
    const now = Date.now();
    const slowTimer = window.setTimeout(
      () => setCoachSlow(true),
      coachRemainingDelay(COACH_SLOW_THRESHOLD_MS, coachPending.startedAt, now),
    );
    return () => {
      window.clearTimeout(slowTimer);
    };
  }, [coachPending]);
  const destinations = useMemo(
    () => (selected ? legalDestinations(game, selected) : []),
    [game, selected],
  );
  useEffect(() => {
    if (!mobileTreeOpen && !mobileMoreOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setMobileTreeOpen(false);
      setMobileMoreOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mobileMoreOpen, mobileTreeOpen]);
  useEffect(() => {
    if (mobileTreeOpen) mobileTreeCloseRef.current?.focus();
    if (!mobileTreeOpen && treeWasOpenRef.current)
      mobileTreeTriggerRef.current?.focus();
    treeWasOpenRef.current = mobileTreeOpen;
  }, [mobileTreeOpen]);
  useEffect(() => {
    if (mobileMoreOpen) mobileMoreCloseRef.current?.focus();
    if (!mobileMoreOpen && moreWasOpenRef.current)
      mobileMoreTriggerRef.current?.focus();
    moreWasOpenRef.current = mobileMoreOpen;
  }, [mobileMoreOpen]);

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

  useEffect(() => {
    if (!started || !shouldCapturePostgameReview(workspace)) return;
    setWorkspace((current) => {
      if (!shouldCapturePostgameReview(current)) return current;
      const line = activeSessionLine(current);
      return {
        ...current,
        postgameReview: createPostgameReviewStateV1({
          session: line.timeline.session,
          lineId: line.id,
          playerColor,
          feedbackByPly: line.feedbackByPly,
        }),
      };
    });
  }, [playerColor, started, workspace]);

  useEffect(() => {
    if (!postgameReview) {
      setPostgameReviewOpen(false);
      return;
    }
    const seeded = seedPostgameReviewFromFeedback(
      postgameReview,
      feedbackByPly,
    );
    if (seeded === postgameReview) return;
    setWorkspace((current) =>
      current.postgameReview?.reviewId === postgameReview.reviewId
        ? { ...current, postgameReview: seeded }
        : current,
    );
  }, [feedbackByPly, postgameReview]);

  useEffect(() => {
    const candidate = postgameReviewAutoOpenCandidate(
      postgameReview?.reviewId,
      game.isCheckmate,
      postgameAutoOpenedReviewRef.current,
    );
    if (!candidate) return;
    // Record the identity before scheduling. A partial->ready update or a
    // user dismissal must never create a second automatic opening.
    postgameAutoOpenedReviewRef.current = candidate;
    const prefersReducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
    if (postgameReviewTimerRef.current !== undefined)
      window.clearTimeout(postgameReviewTimerRef.current);
    postgameReviewTimerRef.current = window.setTimeout(
      () => setPostgameReviewOpen(true),
      postgameReviewAutoOpenDelayMs(prefersReducedMotion),
    );
    return () => {
      if (postgameReviewTimerRef.current !== undefined)
        window.clearTimeout(postgameReviewTimerRef.current);
    };
  }, [game.isCheckmate, postgameReview?.reviewId]);

  useEffect(() => {
    if (!postgameReview || postgameReview.status !== "partial") return;
    const queued = postgameReviewTaskRef.current;
    if (queued?.reviewId === postgameReview.reviewId) return;
    const nextTask = listPostgameReviewTasks(postgameReview).find(
      (task) =>
        !isPostgameReviewPendingForMove(
          postgameReview,
          feedbackByPly,
          task.moveIndex,
        ),
    );
    if (!nextTask) return;
    postgameReviewTaskRef.current = {
      reviewId: nextTask.reviewId,
      kind: nextTask.kind,
      moveIndex: nextTask.moveIndex,
      beforeFen: nextTask.beforeFen,
      afterFen: nextTask.afterFen,
    };
    coachQueueRef.current?.enqueue(async (signal) => {
      try {
        const engine = (coachEngineRef.current ??=
          createBrowserStockfishEngine());
        const limit = coachSearchPlan(settings.enginePreset).limit;
        const evidence = await resolvePostgameReviewTask({
          task: nextTask,
          review: postgameReview,
          analyzePosition: (request) =>
            coachAnalysisCache.analyze(
              engine,
              {
                ...request,
                preset: settings.enginePreset,
                multiPv: 1,
                limit,
              },
              signal,
            ),
        });
        if (signal.aborted) return;
        setWorkspace((current) => {
          const review = current.postgameReview;
          if (!review || review.reviewId !== nextTask.reviewId) return current;
          const move = review.snapshot.moves[nextTask.moveIndex];
          if (
            !move ||
            move.beforeFen !== nextTask.beforeFen ||
            move.afterFen !== nextTask.afterFen
          )
            return current;
          if (!evidence) return current;
          const nextReview = mergePostgameReviewEvidence(review, evidence);
          return nextReview === review
            ? current
            : { ...current, postgameReview: nextReview };
        });
      } catch (error: unknown) {
        if (signal.aborted || isAbortErrorLike(error)) return;
        setWorkspace((current) => {
          const review = current.postgameReview;
          if (!review || review.reviewId !== nextTask.reviewId) return current;
          const move = review.snapshot.moves[nextTask.moveIndex];
          if (
            !move ||
            move.beforeFen !== nextTask.beforeFen ||
            move.afterFen !== nextTask.afterFen
          )
            return current;
          const nextReview = markPostgameReviewUnavailable(review);
          return nextReview === review
            ? current
            : { ...current, postgameReview: nextReview };
        });
      } finally {
        const currentTask = postgameReviewTaskRef.current;
        if (
          currentTask?.reviewId === nextTask.reviewId &&
          currentTask.moveIndex === nextTask.moveIndex
        )
          postgameReviewTaskRef.current = undefined;
      }
    });
  }, [
    coachAnalysisCache,
    feedbackByPly,
    postgameReview,
    settings.enginePreset,
  ]);

  useEffect(
    () => () => {
      // Always detach before dispose. StrictMode and HMR may run this cleanup
      // and then remount the component while preserving its refs.
      disposeEngineRef(engineRef);
      disposeEngineRef(coachEngineRef);
      cancelCoachPrewarms();
      for (const requestId of coachAttemptControllersRef.current.keys())
        abortCoachAttempt(requestId);
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
    if (
      !shouldRequestOpponentMove({
        started,
        paused,
        isBrowsingHistory,
        isGameOver: game.isGameOver,
        turn: game.turn,
        engineColor,
      })
    )
      return;
    const engineMayStart = game.history.length === 0 && engineColor === "white";
    if (game.history.length === 0 && !engineMayStart) return;
    const controller = new AbortController();
    const currentGeneration = ++generation.current;
    const requestFen = game.fen;
    const requestPosition = game;
    const requestHistoryLength = game.history.length;
    const requestLineId = activeLine.id;
    const requestCursor = timeline.cursor;
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
        const request = {
          lineId: requestLineId,
          cursor: requestCursor,
          fen: requestFen,
          historyLength: requestHistoryLength,
        };
        // Check and prepare the workspace update before any visible side
        // effect. A same-FEN trial line is still a different route.
        const currentWorkspace = workspaceRef.current;
        const nextWorkspace = applyCurrentOpponentResponse(
          currentWorkspace,
          request,
          uci,
        );
        if (nextWorkspace === currentWorkspace) return;
        setWorkspace(nextWorkspace);
        setWorkspaceContextNotice(
          workspaceTransitionNotice(currentWorkspace, nextWorkspace),
        );
        beginMoveAnimation(
          requestPosition,
          uci.slice(0, 2) as Square,
          uci.slice(2, 4) as Square,
        );
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
    game.isGameOver,
    game.turn,
    activeLine.id,
    timeline.cursor,
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
    if (retryTarget && !isRetryTargetActive(workspace, retryTarget)) {
      setRetryTarget(undefined);
      return;
    }
    if (
      retryTarget &&
      !shouldStartCoachRetry(
        retryTarget,
        coachPendingRef.current,
        game.turn,
        playerColor,
      )
    )
      return;
    const retriedEntry = retryTarget
      ? replayHistory(game)[retryTarget.historyIndex]
      : undefined;
    const historyIndex = retryTarget?.historyIndex ?? game.history.length - 1;
    const move = game.history[historyIndex];
    if (!started || historyIndex < 0 || !move) return;
    const replacesPendingRetry =
      retryTarget?.historyIndex === historyIndex &&
      retryTarget.uci === move.uci;
    if (
      !shouldReplacePendingFeedback(
        feedbackByPly.some(
          (entry) =>
            entry.historyIndex === historyIndex && entry.uci === move.uci,
        ),
        replacesPendingRetry ? retryTarget : undefined,
        historyIndex,
        move.uci,
      )
    )
      return;

    const retryTurn = retryTarget
      ? rebuildCoachRetryTurn(workspace, retryTarget)
      : undefined;
    const after = retryTurn?.after ?? game;
    const before = retryTurn?.before ?? undoMove(after);
    const actor = retryTarget
      ? "user"
      : lastMoveColor === playerColor
        ? "user"
        : "maia";

    // Maia's reply is already produced by the opponent engine. Terminal plies
    // are handled by the post-game review pipeline, so the live coach must not
    // enqueue pending feedback or an impossible post-move search for mate/stalemate.
    if (!shouldAnalyzeLiveCoachMove(actor, after)) return;

    const identity = {
      historyIndex,
      uci: move.uci,
      actor,
      beforeFen: before.fen,
      afterFen: after.fen,
    } as const;
    const requestId = `coach-${historyIndex}-${move.uci}-${++coachRequestSequence.current}`;
    const analysisIdentity =
      retryTarget && retriedEntry
        ? {
            lineId: activeLine.id,
            lineRole:
              activeLine.id === workspace.mainLineId
                ? ("main" as const)
                : ("trial" as const),
            ...(activeLine.fork === undefined ? {} : { fork: activeLine.fork }),
            historyIndex,
            ply: historyIndex + 1,
            actor: "user" as const,
            uci: move.uci,
            beforeFen: before.fen,
            afterFen: after.fen,
            requestId,
          }
        : createAnalysisRequestIdentity(workspace, requestId);
    activeCoachRequestId.current = analysisIdentity.requestId;
    const previousAttemptId = coachPendingRef.current?.identity.requestId;
    const startedAt = retryTarget
      ? (coachPendingRef.current?.startedAt ?? Date.now())
      : Date.now();
    const pendingAttempt = {
      identity: analysisIdentity,
      startedAt,
    };
    coachPendingRef.current = pendingAttempt;
    setCoachPending(pendingAttempt);
    if (
      previousAttemptId !== undefined &&
      previousAttemptId !== analysisIdentity.requestId
    )
      releaseCoachAttempt(previousAttemptId);
    const attemptController = scheduleCoachDeadline(
      analysisIdentity,
      startedAt,
    );
    if (retryTarget) {
      setRetryTarget((current) =>
        current?.lineId === analysisIdentity.lineId &&
        current.historyIndex === analysisIdentity.historyIndex &&
        current.uci === analysisIdentity.uci &&
        current.beforeFen === analysisIdentity.beforeFen &&
        current.afterFen === analysisIdentity.afterFen
          ? { ...current, attemptRequestId: analysisIdentity.requestId }
          : current,
      );
    }
    setFeedbackByPly((entries) => [
      ...entries.filter((entry) => entry.historyIndex !== historyIndex),
      { ...identity, status: "pending" },
    ]);
    setProvisionalMoveQuality(undefined);

    coachQueueRef.current?.enqueue(async (signal) => {
      const abortFromQueue = () => attemptController.abort();
      signal.addEventListener("abort", abortFromQueue, { once: true });
      const attemptSignal = attemptController.signal;
      if (signal.aborted) attemptController.abort();
      const engine = (coachEngineRef.current ??=
        createBrowserStockfishEngine());
      const searchPlan = coachSearchPlan(settings.enginePreset);
      let failureStage: CoachFailureStage = "before";
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
            attemptSignal.aborted ||
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
            if (!assessment || attemptSignal.aborted) return;
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
            attemptSignal,
          )
          .then((result) => {
            beforeForProgress = result;
            if (latestAfterProgress) publishProvisional(latestAfterProgress);
            return result;
          })
          .catch((error: unknown) => {
            failureStage = "before";
            throw error;
          });
        const afterPromise = coachAnalysisCache
          .analyze(
            engine,
            {
              id: `coach-${actor}-after-${historyIndex}`,
              fen: after.fen,
              perspective: playerColor,
              preset: settings.enginePreset,
              multiPv: searchPlan.afterMultiPv,
              limit: searchPlan.limit,
            },
            attemptSignal,
            publishProvisional,
          )
          .catch((error: unknown) => {
            failureStage = "after";
            throw error;
          });
        const [beforeResult, afterResult] = await Promise.all([
          beforePromise,
          afterPromise,
        ]);
        const beforeLine = beforeResult.lines[0];
        const afterLine = afterResult.lines[0];
        failureStage = coachFailureStageForPrimaryLines(
          beforeResult.lines,
          afterResult.lines,
        );
        if (!beforeLine || !afterLine) throw new Error("Missing analysis line");
        const record = analyzeTurn(before, after, beforeLine, afterLine, {
          actor,
          helpLevel: settings.helpLevel,
          perspective: playerColor,
          beforeLines: beforeResult.lines,
          afterLines: afterResult.lines,
        });
        if (attemptSignal.aborted) {
          finalizeStaleCoachAttempt(analysisIdentity);
          return;
        }
        failureStage = "acceptance";
        if (
          activeCoachRequestId.current !== analysisIdentity.requestId ||
          !acceptsAnalysisResult(
            workspaceRef.current,
            analysisIdentity,
            analysisIdentity.requestId,
          )
        ) {
          finalizeStaleCoachAttempt(analysisIdentity);
          return;
        }
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
        clearPendingCoachState(analysisIdentity);
        setRetryTarget((current) =>
          current?.historyIndex === historyIndex && current.uci === move.uci
            ? undefined
            : current,
        );
      } catch (error) {
        const identityActive =
          activeCoachRequestId.current === analysisIdentity.requestId &&
          acceptsAnalysisResult(
            workspaceRef.current,
            analysisIdentity,
            analysisIdentity.requestId,
          );
        const failureAction = coachFailureActionForTurn(
          error,
          attemptSignal.aborted,
          identityActive,
          retryTarget?.autoAttempts ?? 0,
          currentGameTurnRef.current === playerColor,
        );
        reportCoachFailureDebug({
          stage: failureStage,
          error,
          signalAborted: attemptSignal.aborted,
          identityActive,
          autoAttempt: retryTarget?.autoAttempts ?? 0,
          action: failureAction,
        });
        if (failureAction === "stale") {
          finalizeStaleCoachAttempt(analysisIdentity);
          return;
        }
        if (
          failureAction === "auto-retry" ||
          failureAction === "wait-for-player-turn"
        ) {
          setRetryTarget({
            lineId: analysisIdentity.lineId,
            lineRole: analysisIdentity.lineRole,
            ...(analysisIdentity.fork === undefined
              ? {}
              : { fork: analysisIdentity.fork }),
            historyIndex,
            uci: move.uci,
            beforeFen: before.fen,
            afterFen: after.fen,
            autoAttempts: Math.max(retryTarget?.autoAttempts ?? 0, 1),
          });
          setCoachRetry((attempt) => attempt + 1);
          return;
        }
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
        clearPendingCoachState(analysisIdentity);
        setRetryTarget((current) =>
          current?.historyIndex === historyIndex && current.uci === move.uci
            ? undefined
            : current,
        );
      } finally {
        signal.removeEventListener("abort", abortFromQueue);
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
    coachRetry,
    retryTarget,
    activeLine,
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
          postgameReviewTaskRef.current = undefined;
          clearPostgameReviewPresentation();
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
    if (
      !canPlayBoard(paused, engineState === "thinking", game.turn, playerColor)
    )
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
      cancelPendingCoachAttempt();
      setRetryTarget(undefined);
      coachQueueRef.current?.invalidate();
      generation.current += 1;
      setWorkspace((current) => {
        // A move from a historical cursor is always a candidate. This remains
        // true for an identical UCI move so the opponent is recalculated.
        const source = activeSessionLine(current);
        const forked =
          source.timeline.cursor < source.timeline.session.history.length
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
      if (isBrowsingHistory)
        setWorkspaceContextNotice("Se creó una variante desde el historial.");
      setSelected(undefined);
      return;
    }
    setSelected(board.get(square)?.color === game.turn ? square : undefined);
  };

  const reset = () => {
    cancelCoachPrewarms();
    cancelPendingCoachAttempt();
    setRetryTarget(undefined);
    setProvisionalMoveQuality(undefined);
    coachQueueRef.current?.invalidate();
    postgameReviewTaskRef.current = undefined;
    clearPostgameReviewPresentation();
    generation.current += 1;
    const initialGame = createLocalGame(initialSnapshot);
    previousHistoryLength.current = initialGame.history.length;
    setWorkspace(createSessionWorkspace(initialGame));
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
    cancelPendingCoachAttempt();
    setRetryTarget(undefined);
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
    cancelPendingCoachAttempt();
    setRetryTarget(undefined);
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
    cancelPendingCoachAttempt();
    setRetryTarget(undefined);
    setProvisionalMoveQuality(undefined);
    coachQueueRef.current?.invalidate();
    generation.current += 1;
    clearStoredGame();
    setWorkspace(createSessionWorkspace(initialSnapshot));
    setHasSavedGame(false);
    setStarted(false);
    postgameReviewTaskRef.current = undefined;
    clearPostgameReviewPresentation();
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
    const pending = coachPendingRef.current;
    const finalizedWorkspace = pending
      ? finalizePendingCoachAttempt(nextWorkspace, pending.identity)
      : nextWorkspace;
    const nextLine = activeSessionLine(finalizedWorkspace);
    cancelCoachPrewarms();
    if (pending) clearPendingCoachState(pending.identity);
    setRetryTarget(undefined);
    coachQueueRef.current?.invalidate();
    generation.current += 1;
    setProvisionalMoveQuality(clearProvisionalForLineChange());
    setWorkspace(finalizedWorkspace);
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
      cancelPendingCoachAttempt();
      setRetryTarget(undefined);
      setProvisionalMoveQuality(undefined);
      coachQueueRef.current?.invalidate();
      postgameReviewTaskRef.current = undefined;
      clearPostgameReviewPresentation();
      generation.current += 1;
      const importedGame = createLocalGame(imported);
      previousHistoryLength.current = importedGame.history.length;
      setWorkspace(createSessionWorkspace(importedGame));
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

  const retryCoachAnalysis = () => {
    if (!adviceEntry || adviceEntry.status !== "unavailable") return;
    setFeedbackByPly((entries) =>
      entries.filter(
        (entry) =>
          !(
            entry.historyIndex === adviceEntry.historyIndex &&
            entry.uci === adviceEntry.uci &&
            entry.beforeFen === adviceEntry.beforeFen &&
            entry.afterFen === adviceEntry.afterFen
          ),
      ),
    );
    setCoachSlow(false);
    setCoachPending(undefined);
    setRetryTarget(retryAnalysisTarget(workspace, adviceEntry));
    setCoachRetry((attempt) => attempt + 1);
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
        <MobileEvaluationBar
          visible={settings.showEvaluation}
          label={
            adviceEntry?.record?.assessment
              ? qualityMeta[adviceEntry.record.assessment.label].label
              : "sin evaluación aún"
          }
        />
        <div className="game-layout">
          <AdvicePanel
            feedbackEntry={adviceEntry}
            helpLevel={settings.helpLevel}
            slow={coachSlow && adviceEntry?.status === "pending"}
            onRetry={retryCoachAnalysis}
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
                    const opponentMoveRole = opponentMoveSquareRole(
                      square,
                      opponentMoveHighlight,
                    );
                    return (
                      <button
                        key={square}
                        type="button"
                        className={`square ${(file + rank) % 2 === 0 ? "light" : "dark"}${isSelected ? " selected" : ""}${isDestination ? " destination" : ""}${opponentMoveRole ? ` opponent-last-move opponent-last-move-${opponentMoveRole}` : ""}`}
                        onClick={() => selectSquare(square)}
                        aria-label={`${square}${piece ? `, pieza ${piece.color === "white" ? "blanca" : "negra"}` : ", vacía"}${isDestination ? ", destino legal" : ""}${opponentMoveSquareAccessibilityLabel(opponentMoveRole)}${squareQuality ? `, calidad de la jugada: ${qualityMeta[squareQuality.label].label}` : ""}`}
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
            {game.isCheckmate && postgameReview ? (
              <button
                ref={postgameSummaryTriggerRef}
                type="button"
                className="postgame-summary-trigger"
                onClick={() => {
                  postgameAutoOpenedReviewRef.current = postgameReview.reviewId;
                  setPostgameReviewOpen(true);
                }}
              >
                Ver resumen
              </button>
            ) : null}
            <VariationHistory
              workspace={workspace}
              onSelect={selectWorkspaceLine}
              onDelete={deleteWorkspaceLine}
            />
            <button
              ref={mobileTreeTriggerRef}
              type="button"
              className="mobile-tree-toggle"
              onClick={() => setMobileTreeOpen(true)}
            >
              {workspace.activeLineId === workspace.mainLineId
                ? "Principal"
                : "Variante"}
            </button>
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
              <button
                ref={mobileMoreTriggerRef}
                type="button"
                className="mobile-more-toggle"
                onClick={() => setMobileMoreOpen(true)}
              >
                Más
              </button>
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
          {mobileTreeOpen ? (
            <div
              className="mobile-tree-sheet-backdrop"
              role="presentation"
              onMouseDown={() => setMobileTreeOpen(false)}
            >
              <section
                className="mobile-tree-sheet"
                role="dialog"
                aria-modal="true"
                aria-labelledby="mobile-tree-title"
                onMouseDown={(event) => event.stopPropagation()}
              >
                <div className="moves-heading">
                  <h2 id="mobile-tree-title">Árbol de jugadas</h2>
                  <button
                    ref={mobileTreeCloseRef}
                    type="button"
                    className="secondary"
                    onClick={() => setMobileTreeOpen(false)}
                  >
                    Cerrar
                  </button>
                </div>
                <VariationHistory
                  workspace={workspace}
                  onSelect={(lineId, cursor) => {
                    selectWorkspaceLine(lineId, cursor);
                    setMobileTreeOpen(false);
                  }}
                  onDelete={deleteWorkspaceLine}
                />
              </section>
            </div>
          ) : null}
          {mobileMoreOpen ? (
            <div
              className="mobile-more-sheet-backdrop"
              role="presentation"
              onMouseDown={() => setMobileMoreOpen(false)}
            >
              <section
                className="mobile-more-sheet"
                role="dialog"
                aria-modal="true"
                aria-labelledby="mobile-more-title"
                tabIndex={-1}
                onMouseDown={(event) => event.stopPropagation()}
              >
                <div className="moves-heading">
                  <h2 id="mobile-more-title">Más acciones</h2>
                  <button
                    ref={mobileMoreCloseRef}
                    type="button"
                    className="secondary"
                    onClick={() => setMobileMoreOpen(false)}
                  >
                    Cerrar
                  </button>
                </div>
                <section
                  className="mobile-captures"
                  aria-label="Capturas actuales"
                >
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
                </section>
                <fieldset className="mobile-settings">
                  <legend>Ajustes visibles</legend>
                  <label>
                    <input
                      type="checkbox"
                      checked={settings.showEvaluation}
                      onChange={(event) =>
                        setSettings((current) => ({
                          ...current,
                          showEvaluation: event.target.checked,
                        }))
                      }
                    />{" "}
                    Mostrar evaluación
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={settings.showArrows}
                      onChange={(event) =>
                        setSettings((current) => ({
                          ...current,
                          showArrows: event.target.checked,
                        }))
                      }
                    />{" "}
                    Mostrar flecha de última jugada
                  </label>
                </fieldset>
                <p className="mobile-settings-note">
                  El color, rival y fuerza se eligen al iniciar una partida
                  nueva; no se cambian a mitad de partida.
                </p>
                <div className="mobile-more-actions">
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
                  <button type="button" onClick={reset}>
                    Reiniciar partida
                  </button>
                  <button
                    type="button"
                    className="danger-action"
                    onClick={abandon}
                  >
                    Abandonar partida
                  </button>
                </div>
              </section>
            </div>
          ) : null}
        </div>
      </section>
      {postgameReview && postgameReviewOpen ? (
        <PostgameReviewScreen
          review={postgameReview}
          onClose={() => {
            setPostgameReviewOpen(false);
            window.setTimeout(
              () => postgameSummaryTriggerRef.current?.focus(),
              0,
            );
          }}
          onNewGame={reset}
        />
      ) : null}
    </main>
  );
}
