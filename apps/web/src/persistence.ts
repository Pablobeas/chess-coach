import type { GameSession, PlayerColor } from "@chess-coach/chess-core";
import type { EnginePreset } from "@chess-coach/engine";

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

export interface StoredGame {
  readonly version: 1;
  readonly settings: GameSettings;
  readonly session: GameSession;
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

export function loadStoredGame(
  storage: Storage = localStorage,
): StoredGame | null {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const candidate = parsed as Partial<StoredGame>;
    if (
      candidate.version !== 1 ||
      !isGameSettings(candidate.settings) ||
      !candidate.session ||
      typeof candidate.session.fen !== "string" ||
      typeof candidate.session.pgn !== "string"
    )
      return null;
    return candidate as StoredGame;
  } catch {
    return null;
  }
}

export function saveStoredGame(
  session: GameSession,
  settings: GameSettings,
  storage: Storage = localStorage,
): void {
  const stored: StoredGame = {
    version: 1,
    session,
    settings,
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
