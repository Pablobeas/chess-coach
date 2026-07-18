# Calidad y evaluaciones

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
- El modo sin ayudas no muestra flechas ni evaluación accidentalmente.
- La partida se puede recuperar después de recargar la PWA.

## Evaluaciones de ajedrez

Las fixtures deben cubrir aperturas, tácticas, posiciones tranquilas, finales, mates,
ahogados, única jugada, varias jugadas equivalentes y posiciones ya perdidas. Evita
asserts exactos de centipeones salvo que también fijes motor, hash, hilos, hash table,
semilla y presupuesto.

## Presupuestos iniciales

- Ninguna espera síncrona del motor en el hilo principal.
- Feedback intermedio visible antes de que una búsqueda larga parezca bloqueo.
- Cancelación observable al cambiar de posición.
- El presupuesto final por dispositivo se fijará tras medir hardware real.

## Puerta de entrega

Una funcionalidad pasa cuando `pnpm check` termina correctamente, sus criterios de
aceptación están cubiertos, la revisión independiente no tiene hallazgos críticos y
las brechas de verificación manual están declaradas.
