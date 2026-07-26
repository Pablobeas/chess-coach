import type { GameSession } from "@chess-coach/chess-core";
import {
  activeSessionLine,
  createTrialLine,
  deleteSessionLine,
  navigateSessionLine,
  promoteSessionLineAndDeleteFormerMain,
  selectSessionLine,
  updateActiveSessionLine,
  type SessionLine,
  type SessionWorkspace,
} from "./sessionWorkspace";
import { replaceNavigationLine } from "./navigationTimeline";

export interface AnalysisRequestIdentity {
  readonly lineId: string;
  readonly lineRevision: number;
  readonly workspaceRevision: number;
  readonly requestId: string;
}

export function createAnalysisRequestIdentity(
  workspace: SessionWorkspace,
  requestId: string,
): AnalysisRequestIdentity {
  const line = activeSessionLine(workspace);
  return {
    lineId: line.id,
    lineRevision: line.revision,
    workspaceRevision: workspace.revision,
    requestId,
  };
}

export function acceptsAnalysisResult(
  workspace: SessionWorkspace,
  identity: AnalysisRequestIdentity,
  requestId: string,
): boolean {
  const line = activeSessionLine(workspace);
  return (
    line.id === identity.lineId &&
    identity.requestId === requestId &&
    line.revision >= identity.lineRevision &&
    line.revision <= identity.lineRevision + 1 &&
    workspace.revision >= identity.workspaceRevision &&
    workspace.revision <= identity.workspaceRevision + 1
  );
}

export type ContinueMove =
  | { readonly kind: "replay"; readonly workspace: SessionWorkspace }
  | { readonly kind: "fork"; readonly workspace: SessionWorkspace };

function sameHistory(left: GameSession, right: GameSession): boolean {
  return (
    left.history.length === right.history.length &&
    left.history.every((move, index) => move.uci === right.history[index]?.uci)
  );
}

function mergeAnnotations(
  target: SessionLine["annotations"],
  source: SessionLine["annotations"],
): SessionLine["annotations"] {
  const merged = new Map<string, SessionLine["annotations"][number]>(
    target.map((entry) => [`${entry.historyIndex}:${entry.uci}`, entry] as const),
  );
  for (const entry of source) {
    const key = `${entry.historyIndex}:${entry.uci}`;
    if (!merged.has(key)) merged.set(key, entry);
  }
  return [...merged.values()].sort((left, right) =>
    left.historyIndex - right.historyIndex || left.uci.localeCompare(right.uci),
  );
}

function feedbackRank(status: "pending" | "ready" | "unavailable"): number {
  switch (status) {
    case "ready":
      return 3;
    case "pending":
      return 2;
    default:
      return 1;
  }
}

function mergeFeedback(
  target: SessionLine["feedbackByPly"],
  source: SessionLine["feedbackByPly"],
): SessionLine["feedbackByPly"] {
  const merged = new Map<string, SessionLine["feedbackByPly"][number]>(
    target.map((entry) => [
      `${entry.historyIndex}:${entry.uci}:${entry.actor}:${entry.beforeFen}:${entry.afterFen}`,
      entry,
    ] as const),
  );
  for (const entry of source) {
    const key = `${entry.historyIndex}:${entry.uci}:${entry.actor}:${entry.beforeFen}:${entry.afterFen}`;
    const current = merged.get(key);
    if (!current || feedbackRank(entry.status) > feedbackRank(current.status))
      merged.set(key, entry);
  }
  return [...merged.values()].sort((left, right) =>
    left.historyIndex - right.historyIndex || left.uci.localeCompare(right.uci),
  );
}

function replaceSessionLine(
  workspace: SessionWorkspace,
  lineId: string,
  update: (line: SessionLine) => SessionLine,
): SessionWorkspace {
  const current = workspace.lines.find((line) => line.id === lineId);
  if (!current) return workspace;
  const next = update(current);
  if (next.id !== current.id)
    throw new Error("A line identity cannot be changed");
  return {
    ...workspace,
    revision: workspace.revision + 1,
    lines: workspace.lines.map((line) =>
      line.id === lineId ? { ...next, revision: current.revision + 1 } : line,
    ),
  };
}

export function historicalContinuationCandidate(
  workspace: SessionWorkspace,
  session: GameSession,
): SessionLine | undefined {
  const active = activeSessionLine(workspace);
  return workspace.lines.find(
    (line) =>
      line.id !== active.id && sameHistory(line.timeline.session, session),
  );
}

function shouldAutoPromote(line: SessionLine, workspace: SessionWorkspace): boolean {
  if (line.id === workspace.mainLineId || !line.fork) return false;
  if (line.timeline.session.isGameOver) return true;
  const main = workspace.lines.find((item) => item.id === workspace.mainLineId);
  if (!main) throw new Error("The main session line is missing");
  const trialAfterFork = line.timeline.session.history.length - line.fork.ply;
  const mainAfterFork = Math.max(
    0,
    main.timeline.session.history.length - line.fork.ply,
  );
  return trialAfterFork >= mainAfterFork + 2;
}

export function syncActiveLineSession(
  workspace: SessionWorkspace,
  nextSession: GameSession,
): SessionWorkspace {
  const updated = updateActiveSessionLine(workspace, (line) => ({
    ...line,
    timeline: replaceNavigationLine(nextSession),
  }));
  const active = activeSessionLine(updated);
  const duplicate = historicalContinuationCandidate(updated, nextSession);
  const merged = duplicate
    ? deleteSessionLine(
        selectSessionLine(
          replaceSessionLine(updated, duplicate.id, (line) => ({
            ...line,
            timeline: replaceNavigationLine(nextSession),
            annotations: mergeAnnotations(line.annotations, active.annotations),
            feedbackByPly: mergeFeedback(
              line.feedbackByPly,
              active.feedbackByPly,
            ),
          })),
          duplicate.id,
        ),
        active.id,
      )
    : updated;
  const current = activeSessionLine(merged);
  return shouldAutoPromote(current, merged)
    ? promoteSessionLineAndDeleteFormerMain(merged, current.id)
    : merged;
}

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
      workspace: syncActiveLineSession(forked, nextSession),
    };
  }
  return {
    kind: "fork",
    workspace: syncActiveLineSession(workspace, nextSession),
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
