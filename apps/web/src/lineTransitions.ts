import type { GameSession } from "@chess-coach/chess-core";
import {
  activeSessionLine,
  createTrialLine,
  navigateSessionLine,
  updateActiveSessionLine,
  type SessionWorkspace,
} from "./sessionWorkspace";
import { replaceNavigationLine } from "./navigationTimeline";

export interface AnalysisRequestIdentity {
  readonly lineId: string;
  readonly revision: number;
  readonly requestId: string;
}

export function createAnalysisRequestIdentity(
  workspace: SessionWorkspace,
  requestId: string,
): AnalysisRequestIdentity {
  const line = activeSessionLine(workspace);
  return { lineId: line.id, revision: line.revision, requestId };
}

export function acceptsAnalysisResult(
  workspace: SessionWorkspace,
  identity: AnalysisRequestIdentity,
  requestId: string,
): boolean {
  const line = activeSessionLine(workspace);
  // Revisions change when the same line publishes pending feedback, Maia's
  // reply or annotations. The active line and request id are the stable fence;
  // App invalidates the queue on line switch and promotion.
  return line.id === identity.lineId && identity.requestId === requestId;
}

export type ContinueMove =
  | { readonly kind: "replay"; readonly workspace: SessionWorkspace }
  | { readonly kind: "fork"; readonly workspace: SessionWorkspace };

/** Replays the exact stored continuation; every different move forks first. */
export function continueMoveFromCursor(
  workspace: SessionWorkspace,
  from: string,
  to: string,
  nextSession: GameSession,
  id: string,
): ContinueMove {
  const line = activeSessionLine(workspace);
  const existing = line.timeline.session.history[line.timeline.cursor];
  if (existing?.from === from && existing.to === to)
    return {
      kind: "replay",
      workspace: navigateSessionLine(workspace, line.timeline.cursor + 1),
    };
  if (line.timeline.cursor < line.timeline.session.history.length) {
    const forked = createTrialLine(workspace, id);
    return {
      kind: "fork",
      workspace: updateActiveSessionLine(forked, (trial) => ({
        ...trial,
        timeline: replaceNavigationLine(nextSession),
      })),
    };
  }
  return {
    kind: "fork",
    workspace: updateActiveSessionLine(workspace, (current) => ({
      ...current,
      timeline: replaceNavigationLine(nextSession),
    })),
  };
}

/** Statistics and exports remain anchored to the main game until promotion. */
export function exportSessionForWorkspace(
  workspace: SessionWorkspace,
): GameSession {
  const main = workspace.lines.find((line) => line.id === workspace.mainLineId);
  if (!main) throw new Error("The main session line is missing");
  return main.timeline.session;
}

/** Provisional annotations belong to the rendered line and never survive a switch. */
export function clearProvisionalForLineChange<T>(): T | undefined {
  return undefined;
}
