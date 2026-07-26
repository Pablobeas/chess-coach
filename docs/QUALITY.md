# Calidad y evaluaciones

Se prueban navegaciÃ³n sin bifurcar, creaciÃ³n/eliminaciÃ³n/promociÃ³n reversible,
lÃ­mite de cinco pruebas y persistencia/migraciÃ³n v5â†’v6, incluyendo datos corruptos.

## MetodologÃ­a de desarrollo

Usamos desarrollo guiado por funcionalidades con TDD en las capas crÃ­ticas. Cada
entrega debe ser una rebanada vertical pequeÃ±a que aporte un flujo observable, no
una colecciÃ³n de capas incompletas.

El ciclo es:

1. Criterios de aceptaciÃ³n de la funcionalidad.
2. Tests primero para dominio, contratos y riesgos conocidos.
3. ImplementaciÃ³n mÃ­nima.
4. IntegraciÃ³n y E2E si el flujo cruza Worker, almacenamiento o UI.
5. RevisiÃ³n de rendimiento, accesibilidad y regresiones.

La interfaz puede explorarse visualmente antes de fijar todos sus detalles, pero no
se considera terminada hasta que sus estados importantes tengan pruebas de regresiÃ³n.

## PirÃ¡mide de pruebas

- Unitarias: normalizaciÃ³n de puntuaciones, UCI, clasificaciÃ³n y pistas.
- IntegraciÃ³n: Worker simulado, cancelaciÃ³n, mensajes tardÃ­os y sesiÃ³n completa.
- E2E: jugar, deshacer, pausar, reanudar, guardar y exportar PGN.
- Evaluaciones: posiciones FEN/PGN con invariantes pedagÃ³gicas.
- Rendimiento: latencia, memoria, tamaÃ±o WASM y bloqueo del hilo principal.

## Invariantes crÃ­ticas

- Una evaluaciÃ³n siempre declara perspectiva.
- Mate y centipeones son variantes incompatibles del mismo tipo.
- Un resultado tardÃ­o no puede sobrescribir una posiciÃ³n nueva.
- Deshacer invalida anÃ¡lisis y feedback posteriores.
- Una pista de nivel 3 siempre propone un movimiento legal.
- Toda evaluaciÃ³n visible usa la perspectiva del usuario, tambiÃ©n tras una jugada de Maia.
- Solo las jugadas del usuario reciben clasificaciÃ³n, icono y explicaciÃ³n pedagÃ³gica.
- Una cita de movimiento, pieza, casilla o consecuencia debe estar respaldada por evidencia validada.
- El modo sin ayudas no muestra flechas ni evaluaciÃ³n accidentalmente.
- La partida se puede recuperar despuÃ©s de recargar la PWA.
- El color del usuario ocupa la zona inferior y el orden DOM del tablero coincide con
  su orden visual, tanto con blancas como con negras.
- `ready` de Maia implica que el modelo completÃ³ una inferencia de calentamiento; un
  error o reintento nunca modifica la posiciÃ³n mientras no exista una jugada legal.
- El lanzador de desarrollo no deja la web disponible hasta que `/health` confirma
  `ready`, y un 502 del proxy se interpreta como bridge no disponible, no como una
  respuesta ajedrecÃ­stica vÃ¡lida.
- La navegaciÃ³n conserva una sola sesiÃ³n completa y un cursor; no acumula una sesiÃ³n
  prefijo por cada deshacer o selecciÃ³n histÃ³rica.
- El precÃ¡lculo del turno humano debe coincidir exactamente en FEN, perspectiva,
  preset, MultiPV y lÃ­mite con la bÃºsqueda anterior consumida por el entrenador.
- La evaluaciÃ³n posterior a la jugada siempre procede de una bÃºsqueda completa con
  su presupuesto normal; nunca de transformar la puntuaciÃ³n MultiPV de la raÃ­z.
- Un icono provisional procede Ãºnicamente de progreso normalizado de la misma bÃºsqueda
  posterior con PV reproducibles por completo, se identifica como provisional y nunca
  se persiste.
- El icono final y `CoachTurnRecord.assessment` se calculan mediante la misma funciÃ³n
  pura; navegar o cancelar impide que progreso tardÃ­o reaparezca.

## Evaluaciones de ajedrez

Las fixtures deben cubrir aperturas, tÃ¡cticas, posiciones tranquilas, finales, mates,
ahogados, Ãºnica jugada, varias jugadas equivalentes y posiciones ya perdidas. Evita
asserts exactos de centipeones salvo que tambiÃ©n fijes motor, hash, hilos, hash table,
semilla y presupuesto.

Las evaluaciones de texto comprueban propiedades â€”legalidad, motivo permitido,
honestidad, presencia de alternativa y ausencia de contradiccionesâ€” en lugar de fijar
frases completas. La misma entrada debe ser reproducible y las jugadas cercanas no
deben repetir de forma mecÃ¡nica la misma familia de plantilla.

## Presupuestos iniciales

- Ninguna espera sÃ­ncrona del motor en el hilo principal.
- Feedback intermedio visible antes de que una bÃºsqueda larga parezca bloqueo.
- CancelaciÃ³n observable al cambiar de posiciÃ³n.
- Una fixture de 100 medias jugadas conserva FEN/PGN y valida historial y feedback
  con recorridos lineales, sin reconstruir cada prefijo por separado.
- La validaciÃ³n legal de una PV UCI completa ocurre al publicar las lÃ­neas finales,
  no para cada actualizaciÃ³n intermedia de profundidad.
- El progreso UCI aparece antes del resultado final, no genera un segundo `go`, conserva
  el lÃ­mite solicitado y deja de notificarse tras abortar o completar la bÃºsqueda.
- Si un backend publica progreso y despuÃ©s falla, se retira el provisional antes de
  aceptar progreso o resultado de un fallback.
- La cachÃ© de anÃ¡lisis distingue FEN, perspectiva, preset, MultiPV y lÃ­mite; no guarda
  bÃºsquedas canceladas ni fallidas y mantiene una capacidad mÃ¡xima explÃ­cita.
- Dos solicitudes simultÃ¡neas con la misma clave comparten una sola bÃºsqueda; cancelar
  al consumidor no cancela un precÃ¡lculo independiente que ya estÃ¡ en curso.
- Stockfish configura `Hash=64` una sola vez antes de la primera bÃºsqueda y conserva
  la tabla de transposiciÃ³n entre anÃ¡lisis.
- El presupuesto final por dispositivo se fijarÃ¡ tras medir hardware real.

## Puerta de entrega

Una funcionalidad pasa cuando `pnpm check` termina correctamente, sus criterios de
aceptaciÃ³n estÃ¡n cubiertos, la revisiÃ³n independiente no tiene hallazgos crÃ­ticos y
las brechas de verificaciÃ³n manual estÃ¡n declaradas.

## Cobertura actual

- Unitarias y de integración cubren la identidad semántica de media jugada, la
  cancelación, el manejo de resultados tardíos y la transición de `pending` a
  `ready`/`unavailable`.
- Las regresiones de UI deben incluir móvil y escritorio con Chromium y WebKit en
  320x568, 390x844 y 568x320.
- La verificación móvil confirma que el documento no desplaza la pantalla en uso
  normal, que el tablero y el resumen siguen visibles y que el feedback termina en
  tiempo o informa error recuperable.
