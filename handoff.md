# Handoff — Chess Coach

## Estado actual

- Incidencia de bootstrap Stockfish WASM resuelta en el entorno local.
- Causa: el sufijo `,worker` de Stockfish.js 18 activa la rama de pthreads internos; el artefacto `lite-single` necesita recibir únicamente la URL codificada del `.wasm` en el fragmento.
- El cliente crea el Worker directamente sobre `stockfish-18-lite-single.js`; no hay Worker anidado para WASM.
- El motor determinista queda restringido a tests y desarrollo. No se usa como fallback de producción.
- ASM.js continúa como fallback local mediante `launcher.js`.

### Slice visual del tablero

- Piezas SVG inline bicolor: relleno marfil/oscuro y contornos de alto contraste.
- Bandejas `Capturadas por ti` y `Capturadas por Stockfish`, calculadas desde el historial legal, incluyendo captura al paso y promoción.
- Insignias visuales `★`, `✓`, `!`, `?` y `‼` para las calidades de las jugadas del usuario; la última aparece también en la casilla de destino y todas se conservan en el historial.
- Persistencia local v2 con migración desde v1, anotaciones validadas por índice/UCI y último feedback recuperable tras recargar.
- Validado en navegador: SVG, insignia `✓`, bandejas vacías, feedback y recuperación de partida/anotación.

### Slice de rastro y responsive

- Origen y destino de la última jugada se resaltan en amarillo para jugadas del usuario y de Stockfish.
- El rastro se deriva de `GameSession.history`, por lo que al deshacer se recalcula el movimiento anterior y sobrevive a recuperación local.
- El panel muestra SAN, recorrido `origen → destino`, autor y una nota accesible de la última jugada.
- El rastro visual usa una flecha SVG azul para el jugador y naranja-roja para Stockfish; ya no depende del resaltado amarillo.
- El tablero limita su tamaño por ancho y por altura (`dvh`), sin overflow horizontal en móvil.
- Validado en navegador a 390×844 y 1440×700; el tablero cabe horizontalmente y se reduce en ventanas de poca altura.

## Evidencia reproducible

- `apps/web/public/stockfish-smoke.html` ejecuta el smoke sin React, sin service worker y sin cliente de engine.
- En `http://127.0.0.1:5177/stockfish-smoke.html`: petición `.wasm` HTTP 200, `Content-Type: application/wasm`, `WebAssembly.validate() = true`, `uciok`, `readyok`, `info` y `bestmove e2e4` legal.
- Tiempo observado del smoke WASM: aproximadamente 3,6 segundos incluyendo carga y análisis.
- En la aplicación real: `Stockfish WASM`, respuesta legal `e7e6`/`e7e5` y feedback antes/después generado por el motor real.

## Implementado en este slice

- Contrato UCI cancelable con presets, handshake `uci → isready`, estados `loading`, `ready`, `analyzing`, `error` y `disposed`.
- Validación de legalidad contra el FEN solicitado y descarte por generación/request id.
- Fallback local Stockfish ASM.js sin fallback determinista silencioso.
- Launcher con diagnóstico de errores de carga para ASM.js.
- Artefactos Stockfish 18.0.8, hashes SHA-256, GPLv3 y avisos en `docs/THIRD_PARTY.md`.
- Smoke browser independiente en `apps/web/public/stockfish-smoke.html`.

## Validación

- `pnpm test` — verde.
- `pnpm typecheck` — verde.
- `pnpm build` — verde.
- `pnpm format:check` — verde.
- `git diff --check` — verde.
- Smoke browser WASM — verde.

## Pendientes del producto, fuera de esta incidencia

- E2E automatizado para los flujos críticos y fallback ASM.js en los cuatro motores de navegador.
- Detectores pedagógicos completos, pistas progresivas, flechas, amenazas y barra de evaluación.
- Resumen final, momentos críticos y revisión de partida.
- Auditoría WCAG 2.2, rendimiento, caché/offline y estrategia de actualización.
- WDL normalizado visible en la UI; el feedback actual usa puntuación/calibración determinista sobre evidencia Stockfish.

## Repositorio

- Repositorio: `Pablobeas/chess-coach`
- Rama: `agent/local-game-slice`
- PR draft: https://github.com/Pablobeas/chess-coach/pull/1

Actualizar este archivo antes de compactar la conversación o cerrar otro slice.
