# Calidad y evaluaciones

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

## Puerta de entrega

Una funcionalidad pasa cuando `pnpm check` termina correctamente, sus criterios de
aceptación están cubiertos, la revisión independiente no tiene hallazgos críticos y
las brechas de verificación manual están declaradas.
