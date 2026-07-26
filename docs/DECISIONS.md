# Registro de decisiones

## ADR-008 --- Workspace de lineas v6 y arbol de variantes

**Estado:** aceptada.

`SessionWorkspace` v6 mantiene `mainLineId`, `activeLineId`, un cursor por linea y metadatos persistidos de bifurcacion y orden de creacion. Jugar desde una posicion historica crea una continuacion nueva; si la jugada del usuario y la respuesta del rival coinciden con una linea existente, ambas continuaciones se fusionan; si la respuesta cambia, se conserva como variante independiente.

Al promover una variante, la principal anterior se elimina y sus descendientes se reparentan por su prefijo comun. Al superar cinco variantes, la mas antigua se poda automaticamente. Una prueba E2E detecto que la promocion dejaba la principal anterior recuperable; el arreglo definitivo elimina la principal anterior antes de persistir el nuevo arbol y reubica sus descendientes en la nueva estructura.

## ADR-001 --- Aplicacion web/PWA primero

**Estado:** aceptada.

Se empieza con React/Vite y PWA para compartir implementaciÃƒÂ³n entre escritorio y
mÃƒÂ³vil. Una envoltura nativa puede evaluarse despuÃƒÂ©s de validar la experiencia.

## ADR-002 Ã¢â‚¬â€ AnÃƒÂ¡lisis local

**Estado:** aceptada.

La fuente de verdad serÃƒÂ¡ un motor UCI en WebAssembly ejecutado en Worker. El MVP no
dependerÃƒÂ¡ de una API de anÃƒÂ¡lisis.

## ADR-003 Ã¢â‚¬â€ Contratos separados

**Estado:** aceptada.

Reglas, motor, entrenador y UI son paquetes/capas diferentes. Esto permite probar
la pedagogÃƒÂ­a con resultados simulados y cambiar el motor sin reescribir la UI.

## ADR-004 Ã¢â‚¬â€ WDL antes que porcentaje inventado

**Estado:** aceptada.

Se usarÃƒÂ¡ WDL cuando estÃƒÂ© disponible y una curva calibrada cuando no. Cualquier valor
visible se nombrarÃƒÂ¡ como estimaciÃƒÂ³n y conservarÃƒÂ¡ su versiÃƒÂ³n de calibraciÃƒÂ³n.

## ADR-005 Ã¢â‚¬â€ OrquestaciÃƒÂ³n Codex por roles

**Estado:** aceptada.

El agente principal usa Sol con razonamiento alto exclusivamente como jefe de
orquestaciÃƒÂ³n: planifica, define criterios, asigna, media, decide y sintetiza. No
implementa, no edita archivos, no genera activos y no ejecuta validaciones rutinarias.
Cada encargo se clasifica antes de ejecutarse y se delega al rol ejecutor mÃƒÂ¡s especÃƒÂ­fico,
incluso si solo tiene una lÃƒÂ­nea de trabajo. GPT-5.4 implementa motor y cÃƒÂ³digo general;
Terra cubre frontend, coaching y activos visuales originales; Luna explora y evalÃƒÂºa;
GPT-5.4 mini realiza cambios mecÃƒÂ¡nicos; y GPT-5.5 aporta una revisiÃƒÂ³n independiente
read-only.

Cada entrega del ejecutor incluye un handoff con diff, evidencia y riesgos. Sol envÃƒÂ­a ese
material al revisor y devuelve `NEEDS_CHANGES` al mismo ejecutor mediante follow-up,
conservando la propiedad de archivos. El ciclo continÃƒÂºa mientras haya progreso y termina
con `APPROVED` y criterios/pruebas cumplidos, ante un bloqueo que exige usuario, permiso o
expansiÃƒÂ³n, o por estancamiento cuando se repite un hallazgo sin evidencia nueva. El revisor
puede responder `APPROVED_WITH_CONTINUATION`; Sol solo inicia esa continuaciÃƒÂ³n si es
concreta, medible, segura y permanece dentro del objetivo original. Las expansiones se
presentan al usuario.

