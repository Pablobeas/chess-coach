export function normalizeApplicationBase(base: string): string {
  if (
    !base.startsWith("/") ||
    base.startsWith("//") ||
    !base.endsWith("/") ||
    base.includes("?") ||
    base.includes("#") ||
    base.split("/").some((segment) => segment === "." || segment === "..")
  ) {
    throw new Error(`Invalid application base: ${base}`);
  }
  return base;
}

export const APPLICATION_BASE = normalizeApplicationBase(
  import.meta.env.BASE_URL,
);

export function applicationUrl(
  path: string,
  origin = window.location.origin,
): URL {
  return new URL(path.replace(/^\/+/, ""), new URL(APPLICATION_BASE, origin));
}
