# Handoff operativo

## Estado

Repositorio en `HEAD` limpio. Sin cambios pendientes en el árbol de trabajo.

## Misión del producto

Aplicación web/PWA de entrenamiento de ajedrez, offline-first, con privacidad por defecto.
La verdad del producto es local:

- reglas y legalidad en `chess-core`;
- análisis técnico en `engine` con un motor UCI local;
- feedback pedagógico en `coach`;
- UI y persistencia en `apps/web`.

No hay LLM en la ruta crítica del MVP.

## Arquitectura y dependencias

Flujo permitido:

- `web -> coach -> engine`
- `web -> chess-core`
- `coach -> chess-core`
- `engine -> chess-core`

Restricción:

- `chess-core`, `engine` y `coach` no deben importar nada de `apps/web`.

## UX actual relevante

- Experiencia móvil fija, con composición específica para pantallas pequeñas.
- Variante principal y líneas de prueba siguen aisladas.
- El feedback visible debe ser compacto y ampliable.
- El consejo debe aparecer rápido y sin bloquear la partida.
- La navegación por jugadas y variantes debe mantenerse accesible por teclado y táctil.

## Contrato de feedback

La salida del entrenador sigue estos niveles:

- `CoachTurnRecord` v3 para el análisis visible.
- `StoredGame` y `SessionWorkspace` v6 para persistencia.
- `MoveFeedbackRecord` sigue siendo la unidad de feedback por media jugada.

Reglas clave:

- el workspace es la fuente de verdad del feedback;
- la copia histórica solo se deriva al persistir;
- un `pending` recuperado no puede sobrescribir un resultado más reciente;
- la respuesta del rival no debe dejar un análisis atascado;
- el motor compartido permanece único;
- la UI puede marcar lento, error o reintento, pero nunca dejar feedback colgado sin estado final.

## Postgame

Resumen postpartida:

- `PostgameSummary` v1.
- `event-phases-v1`.
- estabilidad medida con RMS.
- el tramo terminal exacto no depende de `engine-after`.

## Respuesta del rival

La interacción con la jugada del rival mantiene:

- latencia objetivo corta;
- highlight inmediato de la continuación relevante;
- reintento sin duplicar la partida;
- aislamiento entre línea principal y variantes.

## Publicación

Flujo automático:

- `main` de `Pablobeas/chess-coach` publica al espejo `Pablobeas/chess-coach-play`.
- El sitio público se sirve desde GitHub Pages.
- La sincronización espejo→publicación es automática; no debe requerir pasos manuales extra para el flujo normal.

URLs conocidas:

- repositorio fuente: `Pablobeas/chess-coach`
- espejo público: `Pablobeas/chess-coach-play`
- URL pública: `https://pablobeas.github.io/chess-coach-play/`

## Commits recientes relevantes

- `be07869`
- `d39ec89`
- `c9cc16b`
- `9b14b97`
- `9804007`

## Validación final observada

- coach tests: `38`
- web tests: `171`
- mobile: `128 + 10 skip`
- desktop: `30`
- revisión pública: `Qxf7` visible en ~1s, diálogo en ~7s, y recorrido `7/7~5s` validado en Chromium/WebKit/reload

## Comandos útiles

```powershell
pnpm install
pnpm dev
pnpm typecheck
pnpm test
pnpm build
pnpm check
pnpm format:check
```

Para el flujo local de juego se usa:

```powershell
play
```

Nota: si `pnpm` no está disponible en PATH, el wrapper local puede fallar antes de levantar la UI.

## Seguridad y privacidad

- No exponer secretos ni credenciales.
- No enviar partidas a servicios remotos sin consentimiento explícito.
- Tratar toda salida del motor como no confiable.
- Mantener la ejecución local como ruta principal.

## Limitaciones y follow-ups honestos

- Las fases postgame todavía usan heurística; no es una semántica perfecta.
- No hay pedagogía postmovimiento por cada jugada terminal del postgame.
- Hay imports parciales y legado que aún conviene consolidar.
- GitHub Pages puede mostrar caché temporal en la URL pública aunque el espejo ya esté actualizado.

## Para continuar

1. Revisar `apps/web/src/App.tsx` para cualquier ajuste final de UX móvil.
2. Revisar `packages/coach/src/index.ts` si se quiere afinar el texto del feedback.
3. Revisar `apps/web/src/persistence.ts` y `apps/web/src/sessionWorkspace.ts` si cambia el contrato de guardado.
4. Revisar `tests/evals/postgame` y `tests/e2e/mobile-feedback.spec.ts` antes de tocar flujo visible.
5. Verificar `apps/web/src/styles.css` si reaparece desajuste visual en móvil o al abrir feedback.
