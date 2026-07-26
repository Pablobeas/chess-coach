import type {
  DecisionBucket,
  DecisionStabilityV1,
  PostgamePhase,
  PostgamePhaseSummaryV1,
} from "@chess-coach/coach";
import {
  useEffect,
  useMemo,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import type { PostgameReviewStateV1 } from "./postgameReview";

const PHASES: readonly PostgamePhase[] = ["opening", "middlegame", "ending"];
const PHASE_LABEL: Readonly<Record<PostgamePhase, string>> = {
  opening: "Apertura",
  middlegame: "Medio juego",
  ending: "Desenlace",
};
const BUCKETS: readonly {
  readonly key: DecisionBucket;
  readonly label: string;
}[] = [
  { key: "firm", label: "Firmes" },
  { key: "acceptable", label: "Aceptables" },
  { key: "improvable", label: "Mejorables" },
  { key: "error", label: "Errores" },
  { key: "critical", label: "Críticas" },
  { key: "no-margin", label: "Sin margen" },
];

type ReviewSide = "you" | "opponent";

export interface PostgameReviewScreenProps {
  readonly review: PostgameReviewStateV1;
  readonly onClose: () => void;
  readonly onNewGame: () => void;
}

function scoreText(stability: DecisionStabilityV1): string {
  if (stability.status === "no-data") return "Datos insuficientes";
  if (stability.score === undefined) return "Sin puntuación";
  return `${stability.score}/100`;
}

function coverageText(stability: DecisionStabilityV1): string {
  return `${stability.coverage.available}/${stability.coverage.expected} decisiones analizadas`;
}

function combineStability(
  items: readonly DecisionStabilityV1[],
): DecisionStabilityV1 {
  const first = items[0];
  if (!first) throw new RangeError("A review needs at least one phase");
  const coverage = items.reduce(
    (total, item) => ({
      available: total.available + item.coverage.available,
      expected: total.expected + item.coverage.expected,
    }),
    { available: 0, expected: 0 },
  );
  const buckets = items.reduce<Record<DecisionBucket, number>>(
    (total, item) => {
      for (const bucket of BUCKETS)
        total[bucket.key] += item.buckets[bucket.key];
      return total;
    },
    {
      firm: 0,
      acceptable: 0,
      improvable: 0,
      error: 0,
      critical: 0,
      "no-margin": 0,
    },
  );
  const scored = items.filter((item) => item.score !== undefined);
  const weighted = scored.reduce(
    (total, item) => total + item.score! * item.decisionsScored,
    0,
  );
  const decisionsScored = scored.reduce(
    (total, item) => total + item.decisionsScored,
    0,
  );
  return {
    policy: first.policy,
    status:
      decisionsScored === 0
        ? coverage.available === 0
          ? "no-data"
          : "partial"
        : coverage.available === coverage.expected
          ? "scored"
          : "partial",
    ...(decisionsScored
      ? { score: Math.round(weighted / decisionsScored) }
      : {}),
    coverage,
    decisionsScored,
    noMargin: buckets["no-margin"],
    buckets,
  };
}

function phaseStatusText(phase: PostgamePhaseSummaryV1): string | undefined {
  if (phase.status === "not-applicable") return "No aplicable";
  if (phase.status === "not-reached") return "No se alcanzó";
  return undefined;
}

function moveLabel(index: number, san: string): string {
  const move = Math.floor(index / 2) + 1;
  return index % 2 === 0 ? `${move}. ${san}` : `${move}... ${san}`;
}

function phaseByMove(
  review: PostgameReviewStateV1,
): ReadonlyMap<number, PostgamePhase> {
  const values = new Map<number, PostgamePhase>();
  for (const phase of review.summary.phases)
    for (const index of phase.moveIndexes) values.set(index, phase.phase);
  return values;
}

function participantLabel(
  review: PostgameReviewStateV1,
  side: ReviewSide,
): string {
  const participant = Object.values(review.summary.participants).find((item) =>
    side === "you" ? item.actor === "user" : item.actor === "maia",
  );
  if (!participant) return side === "you" ? "Tú" : "Rival";
  const color = participant.color === "white" ? "blancas" : "negras";
  return `${side === "you" ? "Tú" : "Rival"} · ${color}`;
}

function stabilityFor(
  phase: PostgamePhaseSummaryV1,
  actor: "user" | "maia",
  review: PostgameReviewStateV1,
): DecisionStabilityV1 {
  const userIsWhite = review.summary.participants.white.actor === "user";
  const wantsWhite = actor === "user" ? userIsWhite : !userIsWhite;
  return wantsWhite ? phase.white : phase.black;
}

function BucketGrid({
  label,
  stability,
}: {
  readonly label: string;
  readonly stability: DecisionStabilityV1;
}) {
  return (
    <section
      className="postgame-bucket-group"
      aria-label={`${label}: decisiones por consistencia`}
    >
      <h3>{label}</h3>
      <dl className="postgame-buckets">
        {BUCKETS.map((bucket) => (
          <div key={bucket.key}>
            <dt>{bucket.label}</dt>
            <dd>{stability.buckets[bucket.key]}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function Trajectory({ review }: { readonly review: PostgameReviewStateV1 }) {
  const points = review.summary.trajectory.points;
  const width = 320;
  const height = 72;
  const path = points
    .map((point, index) => {
      const x =
        points.length <= 1
          ? width / 2
          : 16 + (index * (width - 32)) / (points.length - 1);
      const y = point.kind === "checkmate" ? 18 : 48;
      return `${index === 0 ? "M" : "L"}${x} ${y}`;
    })
    .join(" ");
  return (
    <figure className="postgame-trajectory">
      <figcaption>Recorrido de la partida</figcaption>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={points.map((point) => point.text).join(" ")}
      >
        <path className="postgame-trajectory-base" d={`M16 54H${width - 16}`} />
        {path ? <path className="postgame-trajectory-line" d={path} /> : null}
        {points.map((point, index) => {
          const x =
            points.length <= 1
              ? width / 2
              : 16 + (index * (width - 32)) / (points.length - 1);
          const y = point.kind === "checkmate" ? 18 : 48;
          return (
            <circle
              key={`${point.moveIndex}-${point.kind}`}
              className={`postgame-trajectory-point postgame-trajectory-point-${point.kind}`}
              cx={x}
              cy={y}
              r="5"
            />
          );
        })}
      </svg>
      <ul className="visually-hidden">
        {points.map((point) => (
          <li key={`${point.moveIndex}-${point.kind}`}>{point.text}</li>
        ))}
      </ul>
    </figure>
  );
}

/** Terminal-only review. It renders the immutable final-line snapshot, never a variation. */
export function PostgameReviewScreen({
  review,
  onClose,
  onNewGame,
}: PostgameReviewScreenProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const model = useMemo(() => {
    const byMove = phaseByMove(review);
    return {
      user: participantLabel(review, "you"),
      opponent: participantLabel(review, "opponent"),
      winner: review.snapshot.winner === "white" ? "blancas" : "negras",
      phases: PHASES.map((kind) => ({
        kind,
        summary: review.summary.phases.find((phase) => phase.phase === kind),
        moves: review.snapshot.moves.filter(
          (move) => byMove.get(move.index) === kind,
        ),
      })),
    };
  }, [review]);
  const userWon = Object.values(review.snapshot.participants).some(
    (participant) =>
      participant.actor === "user" &&
      participant.color === review.snapshot.winner,
  );

  useEffect(() => {
    headingRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const trapFocus = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== "Tab") return;
    const nodes = dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
    );
    if (!nodes?.length) return;
    const first = nodes[0]!;
    const last = nodes[nodes.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const overall = combineStability(
    review.summary.phases.map((phase) => stabilityFor(phase, "user", review)),
  );
  const opponentOverall = combineStability(
    review.summary.phases.map((phase) => stabilityFor(phase, "maia", review)),
  );

  return (
    <div className="postgame-review-backdrop" role="presentation">
      <section
        ref={dialogRef}
        className="postgame-review"
        role="dialog"
        aria-modal="true"
        aria-labelledby="postgame-review-title"
        aria-describedby="postgame-review-status"
        onKeyDown={trapFocus}
      >
        <header className="postgame-review-header">
          <div>
            <p className="eyebrow">Partida terminada</p>
            <h1 ref={headingRef} id="postgame-review-title" tabIndex={-1}>
              Resumen final
            </h1>
          </div>
          <button
            type="button"
            className="postgame-close"
            onClick={onClose}
            aria-label="Volver al tablero"
          >
            ×
          </button>
        </header>
        <p
          id="postgame-review-status"
          className={`postgame-result ${userWon ? "postgame-result-win" : "postgame-result-loss"}`}
        >
          <strong>
            {userWon ? "Victoria por jaque mate" : "Derrota por jaque mate"}
          </strong>
          <span>Ganan {model.winner}.</span>
        </p>

        <main className="postgame-review-scroll">
          <p className="postgame-progress" role="status" aria-live="polite">
            {review.status === "ready"
              ? `Estimación local terminada · ${review.progress.completed}/${review.progress.total} posiciones`
              : review.status === "unavailable"
                ? `Estimación local incompleta · ${review.progress.completed}/${review.progress.total} posiciones disponibles`
                : `Estimación local en curso · ${review.progress.completed}/${review.progress.total} posiciones`}
          </p>
          <Trajectory review={review} />

          <section
            className="postgame-score-section"
            aria-labelledby="postgame-stability-title"
          >
            <div className="postgame-section-heading">
              <div>
                <h2 id="postgame-stability-title">Índice de estabilidad</h2>
                <p>Comparación de decisiones de la línea final.</p>
              </div>
              <span>
                {overall.coverage.available}/{overall.coverage.expected}{" "}
                analizadas
              </span>
            </div>
            <div
              className="postgame-compare"
              aria-label="Comparación entre tú y rival"
            >
              <div className="postgame-participant">
                <span>{model.user}</span>
                <strong>{scoreText(overall)}</strong>
                <small>{coverageText(overall)}</small>
              </div>
              <div className="postgame-participant">
                <span>{model.opponent}</span>
                <strong>{scoreText(opponentOverall)}</strong>
                <small>{coverageText(opponentOverall)}</small>
              </div>
            </div>
            <div className="postgame-bucket-comparison">
              <BucketGrid label="Tú" stability={overall} />
              <BucketGrid label="Rival" stability={opponentOverall} />
            </div>
          </section>

          <section
            className="postgame-phase-section"
            aria-labelledby="postgame-phase-title"
          >
            <h2 id="postgame-phase-title">Tramos de la partida</h2>
            <div className="postgame-phase-grid">
              {model.phases.map(({ kind, summary }) => {
                if (!summary) return null;
                const status = phaseStatusText(summary);
                const user = stabilityFor(summary, "user", review);
                const opponent = stabilityFor(summary, "maia", review);
                return (
                  <article className="postgame-phase-card" key={kind}>
                    <h3>{PHASE_LABEL[kind]}</h3>
                    {status ? (
                      <p className="postgame-phase-empty">{status}</p>
                    ) : (
                      <>
                        <dl>
                          <div>
                            <dt>Tú</dt>
                            <dd>{scoreText(user)}</dd>
                          </div>
                          <div>
                            <dt>Rival</dt>
                            <dd>{scoreText(opponent)}</dd>
                          </div>
                        </dl>
                        <p>
                          {coverageText(user)} · Rival: {coverageText(opponent)}
                        </p>
                      </>
                    )}
                  </article>
                );
              })}
            </div>
          </section>

          <section
            className="postgame-moves"
            aria-labelledby="postgame-moves-title"
          >
            <h2 id="postgame-moves-title">Línea que terminó en jaque mate</h2>
            <p>
              Todos los movimientos mostrados pertenecen únicamente al recorrido
              final.
            </p>
            {model.phases.map(({ kind, moves }) =>
              moves.length ? (
                <section key={kind} aria-labelledby={`postgame-moves-${kind}`}>
                  <h3 id={`postgame-moves-${kind}`}>{PHASE_LABEL[kind]}</h3>
                  <ol>
                    {moves.map((move) => (
                      <li key={move.index}>
                        {moveLabel(move.index, move.san)}
                      </li>
                    ))}
                  </ol>
                </section>
              ) : null,
            )}
          </section>
        </main>
        <footer className="postgame-review-actions">
          <button type="button" className="secondary" onClick={onClose}>
            Volver al tablero
          </button>
          <button
            type="button"
            className="postgame-new-game"
            onClick={onNewGame}
          >
            Nueva partida
          </button>
        </footer>
      </section>
    </div>
  );
}
