import { defineConfig } from "vitest/config";
import { fileURLToPath, URL } from "node:url";

const source = (packageName: string) =>
  fileURLToPath(
    new URL(`../../packages/${packageName}/src/index.ts`, import.meta.url),
  );

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  resolve: {
    alias: {
      "@chess-coach/chess-core": source("chess-core"),
      "@chess-coach/engine": source("engine"),
      "@chess-coach/coach": source("coach"),
    },
  },
  test: {
    include: ["contextual-feedback-v3.test.ts"],
  },
});
