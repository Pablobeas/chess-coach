# Handoff — Chess Coach

## Estado actual

- Repositorio: `Pablobeas/chess-coach`
- Rama: `agent/local-game-slice`
- PR draft: https://github.com/Pablobeas/chess-coach/pull/1
- Último checkpoint publicado: `2aa7e58 feat: add local playable game slice`; esta ronda aún está pendiente de commit/push.
- Arquitectura: monorepo pnpm con `apps/web`, `packages/chess-core`, `packages/engine` y `packages/coach`.
- Política de producto: MVP sin LLM ni Ollama; feedback determinista basado en reglas y motor local.
- Metodología: vertical feature slices con TDD para reglas, UCI, concurrencia, métricas y persistencia.

## Slice implementado

El tablero local ya tiene movimientos legales, historial SAN, deshacer, reinicio, estados de análisis y un motor simulado cancelable.

## Bloqueos detectados por revisión

1. La UI analiza la posición pero no aplica la respuesta del motor.
2. El motor simulado no garantiza la fixture `e2e4, e7e5`.
3. Falta una defensa explícita contra resultados obsoletos tras undo/restart o carreras de promesas.
4. La semántica `grid/gridcell` del tablero es mejorable.
5. Falta cobertura E2E automatizada de la experiencia web.

## Correcciones realizadas en esta ronda

- El motor y la UI aplican ahora la respuesta legal `e7e5` después de `e4`.
- Las respuestas se protegen con generación, request id, FEN y longitud de historial.
- Undo y restart invalidan análisis pendientes.
- El tablero usa filas `role="row"` y botones nativos accesibles.
- Se añadieron regresiones web para destinos legales, movimiento ilegal, `e4/e5` y undo.

## Siguiente trabajo

- Integrar Stockfish/WASM en Worker manteniendo este contrato.
- Añadir una suite E2E dedicada cuando el flujo de navegador se estabilice.
- Convertir la línea determinista en una política de fallback explícita del motor.
- Ejecutar una revisión de accesibilidad con lector de pantalla y teclado completo.

## Notas de continuidad

- No hacer release hasta que el usuario acepte el slice.
- El motor real Stockfish/WASM en Worker es el siguiente gran incremento después de cerrar esta ronda.
- Antes de compactar la conversación, actualizar este archivo con commit, pruebas, PR y pendientes.
