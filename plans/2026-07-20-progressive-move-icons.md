# Iconos progresivos de valoración

## Contexto

El icono de calidad se publica únicamente después de resolver las búsquedas anterior
y posterior y construir el registro completo del entrenador. La construcción de
motivos, texto y pistas es síncrona y breve; la espera real es que Stockfish termine
la búsqueda posterior completa (250/700/1500 ms según preset). Para mostrar una
valoración casi inmediata sin añadir una segunda búsqueda ni reducir calidad final,
se aprovecharán las actualizaciones `info` de la misma búsqueda UCI en curso.

## Criterios de aceptación

- La búsqueda posterior publica progreso normalizado antes de `bestmove`, sin resolver
  anticipadamente el resultado final ni ejecutar un segundo `go`.
- El icono provisional aparece cuando existen evaluación anterior completa y una
  actualización posterior válida; solo se actualiza si cambia la etiqueta.
- El icono provisional está marcado como tal para accesibilidad y nunca se persiste.
- Al terminar Stockfish, el registro completo y el icono final se calculan con el mismo
  presupuesto y evidencia actuales; el valor final sustituye al provisional.
- Cancelar, navegar, pausar, reiniciar o crear una rama elimina el provisional y evita
  que una actualización tardía reaparezca.
- Las búsquedas compartidas entregan progreso a todos sus consumidores activos y dejan
  de notificar al consumidor cancelado.

## Propiedad

| Bloque                | Propietario            | Archivos                       |
| --------------------- | ---------------------- | ------------------------------ |
| Contrato/progreso UCI | `chess_engine`         | `packages/engine/src/index*`   |
| Assessment temprano   | `coach_designer`       | `packages/coach/src/index*`    |
| Caché/UI/transitorio  | Agente principal       | `apps/web/src/**`, docs y plan |
| Revisión final        | `independent_reviewer` | Solo lectura                   |

## Pasos

- [x] Añadir progreso cancelable al contrato del motor y sus tests UCI.
- [x] Extraer una evaluación pura compartida por el icono y `analyzeTurn`.
- [x] Distribuir progreso mediante la caché y renderizar un icono transitorio.
- [x] Cubrir equivalencia final, consumidores compartidos y limpieza por navegación.
- [x] Ejecutar `pnpm check` y revisión independiente.

## Decisiones

No se ejecuta una búsqueda rápida adicional: aumentaría trabajo y retrasaría el
feedback completo. Tampoco se usa la puntuación MultiPV de la posición padre como
evaluación del hijo. El provisional procede de la misma búsqueda posterior que ya se
está ejecutando y el resultado final conserva la única autoridad persistida.

## Estado

Completado.

## Validación

- `pnpm check`: correcto; 116 tests de paquetes y 7 tests del companion, typecheck
  estricto y build de producción.
- Motor: progreso normalizado antes del resultado, un solo `go`, límites conservados y
  ausencia de callbacks tras abort/final.
- Coach: `assessTurn` y `analyzeTurn` son equivalentes en fixtures WDL, centipeones,
  mate, oportunidad perdida, posición ya perdida y brillante.
- Web: fan-out de progreso por consumidor, limpieza al abortar, profundidad mínima,
  deduplicación de renders y prioridad de la anotación final.
- Navegador real, preset avanzado con precálculo parcialmente caliente: icono
  provisional a 924 ms y final a 1891 ms; ambos anunciados con estado correcto. La
  prueba detectó y permitió corregir el reenvío omitido en `engineClient`.
- Revisión independiente: sus casos de PV intermedia ilegal y progreso de un backend
  fallido están cubiertos mediante validación completa y un evento `reset` probado con
  fallback WASM → ASM.js; no quedan hallazgos P0-P2.
- `git diff --check` y Prettier sobre todos los archivos de esta fase: correctos. El
  chequeo global conserva el aviso preexistente de `tools/maia3-bridge.mjs`.
