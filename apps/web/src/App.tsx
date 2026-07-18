import { createInitialGame } from "@chess-coach/chess-core";
import { coachReadiness } from "@chess-coach/coach";

export function App() {
  const game = createInitialGame();

  return (
    <main className="shell">
      <section className="hero" aria-labelledby="page-title">
        <p className="eyebrow">Entrenamiento local · Sin cuenta</p>
        <h1 id="page-title">Piensa la posición. Entiende la jugada.</h1>
        <p className="lede">
          La base del proyecto está lista. El siguiente hito conectará un motor
          local para jugar, analizar y explicar cada decisión.
        </p>
        <div className="status-grid" aria-label="Estado del proyecto">
          <article>
            <span>Posición inicial</span>
            <strong>
              {game.turn === "white" ? "Juegan blancas" : "Juegan negras"}
            </strong>
          </article>
          <article>
            <span>Entrenador</span>
            <strong>{coachReadiness}</strong>
          </article>
          <article>
            <span>Privacidad</span>
            <strong>Local por defecto</strong>
          </article>
        </div>
      </section>
    </main>
  );
}
