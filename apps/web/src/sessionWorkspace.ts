import { sessionAtPly, type GameSession } from "@chess-coach/chess-core";
import type { MoveFeedbackRecord, MoveQualityAnnotation } from "./persistence";
import {
  createNavigationTimeline,
  moveNavigationCursor,
  type NavigationTimeline,
} from "./navigationTimeline";
import type { PostgameReviewStateV1 } from "./postgameReview";

export const MAX_TRIAL_LINES = 5;

export interface SessionLine {
  readonly id: string;
  readonly timeline: NavigationTimeline;
  readonly annotations: readonly MoveQualityAnnotation[];
  readonly feedbackByPly: readonly MoveFeedbackRecord[];
  /** The position in the source line where this continuation began. */
  readonly fork?: { readonly lineId: string; readonly ply: number };
  readonly revision: number;
}

export interface SessionWorkspace {
  readonly version: 6;
  readonly mainLineId: string;
  readonly activeLineId: string;
  readonly lines: readonly SessionLine[];
  readonly revision: number;
  readonly postgameReview?: PostgameReviewStateV1;
}

export function createSessionWorkspace(session: GameSession): SessionWorkspace {
  return {
    version: 6,
    mainLineId: "main",
    activeLineId: "main",
    revision: 0,
    lines: [
      {
        id: "main",
        timeline: createNavigationTimeline(session),
        annotations: [],
        feedbackByPly: [],
        revision: 0,
      },
    ],
  };
}

export function activeSessionLine(workspace: SessionWorkspace): SessionLine {
  const line = workspace.lines.find(
    (item) => item.id === workspace.activeLineId,
  );
  if (!line) throw new Error("The active session line is missing");
  return line;
}

export function mainSessionLine(workspace: SessionWorkspace): SessionLine {
  const line = workspace.lines.find((item) => item.id === workspace.mainLineId);
  if (!line) throw new Error("The main session line is missing");
  return line;
}

export function trialLines(
  workspace: SessionWorkspace,
): readonly SessionLine[] {
  return workspace.lines.filter((line) => line.id !== workspace.mainLineId);
}

function sameMoveAtIndex(
  left: GameSession["history"],
  right: GameSession["history"],
  index: number,
): boolean {
  const leftMove = left[index];
  const rightMove = right[index];
  return (
    leftMove !== undefined &&
    rightMove !== undefined &&
    leftMove.uci === rightMove.uci
  );
}

function sharedHistoryLength(left: GameSession, right: GameSession): number {
  const max = Math.min(left.history.length, right.history.length);
  let index = 0;
  while (index < max && sameMoveAtIndex(left.history, right.history, index))
    index += 1;
  return index;
}

function lineById(
  workspace: SessionWorkspace,
  lineId: string,
): SessionLine | undefined {
  return workspace.lines.find((line) => line.id === lineId);
}

function isDescendantLine(
  workspace: SessionWorkspace,
  lineId: string,
  ancestorId: string,
): boolean {
  let current = lineById(workspace, lineId);
  while (current?.fork) {
    if (current.fork.lineId === ancestorId) return true;
    current = lineById(workspace, current.fork.lineId);
  }
  return false;
}

