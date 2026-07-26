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
import { decodeCoachTurnRecord } from "@chess-coach/coach";
import {
  createSessionWorkspace,
  type SessionLine,
  type SessionWorkspace,
} from "./sessionWorkspace";
import {
  decodePostgameReviewStateV1,
  type PostgameReviewStateV1,
} from "./postgameReview";

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

interface LegacyRecoverySnapshot {
  readonly session: GameSession;
  readonly cursor: number;
  readonly annotations: readonly MoveQualityAnnotation[];
  readonly feedbackByPly: readonly MoveFeedbackRecord[];
}

export interface StoredGame {
  readonly version: 6;
  readonly settings: GameSettings;
  readonly workspace: SessionWorkspace;
  readonly postgameReview?: PostgameReviewStateV1;
  /** Compatibility projection of the current main line. */
  readonly session: GameSession;
  readonly cursor: number;
  readonly annotations: readonly MoveQualityAnnotation[];
  readonly feedbackByPly: readonly MoveFeedbackRecord[];
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
          record.record.turn.actor === record.actor &&
          record.record.turn.beforeFen === record.beforeFen &&
          record.record.turn.afterFen === record.afterFen)
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

function hasSharedPrefix(
  parent: GameSession,
  child: GameSession,
  ply: number,
): boolean {
  if (!Number.isInteger(ply) || ply < 0) return false;
  if (ply > parent.history.length || ply > child.history.length) return false;
  for (let index = 0; index < ply; index += 1) {
    if (parent.history[index]?.uci !== child.history[index]?.uci) return false;
  }
  return true;
}

function parseRecoverySnapshot(
  value: unknown,
): LegacyRecoverySnapshot | null | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<LegacyRecoverySnapshot>;
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

function sameHistory(left: GameSession, right: GameSession): boolean {
  return (
    left.history.length === right.history.length &&
    left.history.every((move, index) => move.uci === right.history[index]?.uci)
  );
}

function migrateLegacyRecovery(
  workspace: SessionWorkspace,
  recovery: LegacyRecoverySnapshot | undefined,
): SessionWorkspace {
  if (recovery === undefined) return workspace;
  const existing = workspace.lines.find(
    (line) =>
      line.id !== workspace.mainLineId &&
      line.timeline.cursor === recovery.cursor &&
      sameHistory(line.timeline.session, recovery.session),
  );
  if (existing) {
    return {
      ...workspace,
      activeLineId: existing.id,
    };
  }
  const legacyTrialId = workspace.lines.some((line) => line.id === "trial-1")
    ? `legacy-recovery-${workspace.lines.length}`
    : "trial-1";
  return {
    ...workspace,
    activeLineId: legacyTrialId,
    lines: [
      ...workspace.lines,
      {
        id: legacyTrialId,
        timeline: { session: recovery.session, cursor: recovery.cursor },
        annotations: recovery.annotations,
        feedbackByPly: recovery.feedbackByPly,
        fork: { lineId: workspace.mainLineId, ply: recovery.cursor },
        revision: 0,
      } satisfies SessionLine,
    ],
  };
}

function normalizeVisibleFeedback(
  feedback: readonly MoveFeedbackRecord[],
): readonly MoveFeedbackRecord[] {
  return Object.freeze(
    feedback.flatMap((record) => {
      if (record.status !== "ready" || !record.record) return [record];
      const decoded = decodeCoachTurnRecord(record.record);
      return decoded ? [{ ...record, record: decoded }] : [];
    }),
  );
}

function normalizePostgameReview(
  value: unknown,
): PostgameReviewStateV1 | undefined {
  return decodePostgameReviewStateV1(value);
}