La polÃƒÂ­tica del repositorio limita la profundidad a 1 para evitar delegaciÃƒÂ³n
recursiva y la concurrencia a cuatro subagentes. Estos lÃƒÂ­mites viven en `AGENTS.md`
para ser compatibles con las superficies de Codex que usan esquemas de configuraciÃƒÂ³n
distintos. Los modelos configurados son preferencias por rol, no concesiones de
acceso: si una cuenta o superficie no ofrece uno, el orquestador mantiene el rol y
declara el fallback disponible mÃƒÂ¡s cercano.

## ADR-006 Ã¢â‚¬â€ Feedback determinista sin LLM

**Estado:** aceptada.

El MVP no utilizarÃƒÂ¡ modelos de lenguaje remotos ni locales. Las explicaciones se
generan con evidencia de Stockfish, detectores de motivos y plantillas localizadas.
Esto mantiene el producto offline, reproducible y libre de coste por inferencia.

Ollama queda aplazado, no como dependencia prevista. Solo se reconsiderarÃƒÂ¡ mediante
una ADR nueva si una evaluaciÃƒÂ³n demuestra una mejora pedagÃƒÂ³gica concreta que no pueda
lograrse con reglas, y siempre como opciÃƒÂ³n desactivada por defecto con fallback local
determinista.

## ADR-007 Ã¢â‚¬â€ Desarrollo vertical con TDD selectivo

**Estado:** aceptada.

Las entregas se organizan como funcionalidades verticales completas. Dentro de cada
funcionalidad se aplica TDD a reglas de ajedrez, contratos UCI, concurrencia,
cancelaciÃƒÂ³n, mÃƒÂ©tricas, persistencia y otros comportamientos deterministas. La UI y
el diseÃƒÂ±o pueden iterarse exploratoriamente, pero deben acabar con criterios de
aceptaciÃƒÂ³n y pruebas de regresiÃƒÂ³n apropiadas.

Esta combinaciÃƒÂ³n mantiene el foco en valor usable sin sacrificar confianza en las
partes donde un error serÃƒÂ­a difÃƒÂ­cil de detectar manualmente.

## ADR-008 Ã¢â‚¬â€ Piezas de ajedrez originales y locales

**Estado:** aceptada.

El tablero utiliza un juego de piezas SVG dibujado especÃƒÂ­ficamente para el proyecto.
Puede compartir el lenguaje visual general de piezas Staunton digitales Ã¢â‚¬â€volumen,
contorno y legibilidadÃ¢â‚¬â€, pero no incorpora, descarga ni traza activos de Chess.com u
otros servicios. Las siluetas, gradientes y detalles se mantienen como cÃƒÂ³digo local
para que la experiencia siga funcionando sin red y no aÃƒÂ±ada dependencias de terceros.

Los cambios futuros del juego de piezas deben conservar una procedencia documentada.
Un activo externo solo podrÃƒÂ¡ incorporarse despuÃƒÂ©s de verificar su licencia y actualizar
`docs/THIRD_PARTY.md` antes de distribuirlo.

## ADR-009 Ã¢â‚¬â€ Maia-3 como oponente en el modo de escritorio local

**Estado:** aceptada con restricciÃƒÂ³n de distribuciÃƒÂ³n.

El oponente humano-realista usa Maia-3 5M mediante su interfaz UCI. Un companion Node
local mantiene el proceso Python/PyTorch caliente y ofrece a la PWA un contrato HTTP
limitado a `127.0.0.1`. Stockfish WASM permanece separado y continÃƒÂºa siendo la fuente
de verdad para evaluaciÃƒÂ³n y feedback; Maia-3 solo selecciona movimientos del rival.

Se elige el modelo 5M por su latencia y tamaÃƒÂ±o. `pnpm dev` y `play` instalan el cÃƒÂ³digo
desde el commit oficial fijado, verifican el SHA-256 del checkpoint y no exponen la web
hasta que el bridge responde `ready` tras un calentamiento real. El entorno y los pesos
viven bajo `.runtime`, fuera del repositorio, y solo la primera preparaciÃƒÂ³n necesita red.

El cÃƒÂ³digo upstream estÃƒÂ¡ bajo AGPL-3.0. La tarjeta pÃƒÂºblica del checkpoint no declara
una licencia de pesos inequÃƒÂ­voca por separado: hasta obtener confirmaciÃƒÂ³n del autor,
no se empaquetarÃƒÂ¡n ni redistribuirÃƒÂ¡n cÃƒÂ³digo, entorno o pesos de Maia-3. El instalador
personal descarga el material directamente de sus fuentes oficiales.

