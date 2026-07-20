import { describe, expect, it } from "vitest";
import {
  orientedBoardRows,
  squareOffset,
  squarePoint,
  visualMoveOffset,
} from "./boardOrientation";

describe("board orientation", () => {
  it("keeps White's home rank at the bottom in visual and DOM order", () => {
    const rows = orientedBoardRows("white");

    expect(rows[0]).toEqual(["a8", "b8", "c8", "d8", "e8", "f8", "g8", "h8"]);
    expect(rows.at(-1)).toEqual([
      "a1",
      "b1",
      "c1",
      "d1",
      "e1",
      "f1",
      "g1",
      "h1",
    ]);
  });

  it("keeps Black's home rank at the bottom in visual and DOM order", () => {
    const rows = orientedBoardRows("black");

    expect(rows[0]).toEqual(["h1", "g1", "f1", "e1", "d1", "c1", "b1", "a1"]);
    expect(rows.at(-1)).toEqual([
      "h8",
      "g8",
      "f8",
      "e8",
      "d8",
      "c8",
      "b8",
      "a8",
    ]);
  });

  it("maps positions, arrows, and animation offsets to the active perspective", () => {
    expect(squareOffset("e2", "white")).toEqual({ left: "50%", top: "75%" });
    expect(squareOffset("e2", "black")).toEqual({
      left: "37.5%",
      top: "12.5%",
    });
    expect(squarePoint("e2", "black")).toEqual({ x: 3.5, y: 1.5 });
    expect(visualMoveOffset("e2", "e4", "black")).toEqual({
      "--move-x": "0%",
      "--move-y": "200%",
    });
  });
});