function isCoachTurnRecord(value: unknown): value is CoachTurnRecord {
  return decodeCoachTurnRecord(value) !== undefined;
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
    const candidate = parsed as Partial<StoredGame> & {
      version?: number;
      session?: GameSession;
      cursor?: number;
      annotations?: readonly MoveQualityAnnotation[];
      feedbackByPly?: readonly MoveFeedbackRecord[];
      recovery?: LegacyRecoverySnapshot;
    };
    const version = (candidate as { version?: number }).version;
    const settings = normalizeGameSettings(candidate.settings);
    if (
      (version !== 1 &&
        version !== 2 &&
        version !== 3 &&
        version !== 4 &&
        version !== 5 &&
        version !== 6) ||
      !settings
    )
      return null;
    if (version === 6) {
      const topLevelPostgameReview = normalizePostgameReview(
        candidate.postgameReview,
      );
      const recovery =
        candidate.recovery === undefined
          ? undefined
          : parseRecoverySnapshot(candidate.recovery);
      if (recovery === null) return null;
      const parsedWorkspace = parseWorkspace(candidate.workspace);
      const workspace = parsedWorkspace
        ? migrateLegacyRecovery(
            parsedWorkspace.postgameReview !== undefined ||
              topLevelPostgameReview === undefined
              ? parsedWorkspace
              : {
                  ...parsedWorkspace,
                  postgameReview: topLevelPostgameReview,
                },
            recovery,
          )
        : null;
      if (!workspace) return null;
      const main = workspace.lines.find(
        (line) => line.id === workspace.mainLineId,
      )!;
      const postgameReview = workspace.postgameReview;
      return {
        version: 6,
        settings,
        workspace,
        ...(postgameReview === undefined ? {} : { postgameReview }),
        session: main.timeline.session,
        cursor: main.timeline.cursor,
        annotations: main.annotations,
        feedbackByPly: main.feedbackByPly,
        savedAt: typeof candidate.savedAt === "string" ? candidate.savedAt : "",
      };
    }
    if (!isSessionShape(candidate.session)) return null;
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
    const main = createSessionWorkspace(session);
    const migratedMain: SessionLine = {
      ...main.lines[0]!,
      timeline: { session, cursor },
      annotations: validAnnotations(session, annotations),
      feedbackByPly: Object.freeze(persistedFeedback),
    };
    const trial =
      recovery === undefined || recovery === null
        ? []
        : [
            {
              id: "trial-1",
              timeline: { session: recovery.session, cursor: recovery.cursor },
              annotations: recovery.annotations,
              feedbackByPly: recovery.feedbackByPly,
              fork: { lineId: "main", ply: recovery.cursor },
              revision: 0,
            } satisfies SessionLine,
          ];
    const workspace = migrateLegacyRecovery(
      {
        ...main,
        lines: [migratedMain, ...trial],
        activeLineId: trial.length ? "trial-1" : "main",
      },
      undefined,
    );
    const postgameReview = workspace.postgameReview;
    return {
      version: 6,
      settings,
      workspace,
      ...(postgameReview === undefined ? {} : { postgameReview }),
      session,
      cursor,
      annotations: migratedMain.annotations,
      feedbackByPly: migratedMain.feedbackByPly,
      savedAt: typeof candidate.savedAt === "string" ? candidate.savedAt : "",
    };
  } catch {
    return null;
  }
}

export function saveStoredGame(
  workspace: SessionWorkspace | GameSession,
  settings: GameSettings,
  storage: Storage = localStorage,
  annotations: readonly MoveQualityAnnotation[] = [],
  feedbackByPly: readonly MoveFeedbackRecord[] = [],
  cursor?: number,
): void {
  const normalizedWorkspace: SessionWorkspace =
    "version" in workspace
      ? workspace
      : (() => {
          const base = createSessionWorkspace(workspace);
          const main = base.lines[0]!;
          const mainLine = {
            ...main,
            timeline: {
              session: workspace,
              cursor: cursor ?? workspace.history.length,
            },
            annotations,
            feedbackByPly,
          };
          return {
            ...base,
            lines: [mainLine],
            activeLineId: "main",
          };
        })();
  const main = normalizedWorkspace.lines.find(
    (line) => line.id === normalizedWorkspace.mainLineId,
  )!;
  const stored: StoredGame = {
    version: 6,
    settings,
    workspace: normalizeWorkspace(normalizedWorkspace),
    ...(normalizedWorkspace.postgameReview === undefined
      ? {}
      : { postgameReview: normalizedWorkspace.postgameReview }),
    session: main.timeline.session,
    cursor: main.timeline.cursor,
    annotations: main.annotations,
    feedbackByPly: main.feedbackByPly,
    savedAt: new Date().toISOString(),
  };
  storage.setItem(STORAGE_KEY, JSON.stringify(stored));
}

