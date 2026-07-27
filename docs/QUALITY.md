# Calidad y evaluaciones

Se prueban navegación sin bifurcar, creación/eliminación/promoción reversible,
límite de cinco pruebas y persistencia/migración v5→v6, incluyendo datos corruptos.

## Metodología de desarrollo

Usamos desarrollo guiado por funcionalidades con TDD en las capas críticas. Cada
entrega debe ser una rebanada vertical pequeña que aporte un flujo observable, no
una colección de capas incompletas.

El ciclo es:

1. Criterios de aceptación de la funcionalidad.
2. Tests primero para dominio, contratos y riesgos conocidos.
3. Implementación mínima.
4. Integración y E2E si el flujo cruza Worker, almacenamiento o UI.
5. Revisión de rendimiento, accesibilidad y regresiones.

La interfaz puede explorarse visualmente antes de fijar todos sus detalles, pero no
se considera terminada hasta que sus estados importantes tengan pruebas de regresión.

## Pirámide de pruebas

- Unitarias: normalización de puntuaciones, UCI, clasificación y pistas.
- Integración: Worker simulado, cancelación, mensajes tardíos y sesión completa.
- E2E: jugar, deshacer, pausar, reanudar, guardar y exportar PGN.
- Evaluaciones: posiciones FEN/PGN con invariantes pedagógicas.
- Rendimiento: latencia, memoria, tamaño WASM y bloqueo del hilo principal.

## Invariantes críticas

- Una evaluación siempre declara perspectiva.
- Mate y centipeones son variantes incompatibles del mismo tipo.
- Un resultado tardío no puede sobrescribir una posición nueva.
- Deshacer invalida análisis y feedback posteriores.
- Una pista de nivel 3 siempre propone un movimiento legal.
- Toda evaluación visible usa la perspectiva del usuario, también tras una jugada de Maia.
- Solo las jugadas del usuario reciben clasificación, icono y explicación pedagógica.
- Una cita de movimiento, pieza, casilla o consecuencia debe estar respaldada por evidencia validada.
- El modo sin ayudas no muestra flechas ni evaluación accidentalmente.
- La partida se puede recuperar después de recargar la PWA.
- El color del usuario ocupa la zona inferior y el orden DOM del tablero coincide con
  su orden visual, tanto con blancas como con negras.
- `ready` de Maia implica que el modelo completó una inferencia de calentamiento; un
  error o reintento nunca modifica la posición mientras no exista una jugada legal.
- El lanzador de desarrollo no deja la web disponible hasta que `/health` confirma
  `ready`, y un 502 del proxy se interpreta como bridge no disponible, no como una
  respuesta ajedrecística válida.
- La navegación conserva una sola sesión completa y un cursor; no acumula una sesión
  prefijo por cada deshacer o selección histórica.
- El precálculo del turno humano debe coincidir exactamente en FEN, perspectiva,
  preset, MultiPV y límite con la búsqueda anterior consumida por el entrenador.
- La evaluación posterior a la jugada siempre procede de una búsqueda completa con
  su presupuesto normal; nunca de transformar la puntuación MultiPV de la raíz.
- Un icono provisional procede únicamente de progreso normalizado de la misma búsqueda
  posterior con PV reproducibles por completo, se identifica como provisional y nunca
  se persiste.
- El icono final y `CoachTurnRecord.assessment` se calculan mediante la misma función
  pura; navegar o cancelar impide que progreso tardío reaparezca.

## Evaluaciones de ajedrez

Las fixtures deben cubrir aperturas, tácticas, posiciones tranquilas, finales, mates,
ahogados, única jugada, varias jugadas equivalentes y posiciones ya perdidas. Evita
asserts exactos de centipeones salvo que también fijes motor, hash, hilos, hash table,
semilla y presupuesto.

Las evaluaciones de texto comprueban propiedades —legalidad, motivo permitido,
honestidad, presencia de alternativa y ausencia de contradicciones— en lugar de fijar
frases completas. La misma entrada debe ser reproducible y las jugadas cercanas no
deben repetir de forma mecánica la misma familia de plantilla.

Las evaluaciones semánticas del feedback v3 verifican además que la vista compacta y
la ampliada no son idénticas, que la confianza interna baja no inventa una causa y
que el texto no expone PV, centipeones ni términos internos. También comprueban que
las variantes semánticamente equivalentes se seleccionan de forma determinista por
identidad, que la misma media jugada conserva la misma familia al recargar y que la
selección no depende de memoria reciente ni aleatoriedad.

Las evaluaciones de postpartida validan `PostgameSummary v1`, el contrato de
snapshot terminal y que la revisión solo consume la línea final, no una vista por
movimiento. La cobertura de estabilidad RMS comprueba los buckets `coverage`,
`partial` y `no-margin`, y que blancas y negras se calculan en contadores separados.
Las pruebas de engine cubren la estrategia secuencial `missing-only` y `cancel-resume`
de la cola compartida.

