import {
  applyMove,
  getCastlingRights,
  getMaterialSummary,
  getPieceAt,
  loadPosition,
  replayHistory,
  type GameSession,
  type PlayerColor,
} from "@chess-coach/chess-core";
import type { EngineLine, EngineScore } from "@chess-coach/engine";

/**
 * A deliberately small, replayable snapshot of the one line that ended the
 * game. Variations are intentionally not accepted here: a post-game report
 * must never mix moves from a line that did not reach the terminal position.
 */
export const FINAL_LINE_SNAPSHOT_SCHEMA_VERSION = 1 as const;
export const POSTGAME_POSITION_EVIDENCE_SCHEMA_VERSION = 1 as const;
export const POSTGAME_SUMMARY_SCHEMA_VERSION = 1 as const;
export const POSTGAME_PHASE_POLICY = "event-phases-v1" as const;
export const POSTGAME_SCORING_POLICY = "decision-stability-rms-v1" as const;

export type PostgameActor = "user" | "maia";
export type PostgamePhase = "opening" | "middlegame" | "ending";
export type PostgamePhaseStatus = "reached" | "not-reached" | "not-applicable";
export type DecisionBucket =
  "firm" | "acceptable" | "improvable" | "error" | "critical" | "no-margin";

export interface FinalLineParticipantV1 {
  readonly color: PlayerColor;
  readonly actor: PostgameActor;
}

export interface FinalLineMoveV1 {
  /** Zero-based index in the terminal line. */
  readonly index: number;
  readonly color: PlayerColor;
  readonly actor: PostgameActor;
  readonly uci: string;
  readonly san: string;
  readonly beforeFen: string;
  readonly afterFen: string;
}

export interface FinalLineSnapshotV1 {
  readonly schemaVersion: typeof FINAL_LINE_SNAPSHOT_SCHEMA_VERSION;
  readonly initialFen: string;
  readonly result: "checkmate";
  readonly winner: PlayerColor;
  readonly terminalFen: string;
  readonly participants: Readonly<{
    white: FinalLineParticipantV1;
    black: FinalLineParticipantV1;
  }>;
  readonly moves: readonly FinalLineMoveV1[];
}

/**
 * Engine observations connected to one actual move in FinalLineSnapshotV1.
 * Scores are calibrated only to compare decisions; they are not probabilities
 * shown to a player and are always marked by their source in the result.
 */
export interface PostgamePositionEvidenceV1 {
  readonly schemaVersion: typeof POSTGAME_POSITION_EVIDENCE_SCHEMA_VERSION;
  readonly moveIndex: number;
  readonly beforeFen: string;
  readonly afterFen: string;
  /** Perspective used in both engine requests. It may be either side. */
  readonly perspective: PlayerColor;
  readonly bestLine: EngineLine;
  readonly playedLine: EngineLine;
}

export const POSTGAME_STABILITY_THRESHOLDS = Object.freeze({
  /** Differences below this are ignored as engine noise. */
  engineNoiseExpectedScore: 0.015,
  firmExpectedLoss: 0.03,
  acceptableExpectedLoss: 0.08,
  improvableExpectedLoss: 0.16,
  errorExpectedLoss: 0.32,
  /** A side this far behind is reported without a judgement bucket. */
  noMarginBestExpectedScoreAtMost: 0.15,
  /** Converts RMS expected-score loss into the 0--100 stability scale. */
  rmsNormalizationExpectedLoss: 0.32,
  /** Material lead used only for an evidenced decisive tail. */
  decisiveMaterialCentipawns: 700,
  /** A decisive material lead must persist this many terminal plies. */
  decisiveTailMinimumPlies: 2,
} as const);

export interface DecisionSampleV1 {
  readonly moveIndex: number;
  readonly color: PlayerColor;
  readonly actor: PostgameActor;
  readonly phase: PostgamePhase;
  readonly expectedLoss: number;
  readonly source: "wdl" | "centipawn" | "mate";
  readonly bucket: DecisionBucket;
}

