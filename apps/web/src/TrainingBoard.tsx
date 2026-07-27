import { type GameSession, type PlayerColor } from "@chess-coach/chess-core";
import { useMemo, useState } from "react";
import {
  boardRows,
  boardForFen,
  legalDestinations,
  type Square,
} from "./localGame";
import { PieceIcon } from "./PieceIcon";

export type TrainingBoardArrow = {
  readonly from: string;
  readonly to: string;
  readonly color: "player" | "opponent";
};

type BoardPoint = { readonly x: number; readonly y: number };
export type ArrowGeometry = {
  readonly start: BoardPoint;
  readonly shaftEnd: BoardPoint;
  readonly tip: BoardPoint;
  readonly headLeft: BoardPoint;
  readonly headRight: BoardPoint;
};

const ARROW_START_INSET = 0.22;
const ARROW_TIP_INSET = 0.2;
const ARROW_HEAD_LENGTH = 0.25;
const ARROW_HEAD_HALF_WIDTH = 0.14;

/** Builds a compact shaft and classic triangular head in the board's 8×8 space. */
export function arrowGeometry(
  from: BoardPoint,
  to: BoardPoint,
): ArrowGeometry | undefined {
  const deltaX = to.x - from.x;
  const deltaY = to.y - from.y;
  const distance = Math.hypot(deltaX, deltaY);
  if (!Number.isFinite(distance) || distance === 0) return undefined;
  const unitX = deltaX / distance;
  const unitY = deltaY / distance;
  const perpendicularX = -unitY;
  const perpendicularY = unitX;
  const start = {
    x: from.x + unitX * ARROW_START_INSET,
    y: from.y + unitY * ARROW_START_INSET,
  };
  const tip = {
    x: to.x - unitX * ARROW_TIP_INSET,
    y: to.y - unitY * ARROW_TIP_INSET,
  };
  const base = {
    x: tip.x - unitX * ARROW_HEAD_LENGTH,
    y: tip.y - unitY * ARROW_HEAD_LENGTH,
  };
  return {
    start,
    shaftEnd: base,
    tip,
    headLeft: {
      x: base.x + perpendicularX * ARROW_HEAD_HALF_WIDTH,
      y: base.y + perpendicularY * ARROW_HEAD_HALF_WIDTH,
    },
    headRight: {
      x: base.x - perpendicularX * ARROW_HEAD_HALF_WIDTH,
      y: base.y - perpendicularY * ARROW_HEAD_HALF_WIDTH,
    },
  };
}

function arrowPoint(square: string, orientation: PlayerColor) {
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square[1]) - 1;
  const column = orientation === "white" ? file : 7 - file;
  const row = orientation === "white" ? 7 - rank : rank;
  return { x: 0.5 + column, y: 0.5 + row };
}

export function TrainingBoard({
  game,
  orientation,
  onMove,
  highlights = [],
  arrows = [],
  disabled = false,
}: {
  readonly game: GameSession;
  readonly orientation: PlayerColor;
  readonly onMove: (uci: string) => void;
  readonly highlights?: readonly string[];
  readonly arrows?: readonly TrainingBoardArrow[];
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
        {arrows.length > 0 ? (
          <svg
            className="training-board-arrows"
            viewBox="0 0 8 8"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            {arrows.map((arrow, index) => {
              const from = arrowPoint(arrow.from, orientation);
              const to = arrowPoint(arrow.to, orientation);
              const geometry = arrowGeometry(from, to);
              if (!geometry) return null;
              return (
                <g key={`${arrow.color}-${arrow.from}-${arrow.to}-${index}`}>
                  <line
                    x1={geometry.start.x}
                    y1={geometry.start.y}
                    x2={geometry.shaftEnd.x}
                    y2={geometry.shaftEnd.y}
                    className={`training-arrow training-arrow-${arrow.color}`}
                  />
                  <polygon
                    className={`training-arrowhead training-arrowhead-${arrow.color}`}
                    points={`${geometry.tip.x},${geometry.tip.y} ${geometry.headLeft.x},${geometry.headLeft.y} ${geometry.headRight.x},${geometry.headRight.y}`}
                  />
                </g>
              );
            })}
          </svg>
        ) : null}
      </div>
    </section>
  );
}
