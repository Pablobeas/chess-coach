# Handoff — Chess Coach

## Estado actual

- Repositorio: `Pablobeas/chess-coach`
- Rama: `agent/local-game-slice`
- PR draft: https://github.com/Pablobeas/chess-coach/pull/1
- Último checkpoint publicado: `ae3814c docs: update development handoff`.
- Arquitectura: monorepo pnpm con `apps/web`, `packages/chess-core`, `packages/engine` y `packages/coach`.
- Producto: PWA web responsive, sin cuentas, telemetría, LLM, Ollama ni APIs en el camino crítico.
- Metodología: vertical feature slices con TDD para reglas, UCI, concurrencia, métricas y persistencia.

## Implementado en el checkpoint actual

- Stockfish 18 lite single-thread versionado en `apps/web/public/stockfish/`, con hashes, licencia GPL-3.0 y aviso en `docs/THIRD_PARTY.md`.
- Contrato UCI cancelable con presets principiante/intermedio/avanzado, request generation, descarte de resultados obsoletos, timeout y `dispose`.
- Fallback determinista local explícito cuando el Worker WASM no responde.
- Configuración de nueva partida: color, fuerza, nivel de ayuda y preferencias visuales.
- Jugador negro con primera jugada automática del motor, recuperación local versionada y borrado de datos.
- Pausar, reanudar, deshacer, reiniciar y abandonar.
- Importación y exportación PGN, con validación legal al importar.
- Feedback determinista visible después de la jugada del usuario: evidencia antes/después, clasificación, pérdida esperada, motivo y pista según nivel de ayuda.
- PWA base: manifest, icono, service worker y registro desde `main.tsx`.
- Regresiones unitarias de chess-core, engine/UCI, coach, persistencia y UI.

## Validación del checkpoint

- `pnpm test` — verde, 17 tests.
- `pnpm typecheck` — verde.
- `pnpm build` — verde.
- `pnpm format:check` — verde.
- `git diff --check` — verde.
- Smoke browser previo: configuración y flujo `e4 → e5` verificados.

## Riesgos y pendientes prioritarios

1. El archivo precompilado Stockfish ejecutado directamente como Worker no ha emitido UCI en el smoke browser; hay que resolver el bootstrap WASM con un wrapper Worker dedicado o confirmar el formato esperado por el paquete. No declarar Stockfish real operativo hasta repetir la prueba con `uciok`, `info` y `bestmove`.
2. El feedback actual usa el engine determinista para la evidencia visible; debe conectarse al análisis Stockfish antes/después cuando el Worker esté operativo.
3. Faltan detectores verificables completos: material, piezas colgadas, jaques, amenazas, rey, desarrollo, jugada única y equivalencias.
4. Faltan pistas 2/3 interactivas, flechas, barra de evaluación y amenaza principal en el tablero.
5. Faltan revisión final, momentos críticos, reloj opcional, migraciones futuras y E2E Playwright de escritorio/móvil.
6. Hay que revisar la estrategia de caché del service worker, accesibilidad WCAG 2.2, rendimiento del WASM y documentación de publicación.

## Próximo slice recomendado

Crear `stockfish.worker.ts` como wrapper explícito que cargue el WASM servido desde `/stockfish/`, responda al handshake UCI y exponga errores; añadir una prueba de navegador que demuestre `uciok → bestmove`. Después sustituir la evidencia determinista del panel de feedback por dos análisis reales y continuar con detectores/revisión final.

Antes de compactar la conversación, actualizar este archivo con commit, pruebas, PR y pendientes.