export interface DecisionStabilityV1 {
  readonly policy: typeof POSTGAME_SCORING_POLICY;
  readonly status: "scored" | "no-data" | "partial";
  readonly score?: number;
  readonly rmsExpectedLoss?: number;
  readonly coverage: {
    readonly available: number;
    readonly expected: number;
  };
  readonly decisionsScored: number;
  readonly noMargin: number;
  readonly buckets: Readonly<Record<DecisionBucket, number>>;
}

export interface PostgamePhaseSummaryV1 {
  readonly phase: PostgamePhase;
  readonly status: PostgamePhaseStatus;
  readonly moveIndexes: readonly number[];
  readonly white: DecisionStabilityV1;
  readonly black: DecisionStabilityV1;
}

export interface PostgameTrajectoryPointV1 {
  readonly moveIndex: number;
  readonly kind: "material-edge" | "checkmate";
  /** Grounded text for the review UI; it never asserts an engine probability. */
  readonly text: string;
}

export interface PostgameSummaryV1 {
  readonly schemaVersion: typeof POSTGAME_SUMMARY_SCHEMA_VERSION;
  readonly status: "complete" | "partial";
  readonly policies: Readonly<{
    phases: typeof POSTGAME_PHASE_POLICY;
    scoring: typeof POSTGAME_SCORING_POLICY;
  }>;
  readonly finalLine: FinalLineSnapshotV1;
  readonly phases: readonly PostgamePhaseSummaryV1[];
  readonly participants: Readonly<{
    white: FinalLineParticipantV1;
    black: FinalLineParticipantV1;
  }>;
  readonly trajectory: Readonly<{
    kind: "decisive-white" | "decisive-black" | "balanced-or-unclear";
    points: readonly PostgameTrajectoryPointV1[];
  }>;
}

type UnknownRecord = Record<string, unknown>;

const STANDARD_INITIAL_FEN =
  "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const COLORS: readonly PlayerColor[] = ["white", "black"];
const PHASES: readonly PostgamePhase[] = ["opening", "middlegame", "ending"];
const PIECE_CENTIPAWNS = Object.freeze({
  p: 100,
  n: 320,
  b: 330,
  r: 500,
  q: 900,
  k: 0,
});

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isColor(value: unknown): value is PlayerColor {
  return value === "white" || value === "black";
}

function isActor(value: unknown): value is PostgameActor {
  return value === "user" || value === "maia";
}

function opposite(color: PlayerColor): PlayerColor {
  return color === "white" ? "black" : "white";
}

function freeze<T>(value: T): T {
  if (Array.isArray(value)) {
    for (const item of value) freeze(item);
  } else if (isRecord(value)) {
    for (const item of Object.values(value)) freeze(item);
  }
  return Object.freeze(value);
}

function parseUci(uci: string):
  | {
      readonly from: string;
      readonly to: string;
      readonly promotion?: "q" | "r" | "b" | "n";
    }
  | undefined {
  const match = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/.exec(uci);
  if (!match) return undefined;
  const promotion = match[3] as "q" | "r" | "b" | "n" | undefined;
  return {
    from: match[1]!,
    to: match[2]!,
    ...(promotion === undefined ? {} : { promotion }),
  };
}

function readParticipant(
  value: unknown,
  color: PlayerColor,
): FinalLineParticipantV1 | undefined {
  if (!isRecord(value) || value.color !== color || !isActor(value.actor))
    return undefined;
  return freeze({ color, actor: value.actor });
}

function materialCentipawns(fen: string, color: PlayerColor): number {
  const count = getMaterialSummary(fen)[color].byType;
  return (
    Object.keys(PIECE_CENTIPAWNS) as (keyof typeof PIECE_CENTIPAWNS)[]
  ).reduce((total, type) => total + count[type] * PIECE_CENTIPAWNS[type], 0);
}

function nonPawnMaterialCentipawns(fen: string): number {
  const material = getMaterialSummary(fen);
  return COLORS.reduce((total, color) => {
    const count = material[color].byType;
    return (
      total + count.n * 320 + count.b * 330 + count.r * 500 + count.q * 900
    );
  }, 0);
}

