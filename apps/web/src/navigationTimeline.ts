import { sessionAtPly, type GameSession } from "@chess-coach/chess-core";

/**
 * The navigable line is deliberately stored once. The cursor is the only
 * transient navigation state; positions shown by the board are reconstructed
 * from the canonical session when needed.
 */
export interface NavigationTimeline {
  readonly session: GameSession;
  readonly cursor: number;
}

export function createNavigationTimeline(
  session: GameSession,
  cursor = session.history.length,
): NavigationTimeline {
  if (
    !Number.isInteger(cursor) ||
    cursor < 0 ||
    cursor > session.history.length
  )
    throw new RangeError(
      "The navigation cursor must be within the game history",
    );
  return { session, cursor };
}

export function sessionAtNavigationCursor(
  timeline: NavigationTimeline,
): GameSession {
  return sessionAtPly(timeline.session, timeline.cursor);
}

export function moveNavigationCursor(
  timeline: NavigationTimeline,
  cursor: number,
): NavigationTimeline {
  return createNavigationTimeline(timeline.session, cursor);
}

/** Drops the future only when the player explicitly starts a new continuation. */
export function continueNavigationFromCursor(
  timeline: NavigationTimeline,
): NavigationTimeline {
  return createNavigationTimeline(sessionAtNavigationCursor(timeline));
}

export function replaceNavigationLine(
  session: GameSession,
): NavigationTimeline {
  return createNavigationTimeline(session);
}