## ADR-010 Ã¢â‚¬â€ Voz editorial determinista y lÃƒÂ­nea temporal analÃƒÂ­tica

**Estado:** aceptada.

El entrenador usa una voz cercana y serena compuesta mediante plantillas espaÃƒÂ±olas
versionadas. Cada frase se deriva de evidencia validada; la variaciÃƒÂ³n solo modifica
cadencia y entrada, es reproducible y no puede introducir hechos nuevos. No se aÃƒÂ±ade
LLM ni sÃƒÂ­ntesis de voz al camino principal.

Stockfish evalÃƒÂºa cada posiciÃƒÂ³n desde la perspectiva elegida por el usuario. El
historial muestra la cifra tras las jugadas de ambos bandos, pero reserva clasificaciÃƒÂ³n,
icono y explicaciÃƒÂ³n para las decisiones del usuario. Los registros se indexan por
media jugada para que navegar, persistir o crear una rama no mezcle feedback de
posiciones distintas.

## ADR-011 Ã¢â‚¬â€ Trabajo incremental en partidas largas

**Estado:** aceptada.

Una sesiÃƒÂ³n creada por `chess-core` avanza desde su FEN actual y mantiene el PGN de
forma incremental. Las sesiones deserializadas siguen reproduciÃƒÂ©ndose y validÃƒÂ¡ndose
antes de considerarse confiables. Deshacer una sesiÃƒÂ³n creada durante la ejecuciÃƒÂ³n
recupera su predecesora sin reconstruir la partida completa.

Cuando varios consumidores necesitan las posiciones de todo el historial, usan un
ÃƒÂºnico recorrido compartido por media jugada. Persistencia e interfaz no validan cada
registro mediante deshacer repetido. En Stockfish, `MultiPV` se limita a la posiciÃƒÂ³n
donde el entrenador compara alternativas y la legalidad completa se comprueba sobre
las variantes finales, no sobre cada lÃƒÂ­nea intermedia emitida por UCI.

Una cachÃƒÂ© LRU pequeÃƒÂ±a reutiliza ÃƒÂºnicamente anÃƒÂ¡lisis completos cuya FEN, perspectiva,
preset, MultiPV y lÃƒÂ­mite coinciden. No comparte resultados parciales, cancelados o
fallidos y su capacidad acotada evita convertir la optimizaciÃƒÂ³n en crecimiento de
memoria durante sesiones largas.

## ADR-012 Ã¢â‚¬â€ NavegaciÃƒÂ³n por cursor y precÃƒÂ¡lculo exacto

**Estado:** aceptada.

La navegaciÃƒÂ³n mantiene una sola `GameSession` con la lÃƒÂ­nea completa y un cursor. Una
posiciÃƒÂ³n histÃƒÂ³rica se materializa mediante un recorrido hacia delante hasta el cursor;
no se conserva un array de sesiones que repita todos los prefijos y crezca de forma
cuadrÃƒÂ¡tica. Crear una continuaciÃƒÂ³n es el ÃƒÂºnico momento en que se trunca la lÃƒÂ­nea.

El anÃƒÂ¡lisis de la posiciÃƒÂ³n anterior se inicia durante el tiempo de reflexiÃƒÂ³n del
usuario con la misma FEN, perspectiva, preset, `MultiPV` y lÃƒÂ­mite que pedirÃƒÂ¡ despuÃƒÂ©s
el entrenador. La cachÃƒÂ© comparte tanto resultados completos como la promesa exacta en
curso. La posiciÃƒÂ³n resultante mantiene siempre una bÃƒÂºsqueda independiente y completa:
las puntuaciones y WDL de una candidata MultiPV pertenecen a la raÃƒÂ­z y no son una
evaluaciÃƒÂ³n semÃƒÂ¡nticamente equivalente de la posiciÃƒÂ³n hija.

Stockfish recibe `Hash=64` una sola vez durante el arranque UCI y conserva la tabla de
transposiciÃƒÂ³n entre bÃƒÂºsquedas. No se reducen tiempos, variantes requeridas ni fuerza;
la mejora desplaza trabajo fuera de la ruta crÃƒÂ­tica y reutiliza ÃƒÂºnicamente cÃƒÂ¡lculos
idÃƒÂ©nticos.

