import { sessionAtPly, type GameSession } from "@chess-coach/chess-core";
import type { MoveFeedbackRecord, MoveQualityAnnotation } from "./persistence";
import {
  createNavigationTimeline,
  moveNavigationCursor,
  type NavigationTimeline,
} from "./navigationTimeline";

export const MAX_TRIAL_LINES = 5;

export interface SessionLine {
  readonly id: string;
  readonly timeline: NavigationTimeline;
  readonly annotations: readonly MoveQualityAnnotation[];
  readonly feedbackByPly: readonly MoveFeedbackRecord[];
  /** The position in the source line where this continuation began. */
  readonly fork?: { readonly lineId: string; readonly ply: number };
  readonly revision: number;
  readonly promotionPromptShown?: boolean;
}

export interface SessionWorkspace {
  readonly version: 6;
  readonly mainLineId: string;
  readonly activeLineId: string;
  readonly lines: readonly SessionLine[];
  readonly revision: number;
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
  if (trialLines(workspace).length >= MAX_TRIAL_LINES)
    throw new RangeError("Delete a trial line before creating another one");
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
  return {
    ...workspace,
    activeLineId: id,
    revision: workspace.revision + 1,
    lines: [...workspace.lines, line],
  };
}

export function deleteSessionLine(
  workspace: SessionWorkspace,
  lineId: string,
): SessionWorkspace {
  if (lineId === workspace.mainLineId)
    throw new Error("The main line cannot be deleted");
  if (!workspace.lines.some((line) => line.id === lineId)) return workspace;
  const nextLines = workspace.lines.filter((line) => line.id !== lineId);
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

/** Makes a trial the main game while retaining the former main as a trial. */
export function promoteSessionLine(
  workspace: SessionWorkspace,
  lineId: string,
): SessionWorkspace {
  if (lineId === workspace.mainLineId) return workspace;
  const target = workspace.lines.find((line) => line.id === lineId);
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
          promotionPromptShown: true,
        };
      }
      if (line.id === formerMain.id)
        return {
          ...line,
          fork: {
            lineId: target.id,
            ply: Math.min(
              target.timeline.cursor,
              line.timeline.session.history.length,
            ),
          },
          revision: line.revision + 1,
        };
      return line;
    }),
  };
}

export function shouldPromptPromotion(workspace: SessionWorkspace): boolean {
  const line = activeSessionLine(workspace);
  if (
    line.id === workspace.mainLineId ||
    line.promotionPromptShown ||
    !line.fork
  )
    return false;
  const main = mainSessionLine(workspace);
  const trialAfterFork = line.timeline.session.history.length - line.fork.ply;
  const mainAfterFork = Math.max(
    0,
    main.timeline.session.history.length - line.fork.ply,
  );
  const terminal = line.timeline.session.isGameOver;
  return terminal || trialAfterFork >= mainAfterFork + 4;
}

export function dismissPromotionPrompt(
  workspace: SessionWorkspace,
): SessionWorkspace {
  return updateActiveSessionLine(workspace, (line) => ({
    ...line,
    promotionPromptShown: true,
  }));
}