function isMaterialEndgame(fen: string): boolean {
  const material = getMaterialSummary(fen);
  // A lone queen (or rook) versus a bare king is still an endgame. Two queens
  // normally keep the position in the middlegame, even if other material fell.
  return (
    material.white.byType.q + material.black.byType.q <= 1 &&
    nonPawnMaterialCentipawns(fen) <= 2_000
  );
}

function validEngineScore(value: unknown): value is EngineScore {
  return (
    isRecord(value) &&
    ((value.kind === "centipawns" &&
      typeof value.value === "number" &&
      Number.isFinite(value.value)) ||
      (value.kind === "mate" &&
        typeof value.moves === "number" &&
        Number.isInteger(value.moves)))
  );
}

function readEngineLine(value: unknown): EngineLine | undefined {
  if (
    !isRecord(value) ||
    !Number.isInteger(value.rank) ||
    (value.rank as number) < 1 ||
    !validEngineScore(value.score) ||
    !Array.isArray(value.moves) ||
    !value.moves.every((move) => typeof move === "string")
  )
    return undefined;
  const rank = value.rank as number;
  const scoreInput = value.score;
  let wdl: EngineLine["wdl"];
  if (value.wdl !== undefined) {
    if (
      !isRecord(value.wdl) ||
      ![value.wdl.wins, value.wdl.draws, value.wdl.losses].every(
        (part) =>
          typeof part === "number" && Number.isFinite(part) && part >= 0,
      ) ||
      (value.wdl.wins as number) +
        (value.wdl.draws as number) +
        (value.wdl.losses as number) <=
        0
    )
      return undefined;
    wdl = {
      wins: value.wdl.wins as number,
      draws: value.wdl.draws as number,
      losses: value.wdl.losses as number,
    };
  }
  const score =
    scoreInput.kind === "centipawns"
      ? { kind: "centipawns" as const, value: scoreInput.value }
      : { kind: "mate" as const, moves: scoreInput.moves };
  return freeze({
    rank,
    score,
    moves: [...value.moves] as string[],
    ...(wdl === undefined ? {} : { wdl }),
  });
}

/** Validates untrusted persisted engine evidence without trying to repair it. */
export function decodePostgamePositionEvidenceV1(
  value: unknown,
): PostgamePositionEvidenceV1 | undefined {
  if (
    !isRecord(value) ||
    value.schemaVersion !== POSTGAME_POSITION_EVIDENCE_SCHEMA_VERSION ||
    !Number.isInteger(value.moveIndex) ||
    (value.moveIndex as number) < 0 ||
    typeof value.beforeFen !== "string" ||
    typeof value.afterFen !== "string" ||
    !isColor(value.perspective)
  )
    return undefined;
  try {
    loadPosition(value.beforeFen);
    loadPosition(value.afterFen);
  } catch {
    return undefined;
  }
  const bestLine = readEngineLine(value.bestLine);
  const playedLine = readEngineLine(value.playedLine);
  if (!bestLine || !playedLine) return undefined;
  return freeze({
    schemaVersion: 1,
    moveIndex: value.moveIndex as number,
    beforeFen: value.beforeFen,
    afterFen: value.afterFen,
    perspective: value.perspective,
    bestLine,
    playedLine,
  });
}

