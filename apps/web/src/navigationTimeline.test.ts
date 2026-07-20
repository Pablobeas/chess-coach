import {
  applyMove,
  loadPosition,
  replayHistory,
} from "@chess-coach/chess-core";
import { describe, expect, it } from "vitest";
import {
  continueNavigationFromCursor,
  createNavigationTimeline,
  moveNavigationCursor,
  sessionAtNavigationCursor,
} from "./navigationTimeline";

function sessionWithPlies(count: number) {
  let session = loadPosition("4k2r/8/8/8/8/8/8/R3K3 w - - 0 1");
  const cycle = ["a1a2", "h8h7", "a2a1", "h7h8"] as const;
  for (let index = 0; index < count; index += 1) {
    const uci = cycle[index % cycle.length]!;
    session = applyMove(session, {
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
    });
  }
  return session;
}

describe("compact navigation timeline", () => {
  it("keeps one complete 100-ply session while navigating with a cursor", () => {
    const fullSession = sessionWithPlies(100);
    const timeline = createNavigationTimeline(fullSession, 37);

    expect(Object.keys(timeline)).toEqual(["session", "cursor"]);
    expect(timeline.session).toBe(fullSession);
    expect(timeline.session.history).toHaveLength(100);
    const atThirtySeven = sessionAtNavigationCursor(timeline);
    expect(atThirtySeven.history).toHaveLength(37);
    expect(atThirtySeven.fen).toBe(replayHistory(fullSession)[36]?.afterFen);
    expect(atThirtySeven.pgn).toContain("19. Ra2");

    const redone = moveNavigationCursor(timeline, 100);
    expect(redone.session).toBe(fullSession);
    expect(sessionAtNavigationCursor(redone).fen).toBe(fullSession.fen);
  });

  it("creates a continuation by retaining only the cursor position", () => {
    const fullSession = sessionWithPlies(100);
    const branched = continueNavigationFromCursor(
      createNavigationTimeline(fullSession, 40),
    );

    expect(branched.cursor).toBe(40);
    expect(branched.session.history).toHaveLength(40);
    expect(branched.session.history).toEqual(fullSession.history.slice(0, 40));
    expect(fullSession.history).toHaveLength(100);
  });
});
