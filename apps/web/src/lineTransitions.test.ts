import { applyMove, createInitialGame } from "@chess-coach/chess-core";
import { describe, expect, it } from "vitest";
import {
  createAnalysisRequestIdentity,
  acceptsAnalysisResult,
  continueMoveFromCursor,
  clearProvisionalForLineChange,
  syncActiveLineSession,
  exportSessionForWorkspace,
} from "./lineTransitions";
import {
  createSessionWorkspace,
  createTrialLine,
  deleteSessionLine,
  navigateSessionLine,
  promoteSessionLine,
  selectSessionLine,
  updateActiveSessionLine,
} from "./sessionWorkspace";

describe("line transitions", () => {
  it("merges an identical historical continuation but keeps a divergent reply", () => {
    const e4 = applyMove(createInitialGame(), { from: "e2", to: "e4" });
    const e5 = applyMove(e4, { from: "e7", to: "e5" });
    let workspace = navigateSessionLine(createSessionWorkspace(e5), 1);
    const identical = continueMoveFromCursor(
      workspace,
      "e7",
      "e5",
      e5,
      "trial-2",
    );
    expect(identical.kind).toBe("replay");
    workspace = identical.workspace;
    const d5 = applyMove(e4, { from: "d7", to: "d5" });
    const divergent = continueMoveFromCursor(
      navigateSessionLine(workspace, 1),
      "d7",
      "d5",
      d5,
      "trial-3",
    );
    expect(divergent.kind).toBe("fork");
    expect(divergent.workspace.lines.length).toBeGreaterThanOrEqual(2);
  });

  it("replays an exact continuation and forks a different continuation", () => {
    const e4 = applyMove(createInitialGame(), { from: "e2", to: "e4" });
    const atStart = navigateSessionLine(createSessionWorkspace(e4), 0);
    const replay = continueMoveFromCursor(atStart, "e2", "e4", e4, "trial-1");
    expect(replay.kind).toBe("replay");
    expect(replay.workspace.lines).toHaveLength(1);
    const d4 = applyMove(createInitialGame(), { from: "d2", to: "d4" });
    const fork = continueMoveFromCursor(atStart, "d2", "d4", d4, "trial-1");
    expect(fork.kind).toBe("fork");
    expect(fork.workspace.lines).toHaveLength(2);
    expect(fork.workspace.lines[0]?.timeline.session.history[0]?.uci).toBe(
      "e2e4",
    );
  });

  it("rejects late results after switching or promoting a line", () => {
    const workspace = createSessionWorkspace(createInitialGame());
    const identity = createAnalysisRequestIdentity(
      updateActiveSessionLine(workspace, (line) => ({
        ...line,
        timeline: {
          session: applyMove(createInitialGame(), { from: "e2", to: "e4" }),
          cursor: 1,
        },
      })),
      "coach-1",
      "user",
    );
    const trial = createTrialLine(workspace, "trial-1");
    expect(acceptsAnalysisResult(trial, identity, "coach-1")).toBe(false);
    const promoted = promoteSessionLine(trial, "trial-1");
    expect(acceptsAnalysisResult(promoted, identity, "coach-1")).toBe(false);
  });

  it("accepts a response after multiple revisions of the same line, including the rival reply", () => {
    const afterUserMove = applyMove(createInitialGame(), {
      from: "e2",
      to: "e4",
    });
    const workspace = createSessionWorkspace(afterUserMove);
    const identity = createAnalysisRequestIdentity(
      workspace,
      "coach-1",
      "user",
    );
    expect(identity).toMatchObject({
      lineId: "main",
      lineRole: "main",
      historyIndex: 0,
      ply: 1,
      actor: "user",
      uci: "e2e4",
      beforeFen: createInitialGame().fen,
      afterFen: afterUserMove.fen,
    });

    const annotated = updateActiveSessionLine(workspace, (line) => ({
      ...line,
      annotations: [{ historyIndex: 0, uci: "e2e4", label: "good" }],
      feedbackByPly: [
        {
          historyIndex: 0,
          uci: "e2e4",
          actor: "user",
          beforeFen: createInitialGame().fen,
          afterFen: createInitialGame().fen,
          status: "pending",
        },
      ],
    }));
    expect(acceptsAnalysisResult(annotated, identity, "coach-1")).toBe(true);

    const browsingHistory = navigateSessionLine(annotated, 0);
    expect(acceptsAnalysisResult(browsingHistory, identity, "coach-1")).toBe(
      true,
    );

    const rivalReply = syncActiveLineSession(
      annotated,
      applyMove(afterUserMove, { from: "e7", to: "e5" }),
    );
    expect(acceptsAnalysisResult(rivalReply, identity, "coach-1")).toBe(true);
    expect(acceptsAnalysisResult(rivalReply, identity, "coach-2")).toBe(false);
  });

  it("rejects a result when the exact move identity changes on the same line", () => {
    const e4 = applyMove(createInitialGame(), { from: "e2", to: "e4" });
    const workspace = createSessionWorkspace(e4);
    const identity = createAnalysisRequestIdentity(
      workspace,
      "coach-1",
      "user",
    );

    const changed = updateActiveSessionLine(workspace, (line) => ({
      ...line,
      timeline: {
        session: applyMove(createInitialGame(), { from: "d2", to: "d4" }),
        cursor: 1,
      },
    }));

    expect(acceptsAnalysisResult(changed, identity, "coach-1")).toBe(false);
  });

  it("rejects a result after deleting or merging away the originating line", () => {
    const e4 = applyMove(createInitialGame(), { from: "e2", to: "e4" });
    const base = navigateSessionLine(createSessionWorkspace(e4), 1);
    const trial = updateActiveSessionLine(
      createTrialLine(base, "trial-1"),
      (line) => ({
        ...line,
        timeline: { session: e4, cursor: 1 },
      }),
    );
    const identity = createAnalysisRequestIdentity(trial, "coach-1", "user");

    const deleted = deleteSessionLine(trial, "trial-1");
    expect(acceptsAnalysisResult(deleted, identity, "coach-1")).toBe(false);

    const duplicate = updateActiveSessionLine(
      createTrialLine(
        navigateSessionLine(selectSessionLine(trial, "main"), 1),
        "trial-2",
      ),
      (line) => ({
        ...line,
        timeline: { session: e4, cursor: 1 },
      }),
    );
    const merged = syncActiveLineSession(duplicate, e4);
    expect(acceptsAnalysisResult(merged, identity, "coach-1")).toBe(false);
  });

  it("exports the main session while a different trial is active", () => {
    const e4 = applyMove(createInitialGame(), { from: "e2", to: "e4" });
    const d4 = applyMove(createInitialGame(), { from: "d2", to: "d4" });
    const workspace = updateActiveSessionLine(
      createTrialLine(
        navigateSessionLine(createSessionWorkspace(e4), 0),
        "trial-1",
      ),
      (line) => ({ ...line, timeline: { session: d4, cursor: 1 } }),
    );
    expect(exportSessionForWorkspace(workspace).history[0]?.uci).toBe("e2e4");
    expect(workspace.activeLineId).toBe("trial-1");
  });

  it("clears provisional feedback for select, promotion and deletion transitions", () => {
    const provisional = { historyIndex: 0, uci: "e2e4", label: "good" };
    const workspace = createTrialLine(
      createSessionWorkspace(createInitialGame()),
      "trial-1",
    );
    for (const next of [
      selectSessionLine(workspace, "main"),
      promoteSessionLine(workspace, "trial-1"),
      deleteSessionLine(workspace, "trial-1"),
    ]) {
      expect(next).toBeDefined();
      expect(
        clearProvisionalForLineChange<typeof provisional>(),
      ).toBeUndefined();
    }
  });

  it("merges an identical user and opponent continuation while preserving distinct replies", () => {
    const e4 = applyMove(createInitialGame(), { from: "e2", to: "e4" });
    const e4c5 = applyMove(e4, { from: "c7", to: "c5" });
    const e4e5 = applyMove(e4, { from: "e7", to: "e5" });

    let workspace = navigateSessionLine(createSessionWorkspace(e4), 1);
    workspace = updateActiveSessionLine(
      createTrialLine(workspace, "trial-1"),
      (line) => ({
        ...line,
        timeline: { session: e4c5, cursor: 2 },
      }),
    );
    workspace = navigateSessionLine(selectSessionLine(workspace, "main"), 1);
    workspace = updateActiveSessionLine(
      createTrialLine(workspace, "trial-2"),
      (line) => ({
        ...line,
        timeline: { session: e4, cursor: 1 },
      }),
    );

    const merged = syncActiveLineSession(workspace, e4c5);
    expect(merged.lines).toHaveLength(2);
    expect(merged.activeLineId).toBe("trial-1");
    expect(merged.lines.find((line) => line.id === "trial-2")).toBeUndefined();

    const base = updateActiveSessionLine(
      createTrialLine(
        navigateSessionLine(selectSessionLine(merged, "main"), 1),
        "trial-3",
      ),
      (line) => ({
        ...line,
        timeline: { session: e4, cursor: 1 },
      }),
    );
    const distinct = syncActiveLineSession(base, e4e5);
    expect(distinct.lines).toHaveLength(3);
    expect(distinct.activeLineId).toBe("trial-3");
    expect(exportSessionForWorkspace(distinct).history[0]?.uci).toBe("e2e4");
  });

  it("keeps a trial when it is not yet two plies beyond the current main from the same fork", () => {
    const e4 = applyMove(createInitialGame(), { from: "e2", to: "e4" });
    const e4e5 = applyMove(e4, { from: "e7", to: "e5" });
    const d4 = applyMove(createInitialGame(), { from: "d2", to: "d4" });
    const d4d5 = applyMove(d4, { from: "d7", to: "d5" });
    const d4d5c4 = applyMove(d4d5, { from: "c2", to: "c4" });
    const d4d5c4c6 = applyMove(d4d5c4, { from: "c7", to: "c6" });
    const workspace = createTrialLine(
      navigateSessionLine(createSessionWorkspace(e4e5), 0),
      "trial-1",
    );

    const trial = syncActiveLineSession(workspace, d4d5);
    expect(trial.mainLineId).toBe("main");
    expect(trial.lines).toHaveLength(2);
    expect(trial.activeLineId).toBe("trial-1");

    const promoted = syncActiveLineSession(trial, d4d5c4c6);
    expect(promoted.mainLineId).toBe("trial-1");
    expect(promoted.lines).toHaveLength(1);
    expect(
      exportSessionForWorkspace(promoted).history.map((move) => move.uci),
    ).toEqual(["d2d4", "d7d5", "c2c4", "c7c6"]);
  });

  it("auto-promotes a terminal trial immediately even when it is not two plies beyond main", () => {
    const e4 = applyMove(createInitialGame(), { from: "e2", to: "e4" });
    const e4e5 = applyMove(e4, { from: "e7", to: "e5" });
    const e4e5nf3 = applyMove(e4e5, { from: "g1", to: "f3" });
    const f3 = applyMove(createInitialGame(), { from: "f2", to: "f3" });
    const f3e5 = applyMove(f3, { from: "e7", to: "e5" });
    const f3e5g4 = applyMove(f3e5, { from: "g2", to: "g4" });
    const mate = applyMove(f3e5g4, { from: "d8", to: "h4" });
    const workspace = createTrialLine(
      navigateSessionLine(createSessionWorkspace(e4e5nf3), 0),
      "trial-1",
    );

    const promoted = syncActiveLineSession(workspace, mate);
    expect(promoted.mainLineId).toBe("trial-1");
    expect(promoted.lines).toHaveLength(1);
    expect(
      exportSessionForWorkspace(promoted).history.map((move) => move.uci),
    ).toEqual(["f2f3", "e7e5", "g2g4", "d8h4"]);
  });
});