/** Creates a terminal-only snapshot from an already validated game session. */
export function createFinalLineSnapshotV1(
  session: GameSession,
  actors: Readonly<Record<PlayerColor, PostgameActor>>,
): FinalLineSnapshotV1 {
  if (!session.isCheckmate)
    throw new RangeError("A post-game snapshot requires checkmate");
  if (session.history.length === 0)
    throw new RangeError("A post-game snapshot requires a mating move");
  const participants = freeze({
    white: { color: "white" as const, actor: actors.white },
    black: { color: "black" as const, actor: actors.black },
  });
  if (!isActor(participants.white.actor) || !isActor(participants.black.actor))
    throw new RangeError("Participants require known actors");
  const moves = replayHistory(session).map((entry) => {
    const color = loadPosition(entry.beforeFen).turn;
    return freeze({
      index: entry.historyIndex,
      color,
      actor: participants[color].actor,
      uci: entry.move.uci,
      san: entry.move.san,
      beforeFen: entry.beforeFen,
      afterFen: entry.afterFen,
    });
  });
  return freeze({
    schemaVersion: 1,
    initialFen: session.initialFen,
    result: "checkmate",
    winner: opposite(session.turn),
    terminalFen: session.fen,
    participants,
    moves,
  });
}

/**
 * Defensive decoder: it replays every UCI move and only accepts a line whose
 * positions, side to move, SAN and terminal mate are exact.
 */
export function decodeFinalLineSnapshotV1(
  value: unknown,
): FinalLineSnapshotV1 | undefined {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    value.result !== "checkmate" ||
    typeof value.initialFen !== "string" ||
    typeof value.terminalFen !== "string" ||
    !isColor(value.winner) ||
    !isRecord(value.participants) ||
    !Array.isArray(value.moves) ||
    value.moves.length === 0
  )
    return undefined;
  const white = readParticipant(value.participants.white, "white");
  const black = readParticipant(value.participants.black, "black");
  if (!white || !black) return undefined;
  let session: GameSession;
  try {
    session = loadPosition(value.initialFen);
  } catch {
    return undefined;
  }
  const moves: FinalLineMoveV1[] = [];
  for (const [index, rawMove] of value.moves.entries()) {
    if (
      !isRecord(rawMove) ||
      rawMove.index !== index ||
      !isColor(rawMove.color) ||
      !isActor(rawMove.actor) ||
      typeof rawMove.uci !== "string" ||
      typeof rawMove.san !== "string" ||
      typeof rawMove.beforeFen !== "string" ||
      typeof rawMove.afterFen !== "string" ||
      rawMove.beforeFen !== session.fen ||
      rawMove.color !== session.turn ||
      rawMove.actor !== (session.turn === "white" ? white.actor : black.actor)
    )
      return undefined;
    const parsed = parseUci(rawMove.uci);
    if (!parsed) return undefined;
    let after: GameSession;
    try {
      after = applyMove(session, parsed);
    } catch {
      return undefined;
    }
    const actualMove = after.history.at(-1);
    if (
      !actualMove ||
      actualMove.uci !== rawMove.uci ||
      actualMove.san !== rawMove.san ||
      after.fen !== rawMove.afterFen
    )
      return undefined;
    moves.push(
      freeze({
        index,
        color: session.turn,
        actor: rawMove.actor,
        uci: actualMove.uci,
        san: actualMove.san,
        beforeFen: session.fen,
        afterFen: after.fen,
      }),
    );
    session = after;
  }
  if (
    !session.isCheckmate ||
    session.fen !== value.terminalFen ||
    opposite(session.turn) !== value.winner
  )
    return undefined;
  return freeze({
    schemaVersion: 1,
    initialFen: value.initialFen,
    result: "checkmate",
    winner: value.winner,
    terminalFen: value.terminalFen,
    participants: { white, black },
    moves,
  });
}

function isStandardInitialFen(fen: string): boolean {
  return fen === STANDARD_INITIAL_FEN;
}

