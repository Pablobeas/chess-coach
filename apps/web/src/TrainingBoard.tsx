import { type GameSession, type PlayerColor } from "@chess-coach/chess-core";
import { useMemo, useState } from "react";
import {
  boardRows,
  boardForFen,
  legalDestinations,
  type Square,
} from "./localGame";
import { PieceIcon } from "./PieceIcon";

export function TrainingBoard({
  game,
  orientation,
  onMove,
  highlights = [],
  disabled = false,
}: {
  readonly game: GameSession;
  readonly orientation: PlayerColor;
  readonly onMove: (uci: string) => void;
  readonly highlights?: readonly string[];
  readonly disabled?: boolean;
}) {
  const [selected, setSelected] = useState<Square>();
  const board = useMemo(() => boardForFen(game.fen), [game.fen]);
  const destinations = useMemo(
    () => (selected ? legalDestinations(game, selected) : []),
    [game, selected],
  );
  const rows =
    orientation === "white"
      ? boardRows
      : boardRows
          .slice()
          .reverse()
          .map((row) => row.slice().reverse());
  const activate = (square: Square) => {
    if (disabled) return;
    if (selected && destinations.includes(square)) {
      onMove(`${selected}${square}`);
      setSelected(undefined);
      return;
    }
    const piece = board.get(square);
    setSelected(piece?.color === game.turn ? square : undefined);
  };
  return (
    <section
      className="training-board-wrap"
      aria-label="Tablero de entrenamiento"
    >
      <p className="board-help" id="training-board-help">
        Selecciona una pieza y después su destino. Las casillas marcadas son
        destinos legales.
      </p>
      <div
        className="board training-board"
        role="grid"
        aria-describedby="training-board-help"
        aria-label={`Tablero, turno de ${game.turn === "white" ? "blancas" : "negras"}`}
      >
        {rows.map((row) => (
          <div role="row" key={row[0]}>
            {row.map((square) => {
              const piece = board.get(square);
              const file = square.charCodeAt(0) - 97;
              const rank = Number(square[1]);
              const selectedHere = selected === square;
              const destination = destinations.includes(square);
              const marked = highlights.includes(square);
              return (
                <button
                  key={square}
                  type="button"
                  role="gridcell"
                  className={`square ${(file + rank) % 2 === 0 ? "light" : "dark"}${selectedHere ? " selected" : ""}${destination ? " destination" : ""}${marked ? " training-highlight" : ""}`}
                  onClick={() => activate(square)}
                  aria-label={`${square}${piece ? `, ${piece.color === "white" ? "pieza blanca" : "pieza negra"}` : ", vacía"}${destination ? ", destino legal" : ""}`}
                  aria-pressed={selectedHere}
                  disabled={disabled}
                >
                  {piece ? (
                    <PieceIcon color={piece.color} type={piece.type} />
                  ) : null}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </section>
  );
}
