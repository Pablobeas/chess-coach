import {
  replayHistory,
  type GameSession,
  type PlayerColor,
} from "@chess-coach/chess-core";
import type { EnginePreset } from "@chess-coach/engine";
import type {
  CoachFeedback,
  CoachTurnRecord,
  MoveLabel,
} from "@chess-coach/coach";
import { normalizeCoachTurnRecord } from "@chess-coach/coach";

export type HelpLevel = "none" | "normal" | "guided";

export interface GameSettings {
  readonly playerColor: PlayerColor | "random";
  readonly opponentElo: number;
  readonly enginePreset: EnginePreset;
  readonly helpLevel: HelpLevel;
  readonly showEvaluation: boolean;
  readonly showArrows: boolean;
}

export interface MoveQualityAnnotation {
  readonly historyIndex: number;
  readonly uci: string;
  readonly label: MoveLabel;
}

export interface MoveFeedbackRecord {
  readonly historyIndex: number;
  readonly uci: string;
  readonly actor: "user" | "maia";
  readonly beforeFen: string;
  readonly afterFen: string;
  readonly status: "pending" | "ready" | "unavailable";
  readonly record?: CoachTurnRecord;
}

export interface RecoverySnapshot {
  readonly session: GameSession;
  readonly cursor: number;
  readonly annotations: readonly MoveQualityAnnotation[];
  readonly feedbackByPly: readonly MoveFeedbackRecord[];
}

export interface StoredGame {
  readonly version: 5;
  readonly settings: GameSettings;
  /** Complete line, including moves after the currently viewed position. */
  readonly session: GameSession;
  readonly cursor: number;
  readonly annotations: readonly MoveQualityAnnotation[];
  readonly feedbackByPly: readonly MoveFeedbackRecord[];
  readonly recovery?: RecoverySnapshot;
  readonly savedAt: string;
}

export const DEFAULT_SETTINGS: GameSettings = Object.freeze({
  playerColor: "white",
  opponentElo: 1500,
  enginePreset: "intermediate",
  helpLevel: "normal",
  showEvaluation: true,
  showArrows: true,
});

const STORAGE_KEY = "chess-coach:active-game:v1";

const moveLabels: readonly MoveLabel[] = [
  "best",
  "brilliant",
  "great",
  "excellent",
  "good",
  "inaccuracy",
  "mistake",
  "blunder",
  "miss",
  "already-lost",
];

function normalizeGameSettings(value: unknown): GameSettings | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<GameSettings>;
  const validBase =
    (candidate.playerColor === "white" ||
      candidate.playerColor === "black" ||
      candidate.playerColor === "random") &&
    (candidate.enginePreset === "beginner" ||
      candidate.enginePreset === "intermediate" ||
      candidate.enginePreset === "advanced") &&
    (candidate.helpLevel === "none" ||
      candidate.helpLevel === "normal" ||
      candidate.helpLevel === "guided") &&
    typeof candidate.showEvaluation === "boolean" &&
    typeof candidate.showArrows === "boolean";
  if (!validBase) return null;
  const opponentElo = candidate.opponentElo ?? DEFAULT_SETTINGS.opponentElo;
  if (!Number.isInteger(opponentElo) || opponentElo < 600 || opponentElo > 2600)
    return null;
  return {
    playerColor: candidate.playerColor,
    opponentElo,
    enginePreset: candidate.enginePreset,
    helpLevel: candidate.helpLevel,
    showEvaluation: candidate.showEvaluation,
    showArrows: candidate.showArrows,
  };
}

function isMoveQualityAnnotation(
  value: unknown,
): value is MoveQualityAnnotation {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<MoveQualityAnnotation>;
  return (
    Number.isInteger(candidate.historyIndex) &&
    (candidate.historyIndex ?? -1) >= 0 &&
    typeof candidate.uci === "string" &&
    moveLabels.includes(candidate.label as MoveLabel)
  );
}

function validAnnotations(
  session: GameSession,
  annotations: readonly MoveQualityAnnotation[],
): readonly MoveQualityAnnotation[] {
  return Object.freeze(
    annotations.filter(
      (annotation) =>
        annotation.historyIndex < session.history.length &&
        session.history[annotation.historyIndex]?.uci === annotation.uci,
    ),
  );
}