function openingEventValue(move: FinalLineMoveV1): number {
  const parsed = parseUci(move.uci);
  if (!parsed) return 0;
  let value = 0;
  const centralPawn =
    (move.color === "white" &&
      ((parsed.from === "d2" && ["d3", "d4"].includes(parsed.to)) ||
        (parsed.from === "e2" && ["e3", "e4"].includes(parsed.to)))) ||
    (move.color === "black" &&
      ((parsed.from === "d7" && ["d6", "d5"].includes(parsed.to)) ||
        (parsed.from === "e7" && ["e6", "e5"].includes(parsed.to))));
  if (centralPawn) value += 1;
  const minorHome =
    move.color === "white"
      ? ["b1", "g1", "c1", "f1"]
      : ["b8", "g8", "c8", "f8"];
  const movingPiece = getPieceAt(move.beforeFen, parsed.from);
  if (
    minorHome.includes(parsed.from) &&
    movingPiece?.color === move.color &&
    (movingPiece.type === "n" || movingPiece.type === "b")
  )
    value += 1;
  if (
    (parsed.from === "e1" && ["g1", "c1"].includes(parsed.to)) ||
    (parsed.from === "e8" && ["g8", "c8"].includes(parsed.to))
  )
    value += 2;
  const before = getCastlingRights(move.beforeFen)[move.color];
  const after = getCastlingRights(move.afterFen)[move.color];
  if (
    (before.kingside || before.queenside) &&
    !after.kingside &&
    !after.queenside &&
    !(
      (parsed.from === "e1" && ["g1", "c1"].includes(parsed.to)) ||
      (parsed.from === "e8" && ["g8", "c8"].includes(parsed.to))
    )
  )
    value += 0.5;
  const beforeMaterial =
    materialCentipawns(move.beforeFen, "white") +
    materialCentipawns(move.beforeFen, "black");
  const afterMaterial =
    materialCentipawns(move.afterFen, "white") +
    materialCentipawns(move.afterFen, "black");
  if (afterMaterial < beforeMaterial) value += 0.25;
  return value;
}

function endingStart(snapshot: FinalLineSnapshotV1): number | undefined {
  const materialIndex = snapshot.moves.findIndex((move) =>
    isMaterialEndgame(move.afterFen),
  );
  if (materialIndex >= 0) return materialIndex;
  const winner = snapshot.winner;
  let start = snapshot.moves.length;
  for (let index = snapshot.moves.length - 1; index >= 0; index -= 1) {
    const move = snapshot.moves[index]!;
    const lead =
      materialCentipawns(move.afterFen, winner) -
      materialCentipawns(move.afterFen, opposite(winner));
    if (lead < POSTGAME_STABILITY_THRESHOLDS.decisiveMaterialCentipawns) break;
    start = index;
  }
  return snapshot.moves.length - start >=
    POSTGAME_STABILITY_THRESHOLDS.decisiveTailMinimumPlies
    ? start
    : undefined;
}

/** Every terminal-line move gets one, and only one, phase. */
export function phaseFinalLine(
  snapshot: FinalLineSnapshotV1,
): readonly PostgamePhase[] {
  const decoded = decodeFinalLineSnapshotV1(snapshot);
  if (!decoded) throw new RangeError("Final line snapshot must be valid");
  const ending = endingStart(decoded);
  if (!isStandardInitialFen(decoded.initialFen))
    return freeze(
      decoded.moves.map((_, index) =>
        ending !== undefined && index >= ending ? "ending" : "middlegame",
      ),
    );
  let openingEnd = decoded.moves.length;
  let events = 0;
  for (const move of decoded.moves) {
    events += openingEventValue(move);
    if (move.index >= 5 && events >= 5) {
      openingEnd = move.index + 1;
      break;
    }
  }
  return freeze(
    decoded.moves.map((_, index) =>
      ending !== undefined && index >= ending
        ? "ending"
        : index < openingEnd
          ? "opening"
          : "middlegame",
    ),
  );
}

function expectedFromLine(line: EngineLine): {
  readonly value: number;
  readonly source: "wdl" | "centipawn" | "mate";
} {
  if (line.wdl !== undefined) {
    const total = line.wdl.wins + line.wdl.draws + line.wdl.losses;
    if (Number.isFinite(total) && total > 0)
      return {
        value: (line.wdl.wins + 0.5 * line.wdl.draws) / total,
        source: "wdl",
      };
  }
  if (line.score.kind === "mate")
    return {
      value: line.score.moves > 0 ? 1 : line.score.moves < 0 ? 0 : 0.5,
      source: "mate",
    };
  const bounded = Math.max(-10_000, Math.min(10_000, line.score.value));
  return { value: 1 / (1 + Math.exp(-bounded / 400)), source: "centipawn" };
}