## Presupuestos iniciales

- Ninguna espera síncrona del motor en el hilo principal.
- Feedback intermedio visible antes de que una búsqueda larga parezca bloqueo.
- Cancelación observable al cambiar de posición.
- Una fixture de 100 medias jugadas conserva FEN/PGN y valida historial y feedback
  con recorridos lineales, sin reconstruir cada prefijo por separado.
- La validación legal de una PV UCI completa ocurre al publicar las líneas finales,
  no para cada actualización intermedia de profundidad.
- El progreso UCI aparece antes del resultado final, no genera un segundo `go`, conserva
  el límite solicitado y deja de notificarse tras abortar o completar la búsqueda.
- Si un backend publica progreso y después falla, se retira el provisional antes de
  aceptar progreso o resultado de un fallback.
- La caché de análisis distingue FEN, perspectiva, preset, MultiPV y límite; no guarda
  búsquedas canceladas ni fallidas y mantiene una capacidad máxima explícita.
- Dos solicitudes simultáneas con la misma clave comparten una sola búsqueda; cancelar
  al consumidor no cancela un precálculo independiente que ya está en curso.
- Stockfish configura `Hash=64` una sola vez antes de la primera búsqueda y conserva
  la tabla de transposición entre análisis.
- El presupuesto final por dispositivo se fijará tras medir hardware real.
- El feedback v3 termina siempre en `ready` o `unavailable`, y un resultado tardío solo
  se aplica si la media jugada sigue siendo la misma identidad semántica.

## Puerta de entrega

Una funcionalidad pasa cuando `pnpm check` termina correctamente, sus criterios de
aceptación están cubiertos, la revisión independiente no tiene hallazgos críticos y
las brechas de verificación manual están declaradas.

## Publicación en Pages

- La publicación parte del commit exacto del repositorio privado y solo sincroniza el
  árbol de artefactos estáticos hacia `chess-coach-play`.
- `pnpm build:pages` debe generar una base `/chess-coach-play/` válida para recursos,
  service worker y fallback 404 sin depender de Sites/root.
- La ruta pública conserva el modo offline-first, el análisis local con Stockfish/WASM
  y excluye Maia hosted o cualquier backend remoto en la experiencia publicada.
- Un rollback válido restaura un commit o versión anterior del repo público y vuelve a
  ejecutar el mismo flujo de validación antes de anunciarlo como publicado.

## Cobertura actual

- Unitarias e integración cubren la identidad semántica de media jugada, la
  cancelación, el manejo de resultados tardíos y la transición de `pending` a
  `ready`/`unavailable`.
- Las regresiones de UI deben incluir móvil y escritorio con Chromium y WebKit en
  320x568, 390x844 y 568x320.
- La verificación móvil confirma que el documento no desplaza la pantalla en uso
  normal, que el tablero y el resumen siguen visibles y que el feedback termina en
  tiempo o informa error recuperable.
- Las pruebas de interacción deben cubrir que la última jugada rival queda
  resaltada en amarillo durante el turno del usuario, que el estado se limpia tras la
  siguiente jugada y que la navegación por flechas y variantes conserva ese contexto
  visual.
- La accesibilidad verifica que ese contexto también se comunica sin depender solo
  del color, mediante texto visible y atributos ARIA.
- La cobertura de engine añade un caso de bootstrap lento seguido de handshake
  `readyok` y búsqueda activa, y otro de análisis interrumpido por la jugada del
  rival para confirmar que el broker entrega el control al nuevo actor sin dejar
  estados colgados.
- La cobertura de preemption distingue reencolado interno único tras rival
  prioritario, cancelación externa o stale sin reintento y segunda interrupción con
  caída a `unavailable` y retry manual.

## Centro de entrenamiento v1

- `pnpm verify:training-content` ejecuta `node tools/training/verify-puzzles-v1.mjs`
  y produce el reporte `output/training/verify-puzzles-v1-report.json`.
- La verificación documenta Stockfish 18 Lite WASM con `jsSha256`, `wasmSha256`,
  licencia `GPL-3.0` y presupuesto `Hash=16 MB`, `userMoveNodes=50000`,
  `replyMoveNodes=50000` y `userMoveMultiPvLimit=4`.
- La cobertura de regresión relevante vive en `tests/evals/training/puzzles-v1.test.ts`,
  `tests/evals/training/opening-safety.test.ts`,
  `apps/web/src/TrainingApp.test.ts` y `tests/e2e/training-flows.spec.ts`.
- La práctica de aperturas debe seguir siendo cancelable y no bloqueante; la evidencia
  tardía u obsoleta no puede aplicar una jugada nueva.
