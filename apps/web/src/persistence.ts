import type { GameSession, PlayerColor } from "@chess-coach/chess-core";
import type { EnginePreset } from "@chess-coach/engine";
import type { CoachFeedback, MoveLabel } from "@chess-coach/coach";

export type HelpLevel = "none" | "normal" | "guided";

export interface GameSettings {
  readonly playerColor: PlayerColor | "random";
  readonly enginePreset: EnginePreset;
  readonly helpLevel: HelpLevel;
  readonly showEvaluation: boolean;
  readonly showArrows: boolean;
  readonly showThreats: boolean;
  readonly soundEnabled: boolean;
}

export interface MoveQualityAnnotation {
  readonly historyIndex: number;
  readonly uci: string;
  readonly label: MoveLabel;
}

export interface StoredGame {
  readonly version: 2;
  readonly settings: GameSettings;
  readonly session: GameSession;
  readonly annotations: readonly MoveQualityAnnotation[];
  readonly lastFeedback?: CoachFeedback;
  readonly savedAt: string;
}

export const DEFAULT_SETTINGS: GameSettings = Object.freeze({
  playerColor: "white",
  enginePreset: "intermediate",
  helpLevel: "normal",
  showEvaluation: true,
  showArrows: true,
  showThreats: true,
  soundEnabled: false,
});

const STORAGE_KEY = "chess-coach:active-game:v1";

const moveLabels: readonly MoveLabel[] = [
  "excellent",
  "good",
  "inaccuracy",
  "mistake",
  "blunder",
];

function isGameSettings(value: unknown): value is GameSettings {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<GameSettings>;
  return (
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
    typeof candidate.showArrows === "boolean" &&
    typeof candidate.showThreats === "boolean" &&
    typeof candidate.soundEnabled === "boolean"
  );
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
    if (
      (version !== 1 && version !== 2) ||
      !isGameSettings(candidate.settings) ||
      !candidate.session ||
      typeof candidate.session.fen !== "string" ||
      typeof candidate.session.pgn !== "string"
    )
      return null;
    const session = candidate.session as GameSession;
    const annotations = Array.isArray(candidate.annotations)
      ? candidate.annotations.filter(isMoveQualityAnnotation)
      : [];
    return {
      version: 2,
      settings: candidate.settings,
      session,
      annotations: validAnnotations(session, annotations),
      ...(isCoachFeedback(candidate.lastFeedback)
        ? { lastFeedback: candidate.lastFeedback }
        : {}),
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
  lastFeedback?: CoachFeedback,
): void {
  const stored: StoredGame = {
    version: 2,
    session,
    settings,
    annotations: validAnnotations(session, annotations),
    ...(lastFeedback === undefined ? {} : { lastFeedback }),
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