function bucketFor(bestForActor: number, loss: number): DecisionBucket {
  if (
    bestForActor <=
    POSTGAME_STABILITY_THRESHOLDS.noMarginBestExpectedScoreAtMost
  )
    return "no-margin";
  const adjusted =
    loss <= POSTGAME_STABILITY_THRESHOLDS.engineNoiseExpectedScore ? 0 : loss;
  if (adjusted <= POSTGAME_STABILITY_THRESHOLDS.firmExpectedLoss) return "firm";
  if (adjusted <= POSTGAME_STABILITY_THRESHOLDS.acceptableExpectedLoss)
    return "acceptable";
  if (adjusted <= POSTGAME_STABILITY_THRESHOLDS.improvableExpectedLoss)
    return "improvable";
  if (adjusted <= POSTGAME_STABILITY_THRESHOLDS.errorExpectedLoss)
    return "error";
  return "critical";
}

function emptyBuckets(): Record<DecisionBucket, number> {
  return {
    firm: 0,
    acceptable: 0,
    improvable: 0,
    error: 0,
    critical: 0,
    "no-margin": 0,
  };
}

function scoreStability(
  samples: readonly DecisionSampleV1[],
  expected: number,
): DecisionStabilityV1 {
  const buckets = emptyBuckets();
  for (const sample of samples) buckets[sample.bucket] += 1;
  const judged = samples.filter((sample) => sample.bucket !== "no-margin");
  const available = samples.length;
  if (judged.length === 0)
    return freeze({
      policy: POSTGAME_SCORING_POLICY,
      status: available === 0 ? "no-data" : "partial",
      coverage: { available, expected },
      decisionsScored: 0,
      noMargin: buckets["no-margin"],
      buckets,
    });
  const rms = Math.sqrt(
    judged.reduce((sum, sample) => sum + sample.expectedLoss ** 2, 0) /
      judged.length,
  );
  const score = Math.round(
    100 *
      Math.max(
        0,
        1 - rms / POSTGAME_STABILITY_THRESHOLDS.rmsNormalizationExpectedLoss,
      ),
  );
  return freeze({
    policy: POSTGAME_SCORING_POLICY,
    status: available === expected ? "scored" : "partial",
    score,
    rmsExpectedLoss: rms,
    coverage: { available, expected },
    decisionsScored: judged.length,
    noMargin: buckets["no-margin"],
    buckets,
  });
}

function evidenceForSnapshot(
  snapshot: FinalLineSnapshotV1,
  evidence: readonly PostgamePositionEvidenceV1[],
): ReadonlyMap<number, PostgamePositionEvidenceV1> {
  const accepted = new Map<number, PostgamePositionEvidenceV1>();
  for (const item of evidence) {
    const move = snapshot.moves[item.moveIndex];
    if (
      !move ||
      move.beforeFen !== item.beforeFen ||
      move.afterFen !== item.afterFen ||
      accepted.has(item.moveIndex)
    )
      continue;
    accepted.set(item.moveIndex, item);
  }
  return accepted;
}

