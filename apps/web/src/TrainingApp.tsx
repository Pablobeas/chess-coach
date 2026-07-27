import { ITALIAN_OPENING_COURSE_V1, PUZZLES_V1 } from "@chess-coach/coach";
import { useEffect, useState } from "react";
import { App } from "./App";
import { Dropdown, DropdownProvider } from "./Dropdown";
import { OpeningTraining } from "./OpeningTraining";
import { PuzzleTraining } from "./PuzzleTraining";
import {
  loadTrainingProgress,
  saveTrainingProgress,
  type TrainingProgressV1,
} from "./trainingPersistence";

type Route = "/" | "/game" | "/puzzles" | "/openings";
export function routeFromHash(hash: string): Route {
  return (["/", "/game", "/puzzles", "/openings"] as const).includes(
    hash.slice(1) as Route,
  )
    ? (hash.slice(1) as Route)
    : "/";
}
const links: readonly { readonly route: Route; readonly label: string }[] = [
  { route: "/", label: "Inicio" },
  { route: "/game", label: "Partida" },
  { route: "/puzzles", label: "Puzles" },
  { route: "/openings", label: "Aperturas" },
];
function Home() {
  return (
    <main id="main-content" className="training-home">
      <section className="training-hero">
        <p className="eyebrow">Entrena sin salir de tu dispositivo</p>
        <h1>Tu siguiente buena decisión empieza aquí.</h1>
        <p>
          Juega, resuelve tácticas y aprende un repertorio con explicaciones
          claras y evidencia local.
        </p>
      </section>
      <section className="training-cards" aria-label="Modos de entrenamiento">
        <a href="#/game" className="training-card">
          <span aria-hidden="true">♞</span>
          <h2>Partida</h2>
          <p>Una partida local con el entrenador a tu lado.</p>
        </a>
        <a href="#/puzzles" className="training-card">
          <span aria-hidden="true">✦</span>
          <h2>Puzles</h2>
          <p>Encuentra la secuencia y recibe pistas progresivas.</p>
        </a>
        <a href="#/openings" className="training-card">
          <span aria-hidden="true">⌁</span>
          <h2>Aperturas</h2>
          <p>Comprende el plan y practícalo paso a paso.</p>
        </a>
      </section>
    </main>
  );
}
function Navigation({ route }: { readonly route: Route }) {
  return (
    <header className="training-nav">
      <a className="brand" href="#/">
        Alfil Norte
      </a>
      <nav aria-label="Navegación principal">
        {links.map((link) => (
          <a
            key={link.route}
            href={`#${link.route}`}
            aria-current={route === link.route ? "page" : undefined}
          >
            {link.label}
          </a>
        ))}
      </nav>
      <Dropdown label="Menú de rutas">
        {links.map((link) => (
          <a
            key={link.route}
            role="menuitem"
            href={`#${link.route}`}
            aria-current={route === link.route ? "page" : undefined}
          >
            {link.label}
          </a>
        ))}
      </Dropdown>
    </header>
  );
}
export function TrainingApp() {
  const [route, setRoute] = useState<Route>(() =>
    routeFromHash(window.location.hash || "#/"),
  );
  const [progress, setProgress] = useState<TrainingProgressV1>(() =>
    loadTrainingProgress(),
  );
  const [gameFen, setGameFen] = useState<string>();
  useEffect(() => {
    const listen = () => setRoute(routeFromHash(window.location.hash));
    window.addEventListener("hashchange", listen);
    return () => window.removeEventListener("hashchange", listen);
  }, []);
  // The FEN is a one-shot handoff to a newly mounted game, never a route-level
  // source of truth. Subsequent visits must restore the v6 workspace it saved.
  useEffect(() => {
    if (route === "/game" && gameFen !== undefined) setGameFen(undefined);
  }, [gameFen, route]);
  const complete = (id: string) =>
    setProgress((current) => {
      const next: TrainingProgressV1 = {
        ...current,
        completedPuzzleIds: current.completedPuzzleIds.includes(id)
          ? current.completedPuzzleIds
          : [...current.completedPuzzleIds, id],
        lastPuzzleId: id,
      };
      saveTrainingProgress(next);
      return next;
    });
  const continueGame = (fen: string) => {
    setGameFen(fen);
    window.location.hash = "#/game";
  };
  return (
    <DropdownProvider>
      <a className="skip-link" href="#main-content">
        Saltar al contenido
      </a>
      <Navigation route={route} />
      {route === "/" ? <Home /> : null}
      {route === "/puzzles" ? (
        <main id="main-content">
          <PuzzleTraining
            puzzles={PUZZLES_V1}
            completedIds={progress.completedPuzzleIds}
            onComplete={complete}
          />
        </main>
      ) : null}
      {route === "/openings" ? (
        <main id="main-content">
          <OpeningTraining
            course={ITALIAN_OPENING_COURSE_V1}
            onContinueGame={continueGame}
          />
        </main>
      ) : null}
      {route === "/game" ? (
        gameFen === undefined ? (
          <App />
        ) : (
          <App initialFen={gameFen} />
        )
      ) : null}
    </DropdownProvider>
  );
}
