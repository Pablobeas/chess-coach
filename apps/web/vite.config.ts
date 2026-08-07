import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type ProxyOptions } from "vite";

const MAIA3_PROXY_UNAVAILABLE_MESSAGE =
  "El companion local de Maia-3 no esta disponible. Ejecuta pnpm dev o play para iniciarlo.";

type ProxyResponseLike = {
  headersSent?: boolean;
  writeHead(status: number, headers: Record<string, string>): void;
  end(body: string): void;
};

export function createMaiaProxyOptions(target: string): ProxyOptions {
  return {
    target,
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/maia3-api/, ""),
    configure(proxy) {
      (
        proxy as unknown as {
          on(
            event: "error",
            handler: (
              error: unknown,
              request: unknown,
              response: ProxyResponseLike,
            ) => void,
          ): void;
        }
      ).on("error", (_error, _request, response) => {
        if (!response || response.headersSent) return;
        response.writeHead(502, {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
        });
        response.end(
          JSON.stringify({
            error: MAIA3_PROXY_UNAVAILABLE_MESSAGE,
            code: "maia3_bridge_unavailable",
          }),
        );
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, "", "");
  const bridgeHost = env.MAIA3_BRIDGE_HOST || "127.0.0.1";
  const bridgePort = Number(env.MAIA3_BRIDGE_PORT || "8765");

  if (!Number.isInteger(bridgePort) || bridgePort < 1) {
    throw new Error("MAIA3_BRIDGE_PORT debe ser un entero positivo");
  }

  return {
    plugins: [react()],
    server: {
      proxy: {
        "/maia3-api": createMaiaProxyOptions(
          `http://${bridgeHost}:${bridgePort}`,
        ),
      },
    },
  };
});