function isMoveFeedbackRecord(value: unknown): value is MoveFeedbackRecord {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<MoveFeedbackRecord>;
  return (
    Number.isInteger(candidate.historyIndex) &&
    (candidate.historyIndex ?? -1) >= 0 &&
    typeof candidate.uci === "string" &&
    (candidate.actor === "user" || candidate.actor === "maia") &&
    typeof candidate.beforeFen === "string" &&
    typeof candidate.afterFen === "string" &&
    (candidate.status === "pending" ||
      candidate.status === "ready" ||
      candidate.status === "unavailable") &&
    (candidate.status !== "ready" || isCoachTurnRecord(candidate.record))
  );
}

function validFeedback(
  session: GameSession,
  feedback: readonly MoveFeedbackRecord[],
): readonly MoveFeedbackRecord[] {
  const history = replayHistory(session);
  return Object.freeze(
    feedback.filter((record) => {
      const entry = history[record.historyIndex];
      if (
        !entry ||
        entry.move.uci !== record.uci ||
        record.beforeFen !== entry.beforeFen ||
        record.afterFen !== entry.afterFen
      )
        return false;
      return (
        record.status !== "ready" ||
        (record.record?.turn.playedUci === record.uci &&
          record.record.turn.ply === record.historyIndex + 1 &&
          record.record.turn.actor === record.actor)
      );
    }),
  );
}

function isSessionShape(value: unknown): value is GameSession {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<GameSession>;
  return (
    typeof candidate.fen === "string" &&
    typeof candidate.pgn === "string" &&
    Array.isArray(candidate.history)
  );
}

function validCursor(session: GameSession, cursor: unknown): cursor is number {
  return (
    typeof cursor === "number" &&
    Number.isInteger(cursor) &&
    cursor >= 0 &&
    cursor <= session.history.length
  );
}

function parseRecoverySnapshot(
  value: unknown,
): RecoverySnapshot | null | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<RecoverySnapshot>;
  if (
    !isSessionShape(candidate.session) ||
    !validCursor(candidate.session, candidate.cursor)
  )
    return null;
  if (
    !Array.isArray(candidate.annotations) ||
    !Array.isArray(candidate.feedbackByPly)
  )
    return null;
  if (
    candidate.annotations.some(
      (annotation) => !isMoveQualityAnnotation(annotation),
    ) ||
    candidate.feedbackByPly.some((record) => !isMoveFeedbackRecord(record))
  )
    return null;
  const annotations = validAnnotations(
    candidate.session,
    candidate.annotations,
  );
  const feedbackByPly = normalizeVisibleFeedback(
    validFeedback(candidate.session, candidate.feedbackByPly).map((record) =>
      record.status === "pending"
        ? ({ ...record, status: "unavailable" } as const)
        : record,
    ),
  );
  return {
    session: candidate.session,
    cursor: candidate.cursor,
    annotations,
    feedbackByPly: Object.freeze(feedbackByPly),
  };
}

function normalizeVisibleFeedback(
  feedback: readonly MoveFeedbackRecord[],
): readonly MoveFeedbackRecord[] {
  return Object.freeze(
    feedback.map((record) =>
      record.status === "ready" && record.record
        ? { ...record, record: normalizeCoachTurnRecord(record.record) }
        : record,
    ),
  );
}

function isCoachTurnRecord(value: unknown): value is CoachTurnRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<CoachTurnRecord>;
  return (
    record.schemaVersion === 2 &&
    record.turn !== undefined &&
    (record.turn.actor === "user" || record.turn.actor === "maia") &&
    Number.isInteger(record.turn.ply) &&
    typeof record.turn.playedUci === "string" &&
    typeof record.turn.beforeFen === "string" &&
    typeof record.turn.afterFen === "string" &&
    Array.isArray(record.hints) &&
    record.evidence !== undefined
  );
}

function isCoachFeedback(value: unknown): value is CoachFeedback {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<CoachFeedback>;
  return (
    moveLabels.includes(candidate.label as MoveLabel) &&
    typeof candidate.loss === "number" &&
    typeof candidate.explanation === "string" &&
    candidate.evidence !== undefined &&
    typeof candidate.evidence === "object" &&
    typeof candidate.motif === "string" &&
    candidate.hints !== undefined &&
    typeof candidate.hints === "object"
  );
}