## ADR-013 Ã¢â‚¬â€ Iconos provisionales desde progreso UCI

**Estado:** aceptada.

El icono de valoraciÃƒÂ³n puede aparecer antes de `bestmove` usando snapshots `info` de
la misma bÃƒÂºsqueda posterior. Se espera una profundidad mÃƒÂ­nima de 6, se normalizan
score y WDL a la perspectiva del usuario y solo se renderiza de nuevo si cambia la
categorÃƒÂ­a. El estado provisional es transitorio, se anuncia como tal y se elimina al
cancelar, navegar o terminar.

Antes de clasificar un snapshot se reproducen completamente las variantes anterior y
posterior. Si un backend falla despuÃƒÂ©s de publicar progreso, el adaptador emite un
`reset` antes del fallback para que nunca sobreviva una valoraciÃƒÂ³n obsoleta.

La clasificaciÃƒÂ³n final continÃƒÂºa usando el resultado completo con el presupuesto
original y es la ÃƒÂºnica que se persiste o alimenta el feedback. No se aÃƒÂ±ade una bÃƒÂºsqueda
rÃƒÂ¡pida independiente Ã¢â‚¬â€que consumirÃƒÂ­a tiempo adicionalÃ¢â‚¬â€ ni se reutiliza una puntuaciÃƒÂ³n
MultiPV de la posiciÃƒÂ³n padre como evaluaciÃƒÂ³n del hijo. La funciÃƒÂ³n pura de assessment
es compartida entre ambos caminos para impedir divergencias de reglas o umbrales.

## ADR-014 ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â Stockfish local como rival hosted/mÃƒÆ’Ã‚Â³vil

**Estado:** aceptada.

El modo hosted, estÃƒÆ’Ã‚Â¡tico o mÃƒÆ’Ã‚Â³vil sin companion no llamarÃƒÆ’Ã‚Â¡ a `/maia3-api`. En ese
entorno, Stockfish WASM local asume tambiÃƒÆ’Ã‚Â©n el rol de `opponent` para conservar una
ruta offline completa y no filtrar FEN/PGN a la red. Maia-3 sigue siendo una mejora
opcional limitada al desarrollo local sobre `127.0.0.1`.

Para evitar dos Workers compitiendo por CPU y memoria en mÃƒÆ’Ã‚Â³vil, anÃƒÆ’Ã‚Â¡lisis y rival
comparten un ÃƒÆ’Ã‚Âºnico broker UCI. El broker serializa trabajos, da prioridad a la jugada
del rival frente a anÃƒÆ’Ã‚Â¡lisis en cola, valida toda salida UCI y restaura las opciones del
motor al cambiar de actor. El anÃƒÆ’Ã‚Â¡lisis pedagÃƒÆ’Ã‚Â³gico mantiene fuerza completa; el rival
degrada por tiempo breve y por las opciones de fuerza limitada que el backend soporte,
primero `UCI_LimitStrength`/`UCI_Elo` y, si no existen, `Skill Level`.

La tabla `Hash` deja de fijarse a 64 MB en todos los dispositivos. El runtime local la
adapta a 16/32/64 MB segÃƒÆ’Ã‚Âºn memoria expuesta y concurrencia para reducir presiÃƒÆ’Ã‚Â³n en
dispositivos lentos sin romper la partida. El fallback ASM.js permanece disponible solo
cuando el backend WASM no puede arrancar.

## ADR-015 — Shell móvil fijo y feedback por media jugada

**Estado:** aceptada.

En pantallas de hasta 720 px la partida usa un shell fijo con safe areas, tablero
prioritario, resumen compacto del entrenador, árbol/variantes dentro de paneles y
acciones secundarias agrupadas. El escritorio conserva su composición previa.

El feedback se identifica por media jugada y no por revisión mutable. La persistencia
normaliza cualquier estado pendiente como no disponible al restaurar, y los análisis
terminan siempre en `ready` o `unavailable`. El resultado tardío solo se aplica si la
misma jugada sigue vigente.

La respuesta del rival puede introducir una espera breve intencional antes de
aplicarse y animarse; esa espera es cancelable y no forma parte de una promesa fija
de tiempo total de análisis.

