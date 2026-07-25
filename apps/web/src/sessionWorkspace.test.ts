import { applyMove, createInitialGame } from "@chess-coach/chess-core";
import { describe, expect, it } from "vitest";
import {
  activeSessionLine,
  createSessionWorkspace,
  createTrialLine,
  deleteSessionLine,
  navigateSessionLine,
  promoteSessionLine,
  trialLines,
  updateActiveSessionLine,
} from "./sessionWorkspace";

const afterE4 = () => applyMove(createInitialGame(), { from: "e2", to: "e4" });

describe("SessionWorkspace", () => {
  it("navigates without creating a trial and forks only explicitly", () => {
    const workspace = navigateSessionLine(createSessionWorkspace(afterE4()), 0);
    expect(workspace.lines).toHaveLength(1);
    const forked = createTrialLine(workspace, "trial-1");
    expect(activeSessionLine(forked).timeline.session.history).toHaveLength(0);
    expect(activeSessionLine(forked).fork).toEqual({ lineId: "main", ply: 0 });
  });

  it("keeps the main line when a trial is deleted and promotes reversibly", () => {
    const trial = createTrialLine(createSessionWorkspace(afterE4()), "trial-1");
    const promoted = promoteSessionLine(trial, "trial-1");
    expect(promoted.mainLineId).toBe("trial-1");
    expect(trialLines(promoted).map((line) => line.id)).toEqual(["main"]);
    expect(promoteSessionLine(promoted, "main").mainLineId).toBe("main");
    expect(deleteSessionLine(promoted, "main").mainLineId).toBe("trial-1");
  });

  it("requires an explicit deletion after five trial lines", () => {
    let workspace = createSessionWorkspace(createInitialGame());
    for (let index = 1; index <= 5; index += 1)
      workspace = createTrialLine(workspace, `trial-${index}`);
    expect(() => createTrialLine(workspace, "trial-6")).toThrow(RangeError);
  });

  it("copies existing feedback into a trial and keeps subsequent feedback isolated", () => {
    const source = updateActiveSessionLine(
      createSessionWorkspace(afterE4()),
      (line) => ({
        ...line,
        annotations: [{ historyIndex: 0, uci: "e2e4", label: "excellent" }],
        feedbackByPly: [
          {
            historyIndex: 0,
            uci: "e2e4",
            actor: "user",
            beforeFen: createInitialGame().fen,
            afterFen: afterE4().fen,
            status: "unavailable",
          },
        ],
      }),
    );
    const trial = createTrialLine(source, "trial-1");
    expect(activeSessionLine(trial).feedbackByPly).toHaveLength(1);
    const changed = updateActiveSessionLine(trial, (line) => ({
      ...line,
      feedbackByPly: [],
    }));
    expect(activeSessionLine(changed).feedbackByPly).toEqual([]);
    expect(source.lines[0]?.feedbackByPly).toHaveLength(1);
  });

  it("selects the promoted line and returns to main when deleting the active trial", () => {
    let workspace = createTrialLine(
      createSessionWorkspace(afterE4()),
      "trial-1",
    );
    workspace = createTrialLine(workspace, "trial-2");
    const promoted = promoteSessionLine(workspace, "trial-1");
    expect(promoted.activeLineId).toBe("trial-1");
    const activeTrial = createTrialLine(promoted, "trial-3");
    const deleted = deleteSessionLine(activeTrial, "trial-3");
    expect(deleted.activeLineId).toBe("trial-1");
  });
});
