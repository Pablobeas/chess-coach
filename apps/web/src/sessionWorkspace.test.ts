import { applyMove, createInitialGame } from "@chess-coach/chess-core";
import { describe, expect, it } from "vitest";
import {
  activeSessionLine,
  createSessionWorkspace,
  createTrialLine,
  deleteSessionLine,
  navigateSessionLine,
  promoteSessionLine,
  selectSessionLine,
  trialLines,
  updateActiveSessionLine,
} from "./sessionWorkspace";

const afterE4 = () => applyMove(createInitialGame(), { from: "e2", to: "e4" });
const afterE4E5 = () => applyMove(afterE4(), { from: "e7", to: "e5" });
const afterE4E5Bc4 = () => applyMove(afterE4E5(), { from: "f1", to: "c4" });
const afterE4E5Bc4Bc5 = () =>
  applyMove(afterE4E5Bc4(), { from: "f8", to: "c5" });
const afterE4E5Bc4Nf6 = () =>
  applyMove(afterE4E5Bc4(), { from: "g8", to: "f6" });

function ancestryIds(workspace: ReturnType<typeof createSessionWorkspace>, lineId: string) {
  const ids: string[] = [];
  let current = workspace.lines.find((line) => line.id === lineId);
  for (let steps = 0; steps < workspace.lines.length + 1; steps += 1) {
    if (!current?.fork) return ids;
    ids.push(current.fork.lineId);
    current = workspace.lines.find((line) => line.id === current?.fork?.lineId);
  }
  throw new Error(`Infinite ancestry detected for ${lineId}`);
}

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

  it("prunes the oldest persisted trial automatically after five alternatives", () => {
    let workspace = createSessionWorkspace(createInitialGame());
    for (let index = 1; index <= 5; index += 1) {
      workspace = createTrialLine(workspace, `trial-${index}`);
      workspace = selectSessionLine(workspace, "main");
    }
    const pruned = createTrialLine(workspace, "trial-6");
    expect(pruned.lines).toHaveLength(6);
    expect(trialLines(pruned).map((line) => line.id)).toEqual([
      "trial-2",
      "trial-3",
      "trial-4",
      "trial-5",
      "trial-6",
    ]);
    expect(pruned.activeLineId).toBe("trial-6");
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

  it("reparents direct descendants to the remaining line with the longest shared prefix", () => {
    let workspace = navigateSessionLine(
      createSessionWorkspace(afterE4E5()),
      2,
    );
    workspace = updateActiveSessionLine(
      createTrialLine(workspace, "trial-a"),
      (line) => ({
        ...line,
        timeline: { session: afterE4E5Bc4(), cursor: 3 },
      }),
    );
    workspace = updateActiveSessionLine(
      createTrialLine(workspace, "trial-c"),
      (line) => ({
        ...line,
        timeline: { session: afterE4E5Bc4Nf6(), cursor: 4 },
      }),
    );
    workspace = navigateSessionLine(selectSessionLine(workspace, "main"), 2);
    workspace = updateActiveSessionLine(
      createTrialLine(workspace, "trial-b"),
      (line) => ({
        ...line,
        timeline: { session: afterE4E5Bc4Bc5(), cursor: 4 },
      }),
    );

    const deleted = deleteSessionLine(workspace, "trial-a");
    const reparanted = deleted.lines.find((line) => line.id === "trial-c");
    expect(reparanted?.fork).toEqual({ lineId: "trial-b", ply: 3 });
  });

  it("reparents multiple direct children without creating sibling cycles", () => {
    let workspace = navigateSessionLine(
      createSessionWorkspace(afterE4E5()),
      2,
    );
    workspace = updateActiveSessionLine(
      createTrialLine(workspace, "trial-a"),
      (line) => ({
        ...line,
        timeline: { session: afterE4E5Bc4(), cursor: 3 },
      }),
    );
    workspace = updateActiveSessionLine(
      createTrialLine(workspace, "trial-c1"),
      (line) => ({
        ...line,
        timeline: { session: afterE4E5Bc4Bc5(), cursor: 4 },
      }),
    );
    workspace = selectSessionLine(workspace, "trial-a");
    workspace = updateActiveSessionLine(
      createTrialLine(workspace, "trial-c2"),
      (line) => ({
        ...line,
        timeline: { session: afterE4E5Bc4Nf6(), cursor: 4 },
      }),
    );

    const deleted = deleteSessionLine(workspace, "trial-a");
    expect(deleted.lines.find((line) => line.id === "trial-c1")?.fork).toEqual({
      lineId: "main",
      ply: 2,
    });
    expect(deleted.lines.find((line) => line.id === "trial-c2")?.fork).toEqual({
      lineId: "main",
      ply: 2,
    });
    expect(ancestryIds(deleted, "trial-c1")).toEqual(["main"]);
    expect(ancestryIds(deleted, "trial-c2")).toEqual(["main"]);
  });
});
