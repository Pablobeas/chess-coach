# Navegación compacta y análisis reutilizable

## Contexto

La partida normal ya evita reconstrucciones cúbicas, pero la navegación conserva un
`GameSession` por cada cursor futuro. Además, la evaluación anterior se inicia después
de la jugada aunque su FEN y configuración ya se conocen durante el turno humano. Hay
que reducir memoria y sacar trabajo de la ruta crítica sin disminuir presupuesto,
fuerza, legalidad ni evidencia pedagógica.

## Criterios de aceptación

- Navegar por una partida de 100 medias jugadas conserva una sola sesión completa de
  la rama y un cursor, no un array de sesiones con prefijos duplicados.
- Deshacer, rehacer, seleccionar una jugada, continuar una rama y recuperar el respaldo
  mantienen FEN, PGN, anotaciones y feedback actuales.
- La posición anterior se precalcula durante el tiempo de reflexión del usuario y la
  solicitud posterior reutiliza ese resultado exacto o su promesa en curso.
- La posición posterior conserva siempre una búsqueda completa con el mismo presupuesto;
  una puntuación/WDL MultiPV de la raíz nunca sustituye la evaluación del hijo.
- La clasificación y el texto resultantes son equivalentes para la misma evidencia;
  mates, WDL y perspectiva no se transforman incorrectamente.
- Cancelación, timeout y caché siguen descartando respuestas tardías.

## Propiedad y coordinación

| Bloque                      | Agente                 | Archivos permitidos                           | Dependencias             |
| --------------------------- | ---------------------- | --------------------------------------------- | ------------------------ |
| Mapa de impacto             | `repo_explorer`        | Solo lectura                                  | Ninguna                  |
| Navegación compacta         | `frontend_builder`     | `apps/web/src/App.tsx`, `navigationTimeline*` | API core actual          |
| Reutilización analítica     | `chess_engine`         | `packages/engine/src/index*`                  | Contratos engine/coach   |
| Invariantes de calidad      | `qa_evals`             | Solo lectura inicialmente                     | Hallazgos del motor      |
| Integración y documentación | Agente principal       | Archivos restantes                            | Resultados anteriores    |
| Revisión final              | `independent_reviewer` | Solo lectura                                  | Implementación terminada |

## Pasos

- [x] Medir estructura y llamadas actuales con fixtures de 100 medias jugadas.
- [x] Sustituir `redoStack` por rama completa + cursor derivado.
- [x] Precalcular y deduplicar en curso la evaluación anterior durante el turno humano.
- [x] Validar equivalencia pedagógica y fallback a búsqueda completa.
- [x] Ejecutar `pnpm check` y revisión independiente.

## Decisiones

No se reducen `movetime`, profundidad, MultiPV previo ni fuerza. La puntuación/WDL de
una candidata MultiPV pertenece a la raíz anterior y no equivale a analizar la posición
posterior; por eso solo se adelanta trabajo exacto de la misma FEN/configuración. En
cualquier duda se usa el camino actual.

## Validación

- `pnpm check`: correcto; 105 tests de paquetes y 7 tests del companion pasan,
  además de `typecheck` y el build de producción.
- Fixture de navegación de 100 medias jugadas: conserva una sesión completa + cursor,
  mantiene FEN/PGN y crea una rama de 40 plies sin modificar la línea original.
- Caché: una búsqueda exacta en curso se comparte; un consumidor cancelado no cancela
  el precálculo y los fallos no se almacenan.
- Handshake UCI: `Hash=64` se emite una sola vez antes del primer `go`; dos búsquedas
  conservan sus límites y `MultiPV` propios.
- `git diff --check`: correcto.
- Revisión independiente final: sin hallazgos P0, P1 ni P2 tras corregir la propiedad
  de cancelación de búsquedas compartidas y detener precálculos obsoletos.
- `pnpm format:check`: únicamente señala `tools/maia3-bridge.mjs`, archivo preexistente
  y ajeno a esta fase; todos los archivos modificados aquí se formatearon con Prettier.

## Estado final

Completado.