function parseWorkspace(value: unknown): SessionWorkspace | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<SessionWorkspace>;
  if (
    candidate.version !== 6 ||
    !Array.isArray(candidate.lines) ||
    typeof candidate.mainLineId !== "string" ||
    typeof candidate.activeLineId !== "string" ||
    !Number.isInteger(candidate.revision) ||
    candidate.lines.length < 1
  )
    return null;
  const ids = new Set<string>();
  const lines: SessionLine[] = [];
  for (const raw of candidate.lines) {
    if (!raw || typeof raw !== "object") continue;
    const line = raw as Partial<SessionLine>;
    if (
      typeof line.id !== "string" ||
      !line.id ||
      ids.has(line.id) ||
      !line.timeline ||
      !isSessionShape(line.timeline.session) ||
      !validCursor(line.timeline.session, line.timeline.cursor) ||
      !Array.isArray(line.annotations) ||
      !Array.isArray(line.feedbackByPly) ||
      !Number.isInteger(line.revision)
    ) {
      if (line.id === candidate.mainLineId) return null;
      continue;
    }
    if (
      line.fork !== undefined &&
      (!line.fork ||
        typeof line.fork.lineId !== "string" ||
        !Number.isInteger(line.fork.ply) ||
        line.fork.ply < 0)
    ) {
      if (line.id === candidate.mainLineId) return null;
      continue;
    }
    const timeline = line.timeline;
    const revision = line.revision;
    if (!timeline || revision === undefined) {
      if (line.id === candidate.mainLineId) return null;
      continue;
    }
    ids.add(line.id);
    lines.push({
      id: line.id,
      timeline: { session: timeline.session, cursor: timeline.cursor },
      annotations: validAnnotations(
        timeline.session,
        line.annotations.filter(isMoveQualityAnnotation),
      ),
      feedbackByPly: normalizeVisibleFeedback(
        validFeedback(
          timeline.session,
          line.feedbackByPly.filter(isMoveFeedbackRecord),
        ).map((record) =>
          record.status === "pending"
            ? { ...record, status: "unavailable" as const }
            : record,
        ),
      ),
      ...(line.fork === undefined ? {} : { fork: line.fork }),
      revision,
    });
  }
  const main = lines.find((line) => line.id === candidate.mainLineId);
  if (!main || main.fork !== undefined) return null;
  const lineMap = new Map(lines.map((line) => [line.id, line] as const));
  const kept = new Set<string>([main.id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const line of lines) {
      if (kept.has(line.id) || line.id === main.id) continue;
      if (!line.fork) continue;
      const parent = lineMap.get(line.fork.lineId);
      if (!parent || !kept.has(parent.id)) continue;
      if (
        !hasSharedPrefix(
          parent.timeline.session,
          line.timeline.session,
          line.fork.ply,
        )
      )
        continue;
      kept.add(line.id);
      changed = true;
    }
  }
  const recoveredLines = lines.filter((line) => kept.has(line.id));
  const activeLineId = kept.has(candidate.activeLineId)
    ? candidate.activeLineId
    : candidate.mainLineId;
  const postgameReview = normalizePostgameReview(candidate.postgameReview);
  return {
    version: 6,
    mainLineId: candidate.mainLineId,
    activeLineId,
    revision: candidate.revision!,
    lines: recoveredLines,
    ...(postgameReview === undefined ? {} : { postgameReview }),
  };
}

function normalizeWorkspace(workspace: SessionWorkspace): SessionWorkspace {
  const parsed = parseWorkspace(workspace);
  if (!parsed) throw new RangeError("The session workspace is invalid");
  return parsed;
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
