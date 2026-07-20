# Mantener fluida una partida larga

## Contexto

Tras unas 50 jugadas la partida se vuelve muy lenta. Hay que identificar si el coste
procede de búsquedas Stockfish redundantes, trabajo acumulativo del entrenador o
renderizado/persistencia del historial, y eliminar solo trabajo que no aporte evidencia
necesaria. Deben conservarse la legalidad, la calidad pedagógica, la cancelación y el
funcionamiento offline.

## Criterios de aceptación

- Una media jugada nueva no repite una evaluación ya disponible para la misma FEN y
  configuración de análisis.
- El trabajo de análisis por turno queda acotado y no crece con la longitud de la partida.
- Las respuestas antiguas o canceladas no actualizan la sesión.
- Una partida de al menos 100 medias jugadas conserva interacción y renderizado fluidos
  bajo una prueba de regresión determinista.
- Se mantienen las clasificaciones, explicaciones y jugadas legales existentes.

## Propiedad y coordinación

| Bloque                  | Agente                 | Archivos permitidos                                | Dependencias             |
| ----------------------- | ---------------------- | -------------------------------------------------- | ------------------------ |
| Exploración transversal | `repo_explorer`        | Solo lectura                                       | Ninguna                  |
| Motor y Worker          | `chess_engine`         | Diagnóstico inicial; propiedad posterior explícita | Contrato actual          |
| React y sesión          | `frontend_builder`     | Diagnóstico inicial; propiedad posterior explícita | Skill React              |
| Medición y regresiones  | `qa_evals`             | Diagnóstico inicial; propiedad posterior explícita | Hallazgos                |
| Integración             | Agente principal       | Archivos coordinados                               | Todos los hallazgos      |
| Revisión final          | `independent_reviewer` | Solo lectura                                       | Implementación terminada |

## Pasos

- [x] Capturar el flujo real y localizar crecimiento por turno.
- [x] Añadir una regresión que simule una partida larga o muchas solicitudes.
- [x] Eliminar análisis, serialización o renders redundantes.
- [x] Validar paquetes afectados y `pnpm check`.
- [x] Completar revisión independiente.

## Decisiones

No se reducirá silenciosamente la calidad del motor antes de medir. Se priorizan
reutilización por FEN, cancelación correcta, límites explícitos y trabajo incremental.

El cuello de botella principal era algorítmico fuera de Stockfish: aplicación/deshacer
reproducían el historial, y persistencia repetía ese trabajo por cada feedback. Las
sesiones confiables avanzan desde su FEN actual; las cargadas se siguen validando.
Stockfish conserva el mismo presupuesto temporal, usa MultiPV solo donde se consumen
alternativas y valida legalmente únicamente las variantes finales.

Los análisis completos se guardan en una LRU de 32 entradas por FEN y configuración.
Tras `stop`, una barrera `isready` drena respuestas tardías antes de la búsqueda siguiente.
La navegación histórica conserva su estructura de snapshots fuera del camino normal.

## Validación

- `pnpm check`: correcto; typecheck, 101 tests y build de producción pasan.
- `git diff --check`: correcto.
- Tests de 100 medias jugadas: FEN/PGN, historial, render y feedback correctos.
- Tests UCI: PV final legal, timeout, cancelación y `bestmove` tardío correctos.
- `pnpm format:check`: los archivos de esta tarea pasan; el comando global mantiene
  un fallo previo ajeno al alcance en `tools/maia3-bridge.mjs`.
- Revisión independiente final: sin hallazgos P0, P1 ni P2.

## Estado final

Completado. El trabajo normal por turno deja de reconstruir todos los prefijos y la
persistencia pasa de crecimiento cúbico aproximado a un recorrido lineal. Queda como
mejora futura reducir el tamaño de los snapshots al navegar ramas muy largas.