function replaceWorkspaceLine(
  workspace: SessionWorkspace,
  lineId: string,
  update: (line: SessionLine) => SessionLine,
): SessionWorkspace {
  const current = lineById(workspace, lineId);
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

function reparentedFork(
  workspace: SessionWorkspace,
  child: SessionLine,
  candidates: readonly SessionLine[],
): SessionLine["fork"] {
  const best =
    candidates.reduce<{
      readonly line: SessionLine;
      readonly sharedPly: number;
    } | null>((current, line) => {
      if (
        line.id === child.id ||
        isDescendantLine(workspace, line.id, child.id)
      )
        return current;
      const sharedPly = sharedHistoryLength(
        line.timeline.session,
        child.timeline.session,
      );
      if (!current || sharedPly > current.sharedPly) return { line, sharedPly };
      return current;
    }, null)?.line ?? mainSessionLine(workspace);
  return {
    lineId: best.id,
    ply: sharedHistoryLength(best.timeline.session, child.timeline.session),
  };
}

function deleteLineRecord(
  workspace: SessionWorkspace,
  lineId: string,
): SessionWorkspace {
  const existing = lineById(workspace, lineId);
  if (!existing) return workspace;
  const directChildren = workspace.lines.filter(
    (line) => line.fork?.lineId === lineId,
  );
  const directChildIds = new Set(directChildren.map((line) => line.id));
  const stableCandidates = workspace.lines.filter(
    (line) => line.id !== lineId && !directChildIds.has(line.id),
  );
  const nextLines = workspace.lines
    .filter((line) => line.id !== lineId)
    .map((line) => {
      if (line.fork?.lineId !== lineId) return line;
      const fork = reparentedFork(workspace, line, stableCandidates);
      return {
        ...line,
        ...(fork ? { fork } : {}),
        revision: line.revision + 1,
      };
    });
  return {
    ...workspace,
    lines: nextLines,
    activeLineId:
      workspace.activeLineId === lineId
        ? workspace.mainLineId
        : workspace.activeLineId,
    revision: workspace.revision + 1,
  };
}

function replaceLine(
  workspace: SessionWorkspace,
  replacement: SessionLine,
): SessionWorkspace {
  return {
    ...workspace,
    revision: workspace.revision + 1,
    lines: workspace.lines.map((line) =>
      line.id === replacement.id ? replacement : line,
    ),
  };
}

export function selectSessionLine(
  workspace: SessionWorkspace,
  lineId: string,
): SessionWorkspace {
  if (!workspace.lines.some((line) => line.id === lineId)) return workspace;
  return {
    ...workspace,
    activeLineId: lineId,
    revision: workspace.revision + 1,
  };
}

export function navigateSessionLine(
  workspace: SessionWorkspace,
  cursor: number,
): SessionWorkspace {
  const line = activeSessionLine(workspace);
  return replaceLine(workspace, {
    ...line,
    timeline: moveNavigationCursor(line.timeline, cursor),
    revision: line.revision + 1,
  });
}

export function updateActiveSessionLine(
  workspace: SessionWorkspace,
  update: (line: SessionLine) => SessionLine,
): SessionWorkspace {
  const current = activeSessionLine(workspace);
  const next = update(current);
  if (next.id !== current.id)
    throw new Error("A line identity cannot be changed");
  return replaceLine(workspace, { ...next, revision: current.revision + 1 });
}

export function createTrialLine(
  workspace: SessionWorkspace,
  id: string,
): SessionWorkspace {
  if (!id || workspace.lines.some((line) => line.id === id))
    throw new Error("The trial line id must be unique");
  const source = activeSessionLine(workspace);
  const session = sessionAtPly(source.timeline.session, source.timeline.cursor);
  const line: SessionLine = {
    id,
    timeline: createNavigationTimeline(session),
    annotations: source.annotations.filter(
      (item) => item.historyIndex < source.timeline.cursor,
    ),
    feedbackByPly: source.feedbackByPly.filter(
      (item) => item.historyIndex < source.timeline.cursor,
    ),
    fork: { lineId: source.id, ply: source.timeline.cursor },
    revision: 0,
  };
  const created: SessionWorkspace = {
    ...workspace,
    activeLineId: id,
    revision: workspace.revision + 1,
    lines: [...workspace.lines, line],
  };
  if (trialLines(created).length <= MAX_TRIAL_LINES) return created;
  const oldest = created.lines.find(
    (candidate) => candidate.id !== created.mainLineId && candidate.id !== id,
  );
  return oldest ? deleteLineRecord(created, oldest.id) : created;
}

export function deleteSessionLine(
  workspace: SessionWorkspace,
  lineId: string,
): SessionWorkspace {
  if (lineId === workspace.mainLineId)
    throw new Error("The main line cannot be deleted");
  return deleteLineRecord(workspace, lineId);
}

/** Makes a trial the main game while retaining the former main as a trial. */
export function promoteSessionLine(
  workspace: SessionWorkspace,
  lineId: string,
): SessionWorkspace {
  if (lineId === workspace.mainLineId) return workspace;
  const target = lineById(workspace, lineId);
  const formerMain = mainSessionLine(workspace);
  if (!target) return workspace;
  return {
    ...workspace,
    mainLineId: target.id,
    activeLineId: target.id,
    revision: workspace.revision + 1,
    lines: workspace.lines.map((line) => {
      if (line.id === target.id) {
        const { fork: _fork, ...mainLine } = line;
        return {
          ...mainLine,
          revision: line.revision + 1,
        };
      }
      if (line.id === formerMain.id)
        return {
          ...line,
          fork: {
            lineId: target.id,
            ply: sharedHistoryLength(
              target.timeline.session,
              line.timeline.session,
            ),
          },
          revision: line.revision + 1,
        };
      return line;
    }),
  };
}

export function promoteSessionLineAndDeleteFormerMain(
  workspace: SessionWorkspace,
  lineId: string,
): SessionWorkspace {
  if (lineId === workspace.mainLineId) return workspace;
  const target = lineById(workspace, lineId);
  const formerMain = mainSessionLine(workspace);
  if (!target) return workspace;
  const promoted = replaceWorkspaceLine(
    {
      ...workspace,
      mainLineId: target.id,
      activeLineId: target.id,
    },
    target.id,
    (line) => {
      const { fork: _fork, ...mainLine } = line;
      return mainLine;
    },
  );
  return deleteLineRecord(promoted, formerMain.id);
}
