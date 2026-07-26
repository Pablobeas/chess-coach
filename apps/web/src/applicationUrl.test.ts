import { describe, expect, it } from "vitest";
import { applicationUrl, normalizeApplicationBase } from "./applicationUrl";

describe("application URL base", () => {
  it("keeps all hosted assets inside the Pages project path", () => {
    expect(
      new URL(
        "stockfish/launcher.js",
        new URL(
          normalizeApplicationBase("/chess-coach-play/"),
          "https://pablobeas.github.io",
        ),
      ).toString(),
    ).toBe(
      "https://pablobeas.github.io/chess-coach-play/stockfish/launcher.js",
    );
  });

  it.each([
    "chess-coach-play/",
    "/chess-coach-play",
    "//host/",
    "/a/../b/",
    "/a/?x=1",
  ])("rejects an unsafe base %s", (base) =>
    expect(() => normalizeApplicationBase(base)).toThrow(
      "Invalid application base",
    ),
  );

  it("resolves root-build assets from the origin root", () => {
    expect(applicationUrl("sw.js", "https://coach.example").toString()).toBe(
      "https://coach.example/sw.js",
    );
  });
});