## ADR-017 — Espejo público de artefactos con GitHub Pages

**Estado:** aceptada.

El repositorio privado sigue siendo la fuente de verdad y el repositorio público
`chess-coach-play` solo publica artefactos estáticos generados desde el commit exacto
de origen. La conexión es unidireccional: el flujo de CI construye `build:pages`,
valida el árbol resultante y lo sincroniza con el repo público mediante una deploy key
SSH mínima con acceso de escritura solo al espejo. No existe edición manual del lado
público ni sincronización bidireccional.

La publicación usa una base `/chess-coach-play/` separada de Sites/root y conserva la
misma ruta offline-first del producto: la app publicada sigue usando Stockfish/WASM
local para análisis y feedback, y no introduce Maia hosted ni dependencias remotas en
la experiencia de Pages.

El disparador operativo queda en `push` a `main` y `workflow_dispatch`. Un rollback se
resuelve revirtiendo el commit de origen o repoblando el espejo con una versión
anterior validada; el commit publicado debe quedar trazable en el historial del repo
público para poder auditar qué árbol exacto se difundió.

La validación mínima antes de publicar incluye `pnpm check`, `pnpm build:pages` y la
validación del árbol generado. Si falla la sincronización, la versión pública anterior
permanece como referencia hasta que una publicación nueva complete la cadena entera.

## ADR-016 — Timeouts separados para bootstrap, ready y búsqueda

**Estado:** aceptada.

El broker compartido usa tres tiempos distintos: 15 s para bootstrap, 15 s para el
handshake `ready` y 5 s para la búsqueda activa. El timeout de búsqueda se inicia solo
después de `readyok`, de modo que un arranque en frío o una preemption móvil no
consuman el presupuesto de la búsqueda real.

Esta separación evita falsos negativos en dispositivos lentos y permite que un
análisis interrumpido por la jugada del rival libere la ruta sin arrastrar un estado
pendiente al nuevo actor.

La preemption interna del coach por rival prioritario no se considera un error de
usuario: conserva `pending` y reencola una sola vez. Las cancelaciones externas o los
resultados stale no reintentan. Si la misma petición sufre una segunda interrupción o
error, el estado final es `unavailable` y el usuario debe lanzar un retry manual.

## ADR-018 — Feedback contextual v3 con explicación/presentación separadas

**Estado:** aceptada.

El feedback pedagógico visible pasa a un contrato contextual v3. Stockfish sigue
aportando solo evidencia técnica; el entrenador aplica detectores deterministas
priorizados y construye una explicación estructurada. La explicación guarda la causa
verificable, la consecuencia principal, la mejor jugada y, cuando procede, una
variante legal de apoyo. La presentación expone un `summary` compacto y un `detail`
ampliado, pero ambos derivan del mismo registro.

La confianza interna permanece fuera de la UI. `high` y `medium` pueden justificar
una causa visible; `low` se degrada a `recommendation-only` y muestra solo la mejor
continuación defendible. La PV se usa como evidencia, no como texto de interfaz, y el
MVP mantiene su restricción de no introducir LLM como fuente de verdad. La
presentación puede alternar entre familias equivalentes, pero la selección sigue
siendo determinista para una misma identidad de media jugada.

`CoachTurnRecord` v3 convive con lectura de v2 y `StoredGame` sigue en v6. No se
añaden detectores avanzados fuera del alcance actual —como forks, pins o estructura
de peones—, y las pruebas semánticas deben comprobar ausencia de invención, no
copiar frases fijas del motor.

## ADR-019 — Revisión postjaque-mate con snapshot terminal

**Estado:** aceptada.

La revisión final usa un snapshot terminal `PostgameSummary v1` y no altera la
semántica de `StoredGame` ni `SessionWorkspace`, que continúan en v6. La vista
postpartida es opcional, consume solo la línea final y expone contexto crítico en
una interfaz accesible y responsive. No añade pedagogía por movimiento en el
postgame; el objetivo es resumir la secuencia final, no reexplicar toda la partida.

El índice RMS de estabilidad se versiona como ayuda de revisión final y separa
buckets por color/jugador. La cola compartida de engine mantiene un modo secuencial
`missing-only` con `cancel-resume` para no mezclar resultados entre solicitudes
distintas.
