import {
  applyMove,
  createInitialGame,
  listLegalMoves,
} from "@chess-coach/chess-core";
import { describe, expect, it } from "vitest";
import {
  createAnalysisRequestIdentity,
  acceptsAnalysisResult,
  continueMoveFromCursor,
  clearProvisionalForLineChange,
  exportSessionForWorkspace,
} from "./lineTransitions";
import {
  createSessionWorkspace,
  createTrialLine,
  deleteSessionLine,
  navigateSessionLine,
  promoteSessionLine,
  shouldPromptPromotion,
  selectSessionLine,
  updateActiveSessionLine,
} from "./sessionWorkspace";

describe("line transitions", () => {
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
    const identity = createAnalysisRequestIdentity(workspace, "coach-1");
    const trial = createTrialLine(workspace, "trial-1");
    expect(acceptsAnalysisResult(trial, identity, "coach-1")).toBe(false);
    const promoted = promoteSessionLine(trial, "trial-1");
    expect(acceptsAnalysisResult(promoted, identity, "coach-1")).toBe(false);
  });

  it("accepts a response after normal updates of the same line", () => {
    const workspace = createSessionWorkspace(createInitialGame());
    const identity = createAnalysisRequestIdentity(workspace, "coach-1");
    const normalUpdate = updateActiveSessionLine(workspace, (line) => ({
      ...line,
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
    expect(normalUpdate.lines[0]?.revision).toBeGreaterThan(identity.revision);
    expect(acceptsAnalysisResult(normalUpdate, identity, "coach-1")).toBe(true);
    expect(acceptsAnalysisResult(normalUpdate, identity, "coach-2")).toBe(
      false,
    );
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

  it("prompts once when a trial is four plies beyond its fork", () => {
    let workspace = createTrialLine(
      createSessionWorkspace(createInitialGame()),
      "trial-1",
    );
    let session = createInitialGame();
    for (let index = 0; index < 4; index += 1) {
      const move = listLegalMoves(session.fen)[0]!;
      session = applyMove(session, move);
    }
    workspace = updateActiveSessionLine(workspace, (line) => ({
      ...line,
      timeline: { session, cursor: session.history.length },
    }));
    expect(shouldPromptPromotion(workspace)).toBe(true);
  });
});
