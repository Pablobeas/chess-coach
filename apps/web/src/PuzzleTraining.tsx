import {
  createPuzzleSessionV1,
  revealPuzzleHintV1,
  revealPuzzleSolutionV1,
  retryPuzzleV1,
  submitPuzzleMoveV1,
  type PuzzleSessionV1,
  type PuzzleV1,
} from "@chess-coach/coach";
import { loadPosition } from "@chess-coach/chess-core";
import { useEffect, useState } from "react";
import { TrainingBoard } from "./TrainingBoard";

function newSession(puzzle: PuzzleV1) {
  return createPuzzleSessionV1(puzzle);
}
export function PuzzleTraining({
  puzzles,
  completedIds,
  onComplete,
}: {
  readonly puzzles: readonly PuzzleV1[];
  readonly completedIds: readonly string[];
  readonly onComplete: (id: string) => void;
}) {
  const [index, setIndex] = useState(0);
  const puzzle = puzzles[index]!;
  const [session, setSession] = useState<PuzzleSessionV1>(() =>
    newSession(puzzle),
  );
  const [notice, setNotice] = useState("");
  useEffect(() => {
    setSession(newSession(puzzle));
    setNotice("");
  }, [puzzle]);
  const move = (uci: string) => {
    try {
      const result = submitPuzzleMoveV1(session, uci);
      setSession(result.session);
      setNotice(
        result.kind === "incorrect"
          ? result.message
          : result.automaticReply
            ? "Correcto. El rival responde automáticamente."
            : "Correcto: has completado la solución.",
      );
      if (result.session.status === "solved") onComplete(puzzle.id);
    } catch {
      setNotice("Esa jugada no es legal en esta posición.");
    }
  };
  const hint = () => {
    const next = revealPuzzleHintV1(session);
    setSession(next.session);
    setNotice(next.hint);
  };
  const next = () => setIndex((value) => (value + 1) % puzzles.length);
  const summary = session.status !== "active";
  return (
    <section className="training-page" aria-labelledby="puzzles-title">
      <header>
        <p className="eyebrow">Entrenamiento táctico local</p>
        <h1 id="puzzles-title">Puzles</h1>
        <p>
          {completedIds.length}/{puzzles.length} completados · {puzzle.theme} ·{" "}
          {puzzle.difficulty}
        </p>
      </header>
      <label className="training-field">
        Ejercicio{" "}
        <select
          value={puzzle.id}
          onChange={(event) =>
            setIndex(
              puzzles.findIndex((item) => item.id === event.target.value),
            )
          }
        >
          {puzzles.map((item) => (
            <option value={item.id} key={item.id}>
              {item.objective}
            </option>
          ))}
        </select>
      </label>
      <div className="training-layout">
        <TrainingBoard
          game={loadPosition(session.fen)}
          orientation={puzzle.sideToMove}
          onMove={move}
        />
        <aside className="training-panel">
          <h2>{puzzle.objective}</h2>
          <p role="status" aria-live="polite">
            {notice}
          </p>
          <p>Intentos fallidos: {session.failedAttempts}</p>
          {session.status === "active" ? (
            <div className="training-actions">
              <button type="button" onClick={hint}>
                Pista {Math.min(4, session.revealedHintLevel + 1)} de 4
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setSession(revealPuzzleSolutionV1(session));
                  setNotice("Solución mostrada.");
                }}
              >
                Ver solución
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setSession(retryPuzzleV1(session));
                  setNotice("Posición reiniciada.");
                }}
              >
                Reintentar
              </button>
            </div>
          ) : null}
          {summary ? (
            <div className="training-summary">
              <h2>
                {session.status === "solved"
                  ? "Ejercicio resuelto"
                  : "Solución revisada"}
              </h2>
              <p>{puzzle.explanation}</p>
              <p>{puzzle.resultingAdvantage}</p>
              <button
                type="button"
                onClick={() => {
                  setSession(retryPuzzleV1(session));
                  setNotice("Posición reiniciada.");
                }}
              >
                Repetir
              </button>
              <button type="button" onClick={next}>
                Siguiente
              </button>
            </div>
          ) : null}
        </aside>
      </div>
    </section>
  );
}