export function loadStoredGame(
  storage: Storage = localStorage,
): StoredGame | null {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const candidate = parsed as Partial<StoredGame> & { version?: number };
    const version = (candidate as { version?: number }).version;
    const settings = normalizeGameSettings(candidate.settings);
    if (
      (version !== 1 &&
        version !== 2 &&
        version !== 3 &&
        version !== 4 &&
        version !== 5) ||
      !settings ||
      !isSessionShape(candidate.session)
    )
      return null;
    const session = candidate.session as GameSession;
    const annotations = Array.isArray(candidate.annotations)
      ? candidate.annotations.filter(isMoveQualityAnnotation)
      : [];
    const legacy = candidate as Partial<StoredGame> & {
      readonly lastFeedback?: CoachFeedback;
    };
    const feedbackByPly = Array.isArray(candidate.feedbackByPly)
      ? candidate.feedbackByPly.filter(isMoveFeedbackRecord)
      : isCoachFeedback(legacy.lastFeedback) &&
          typeof legacy.lastFeedback.evidence?.playedUci === "string" &&
          legacy.lastFeedback.record !== undefined
        ? (() => {
            const matches = session.history
              .map((move, index) =>
                move.uci === legacy.lastFeedback!.evidence.playedUci
                  ? index
                  : -1,
              )
              .filter((index) => index >= 0);
            const record = legacy.lastFeedback!.record;
            return matches.length === 1 && record
              ? [
                  {
                    historyIndex: matches[0]!,
                    uci: legacy.lastFeedback.evidence.playedUci,
                    actor: record.turn.actor,
                    beforeFen: record.turn.beforeFen,
                    afterFen: record.turn.afterFen,
                    status: "ready" as const,
                    record,
                  },
                ]
              : [];
          })()
        : [];
    const cursor = version >= 4 ? candidate.cursor : session.history.length;
    if (
      typeof cursor !== "number" ||
      !Number.isInteger(cursor) ||
      cursor < 0 ||
      cursor > session.history.length
    )
      return null;
    const recovery =
      version >= 5 ? parseRecoverySnapshot(candidate.recovery) : undefined;
    if (version >= 5 && candidate.recovery !== undefined && recovery === null)
      return null;
    const persistedFeedback = normalizeVisibleFeedback(
      validFeedback(session, feedbackByPly).map((record) =>
        record.status === "pending"
          ? ({ ...record, status: "unavailable" } as const)
          : record,
      ),
    );
    return {
      version: 5,
      settings,
      session,
      cursor,
      annotations: validAnnotations(session, annotations),
      feedbackByPly: Object.freeze(persistedFeedback),
      ...(recovery === undefined || recovery === null ? {} : { recovery }),
      savedAt: typeof candidate.savedAt === "string" ? candidate.savedAt : "",
    };
  } catch {
    return null;
  }
}

export function saveStoredGame(
  session: GameSession,
  settings: GameSettings,
  storage: Storage = localStorage,
  annotations: readonly MoveQualityAnnotation[] = [],
  feedbackByPly: readonly MoveFeedbackRecord[] = [],
  cursor = session.history.length,
  recovery?: RecoverySnapshot,
): void {
  if (
    !Number.isInteger(cursor) ||
    cursor < 0 ||
    cursor > session.history.length
  )
    throw new RangeError("The saved cursor must be within the game history");
  if (recovery !== undefined && parseRecoverySnapshot(recovery) === null)
    throw new RangeError("The recovery snapshot is invalid");
  const stored: StoredGame = {
    version: 5,
    session,
    settings,
    cursor,
    annotations: validAnnotations(session, annotations),
    feedbackByPly: validFeedback(session, feedbackByPly),
    ...(recovery === undefined ? {} : { recovery }),
    savedAt: new Date().toISOString(),
  };
  storage.setItem(STORAGE_KEY, JSON.stringify(stored));
}

export function clearStoredGame(storage: Storage = localStorage): void {
  storage.removeItem(STORAGE_KEY);
}

export function exportPgn(session: GameSession): string {
  return session.pgn === "" ? "*" : session.pgn;
}

export function importPgn(pgn: string): string {
  const normalized = pgn.trim();
  if (!normalized || normalized === "*") return "*";
  return normalized;
}
