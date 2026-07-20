import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PieceIcon } from "./PieceIcon";

describe("PieceIcon", () => {
  const colors = ["white", "black"] as const;
  const types = ["p", "n", "b", "r", "q", "k"] as const;

  it("renders all twelve decorative Neo-inspired variants with the public API intact", () => {
    for (const color of colors) {
      for (const type of types) {
        const markup = renderToStaticMarkup(
          <PieceIcon color={color} type={type} />,
        );

        expect(markup).toContain(`class="piece-icon piece-icon-${color}"`);
        expect(markup).toContain('viewBox="0 0 64 64"');
        expect(markup).toContain(`data-piece-type="${type}"`);
        expect(markup).toContain('data-piece-silhouette="neo-original"');
        expect(markup).toContain(`piece-fill-${color}`);
      }
    }
  });

  it("uses distinct original silhouettes for the six piece types", () => {
    const silhouettes = types.map(
      (type) =>
        renderToStaticMarkup(<PieceIcon color="white" type={type} />).match(
          /<g[^>]*>([\s\S]*)<\/g>/,
        )?.[1],
    );

    expect(silhouettes).not.toContain(undefined);
    expect(new Set(silhouettes).size).toBe(types.length);
  });

  it("keeps the knight and king in recognizably classical profiles", () => {
    const knight = renderToStaticMarkup(<PieceIcon color="black" type="n" />);
    const king = renderToStaticMarkup(<PieceIcon color="white" type="k" />);

    expect(knight).toContain('data-classic-profile="horse"');
    expect(king).toContain('data-classic-profile="crowned-king"');
  });

  it("is strictly decorative for assistive technology", () => {
    const markup = renderToStaticMarkup(<PieceIcon color="white" type="k" />);

    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain('focusable="false"');
    expect(markup).not.toContain("<title");
    expect(markup).not.toContain('role="img"');
  });

  it("uses a different gradient ID for every mounted piece", () => {
    const markup = renderToStaticMarkup(
      <>
        <PieceIcon color="white" type="p" />
        <PieceIcon color="white" type="n" />
      </>,
    );
    const ids = [...markup.matchAll(/id="(piece-fill-white-[^"]+)"/g)].map(
      ([, id]) => id,
    );

    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    for (const id of ids) {
      expect(markup).toContain(`url(#${id})`);
    }
  });
});