function trajectory(
  snapshot: FinalLineSnapshotV1,
): PostgameSummaryV1["trajectory"] {
  const points: PostgameTrajectoryPointV1[] = [];
  let previousLead = 0;
  for (const move of snapshot.moves) {
    const lead =
      materialCentipawns(move.afterFen, "white") -
      materialCentipawns(move.afterFen, "black");
    if (
      Math.abs(lead) >=
        POSTGAME_STABILITY_THRESHOLDS.decisiveMaterialCentipawns &&
      Math.abs(previousLead) <
        POSTGAME_STABILITY_THRESHOLDS.decisiveMaterialCentipawns
    ) {
      const side = lead > 0 ? "Las blancas" : "Las negras";
      points.push(
        freeze({
          moveIndex: move.index,
          kind: "material-edge",
          text: `${side} alcanzaron una ventaja material clara.`,
        }),
      );
    }
    previousLead = lead;
  }
  const terminalIndex = snapshot.moves.length - 1;
  const side = snapshot.winner === "white" ? "Las blancas" : "Las negras";
  points.push(
    freeze({
      moveIndex: terminalIndex,
      kind: "checkmate",
      text: `${side} dieron jaque mate.`,
    }),
  );
  const terminalLead =
    materialCentipawns(snapshot.terminalFen, "white") -
    materialCentipawns(snapshot.terminalFen, "black");
  const kind =
    Math.abs(terminalLead) >=
    POSTGAME_STABILITY_THRESHOLDS.decisiveMaterialCentipawns
      ? terminalLead > 0
        ? "decisive-white"
        : "decisive-black"
      : "balanced-or-unclear";
  return freeze({ kind, points });
}

/**
 * Creates a conservative report. Missing, duplicate, corrupt or mismatched
 * evidence is omitted and lowers coverage; it is never filled with guesses.
 */
export function summarizeCheckmateGame(
  finalLine: FinalLineSnapshotV1,
  rawEvidence: readonly unknown[] = [],
): PostgameSummaryV1 {
  const snapshot = decodeFinalLineSnapshotV1(finalLine);
  if (!snapshot) throw new RangeError("Final line snapshot must be valid");
  const evidence = rawEvidence.flatMap((value) => {
    const decoded = decodePostgamePositionEvidenceV1(value);
    return decoded === undefined ? [] : [decoded];
  });
  const phases = phaseFinalLine(snapshot);
  const phaseByMove = new Map(
    snapshot.moves.map((move) => [move.index, phases[move.index]!]),
  );
  const accepted = evidenceForSnapshot(snapshot, evidence);
  const samples: DecisionSampleV1[] = [];
  for (const move of snapshot.moves) {
    const observation = accepted.get(move.index);
    if (!observation) continue;
    const best = expectedFromLine(observation.bestLine);
    const played = expectedFromLine(observation.playedLine);
    const bestForActor =
      observation.perspective === move.color ? best.value : 1 - best.value;
    const playedForActor =
      observation.perspective === move.color ? played.value : 1 - played.value;
    const loss = Math.max(0, bestForActor - playedForActor);
    samples.push(
      freeze({
        moveIndex: move.index,
        color: move.color,
        actor: move.actor,
        phase: phaseByMove.get(move.index)!,
        expectedLoss: loss,
        source:
          best.source === "wdl" || played.source === "wdl"
            ? "wdl"
            : best.source === "mate" || played.source === "mate"
              ? "mate"
              : "centipawn",
        bucket: bucketFor(bestForActor, loss),
      }),
    );
  }
  const phaseSummaries = PHASES.map((phase) => {
    const indexes = snapshot.moves
      .filter((move) => phaseByMove.get(move.index) === phase)
      .map((move) => move.index);
    const status: PostgamePhaseStatus =
      phase === "opening" && !isStandardInitialFen(snapshot.initialFen)
        ? "not-applicable"
        : indexes.length === 0
          ? "not-reached"
          : "reached";
    const side = (color: PlayerColor) =>
      scoreStability(
        samples.filter(
          (sample) => sample.phase === phase && sample.color === color,
        ),
        indexes.filter((index) => snapshot.moves[index]!.color === color)
          .length,
      );
    return freeze({
      phase,
      status,
      moveIndexes: indexes,
      white: side("white"),
      black: side("black"),
    });
  });
  const expectedDecisions = snapshot.moves.length;
  const status = samples.length === expectedDecisions ? "complete" : "partial";
  return freeze({
    schemaVersion: 1,
    status,
    policies: {
      phases: POSTGAME_PHASE_POLICY,
      scoring: POSTGAME_SCORING_POLICY,
    },
    finalLine: snapshot,
    phases: phaseSummaries,
    participants: snapshot.participants,
    trajectory: trajectory(snapshot),
  });
}
