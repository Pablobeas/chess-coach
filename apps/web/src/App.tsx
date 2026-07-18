import { createInitialGame, type GameSession } from "@chess-coach/chess-core";
import { createDeterministicEngine } from "@chess-coach/engine";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  boardForFen,
  boardRows,
  createLocalGame,
  legalDestinations,
  pieceSymbols,
  playMove,
  playUciMove,
  type Square,
  undoMove,
} from "./localGame";

const initialSnapshot = createInitialGame();
const engine = createDeterministicEngine();
type EngineState = "idle" | "thinking" | "ready" | "error";
const colorName = (color: "white" | "black") =>
  color === "white" ? "blancas" : "negras";

function applyEngineLine(current: GameSession, uci: string): GameSession {
  return playUciMove(current, uci);
}

export function App() {
  const [game, setGame] = useState(() => createLocalGame(initialSnapshot));
  const [selected, setSelected] = useState<Square>();
  const [engineState, setEngineState] = useState<EngineState>("idle");
  const [engineMessage, setEngineMessage] = useState(
    "El motor simulado está disponible.",
  );
  const generation = useRef(0);
  const board = useMemo(() => boardForFen(game.fen), [game.fen]);
  const destinations = useMemo(
    () => (selected ? legalDestinations(game, selected) : []),
    [game, selected],
  );

  useEffect(() => {
    if (game.history.length === 0 || game.turn !== "black") return;
    const controller = new AbortController();
    const currentGeneration = ++generation.current;
    const requestFen = game.fen;
    const requestHistoryLength = game.history.length;
    setEngineState("thinking");
    setEngineMessage("El motor simulado está analizando la posición.");

    void engine
      .analyze(
        {
          id: `analysis-${currentGeneration}-${requestHistoryLength}`,
          fen: requestFen,
          perspective: game.turn,
          multiPv: 1,
          limit: { kind: "time", milliseconds: 500 },
        },
        controller.signal,
      )
      .then((result) => {
        if (
          controller.signal.aborted ||
          generation.current !== currentGeneration ||
          result.id !== `analysis-${currentGeneration}-${requestHistoryLength}`
        )
          return;
        const uci = result.lines[0]?.moves[0];
        if (!uci) throw new Error("Engine returned no move");
        setGame((current) => {
          if (
            current.fen !== requestFen ||
            current.history.length !== requestHistoryLength
          )
            return current;
          return applyEngineLine(current, uci);
        });
        setEngineState("ready");
        setEngineMessage(
          `Respuesta aplicada: ${uci}. Análisis: profundidad ${result.depth}, ${result.nodes.toLocaleString("es-ES")} nodos.`,
        );
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError")
          return;
        if (generation.current !== currentGeneration) return;
        setEngineState("error");
        setEngineMessage(
          "No se pudo analizar la posición. Puedes reiniciar la partida.",
        );
      });

    return () => {
      controller.abort();
      generation.current += 1;
    };
  }, [game.fen, game.history.length, game.turn]);

  const selectSquare = (square: Square) => {
    if (engineState === "thinking" || game.turn !== "white") return;
    if (selected && destinations.includes(square)) {
      setGame((current) => playMove(current, selected, square));
      setSelected(undefined);
      return;
    }
    setSelected(board.get(square)?.color === game.turn ? square : undefined);
  };

  const reset = () => {
    generation.current += 1;
    setGame(createLocalGame(initialSnapshot));
    setSelected(undefined);
    setEngineState("idle");
    setEngineMessage("El motor simulado está disponible.");
  };

  const undo = () => {
    generation.current += 1;
    setGame((current) => undoMove(current));
    setSelected(undefined);
    setEngineState("idle");
    setEngineMessage("El motor simulado está disponible.");
  };

  return (
    <main className="shell">
      <section className="game" aria-labelledby="page-title">
        <header className="game-header">
          <div>
            <p className="eyebrow">Partida local · Sin cuenta</p>
            <h1 id="page-title">Tablero de práctica</h1>
          </div>
          <p className="turn" aria-live="polite">
            Turno de {colorName(game.turn)}
          </p>
        </header>
        <div className="game-layout">
          <section className="board-panel" aria-label="Tablero de ajedrez">
            <p className="board-help" id="board-help">
              Selecciona una pieza y después una casilla marcada para moverla.
            </p>
            <div
              className="board"
              role="grid"
              aria-describedby="board-help"
              aria-label={`Tablero: turno de ${colorName(game.turn)}`}
            >
              {boardRows.map((row) => (
                <div role="row" key={row[0]}>
                  {row.map((square) => {
                    const piece = board.get(square);
                    const file = square.charCodeAt(0) - 97;
                    const rank = Number(square[1]);
                    const isSelected = selected === square;
                    const isDestination = destinations.includes(square);
                    return (
                      <button
                        key={square}
                        type="button"
                        className={`square ${(file + rank) % 2 === 0 ? "light" : "dark"}${isSelected ? " selected" : ""}${isDestination ? " destination" : ""}`}
                        onClick={() => selectSquare(square)}
                        aria-label={`${square}${piece ? `, pieza ${piece.color === "white" ? "blanca" : "negra"}` : ", vacía"}${isDestination ? ", destino legal" : ""}`}
                        aria-pressed={isSelected}
                        disabled={engineState === "thinking"}
                      >
                        {piece ? (
                          <span aria-hidden="true">
                            {pieceSymbols[piece.color][piece.type]}
                          </span>
                        ) : null}
                        {square[0] === "a" ? (
                          <small className="rank">{square[1]}</small>
                        ) : null}
                        {square[1] === "1" ? (
                          <small className="file">{square[0]}</small>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </section>
          <aside className="side-panel" aria-label="Controles y movimientos">
            <section className="engine-status" aria-live="polite">
              <p className="label">Motor local</p>
              <strong data-state={engineState}>
                {engineState === "thinking"
                  ? "Analizando"
                  : engineState === "ready"
                    ? "Listo"
                    : engineState === "error"
                      ? "No disponible"
                      : "En espera"}
              </strong>
              <p>{engineMessage}</p>
            </section>
            <div className="controls">
              <button
                type="button"
                onClick={undo}
                disabled={game.history.length === 0}
              >
                Deshacer
              </button>
              <button type="button" className="secondary" onClick={reset}>
                Reiniciar
              </button>
            </div>
            <section className="moves" aria-labelledby="moves-title">
              <div className="moves-heading">
                <h2 id="moves-title">Movimientos</h2>
                <span>{game.history.length}</span>
              </div>
              {game.history.length ? (
                <ol>
                  {game.history.map((move, index) => (
                    <li key={`${move.uci}-${index}`}>
                      <span>{index + 1}.</span>
                      {move.san}
                    </li>
                  ))}
                </ol>
              ) : (
                <p>Aún no hay movimientos.</p>
              )}
            </section>
          </aside>
        </div>
      </section>
    </main>
  );
}
