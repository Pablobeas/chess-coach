import { describe, expect, it } from "vitest";
import { PieceIcon } from "./PieceIcon";

describe("PieceIcon", () => {
  it("renders distinct bicolor SVG variants for both sides", () => {
    const white = PieceIcon({ color: "white", type: "k" });
    const black = PieceIcon({ color: "black", type: "k" });

    expect(white.type).toBe("svg");
    expect(black.type).toBe("svg");
    expect(white.props.className).toContain("piece-icon-white");
    expect(black.props.className).toContain("piece-icon-black");
    expect(white.props.viewBox).toBe("0 0 64 64");
  });
});
