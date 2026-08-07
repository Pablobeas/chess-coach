# Registro de decisiones

## ADR-008 --- Workspace de lineas v6 y arbol de variantes

**Estado:** aceptada.

`SessionWorkspace` v6 mantiene `mainLineId`, `activeLineId`, un cursor por linea y metadatos persistidos de bifurcacion y orden de creacion. Jugar desde una posicion historica crea una continuacion nueva; si la jugada del usuario y la respuesta del rival coinciden con una linea existente, ambas continuaciones se fusionan; si la respuesta cambia, se conserva como variante independiente.

Al promover una variante, la principal anterior se elimina y sus descendientes se reparentan por su prefijo comun. Al superar cinco variantes, la mas antigua se poda automaticamente. Una prueba E2E detecto que la promocion dejaba la principal anterior recuperable; el arreglo definitivo elimina la principal anterior antes de persistir el nuevo arbol y reubica sus descendientes en la nueva estructura.

## ADR-001 --- Aplicacion web/PWA primero

**Estado:** aceptada.

Se empieza con React/Vite y PWA para compartir implementación entre escritorio y
móvil. Una envoltura nativa puede evaluarse después de validar la experiencia.

## ADR-002 — Análisis local

**Estado:** aceptada.

La fuente de verdad será un motor UCI en WebAssembly ejecutado en Worker. El MVP no
dependerá de una API de análisis.

## ADR-003 — Contratos separados

**Estado:** aceptada.

Reglas, motor, entrenador y UI son paquetes/capas diferentes. Esto permite probar
la pedagogía con resultados simulados y cambiar el motor sin reescribir la UI.

## ADR-004 — WDL antes que porcentaje inventado

**Estado:** aceptada.

Se usará WDL cuando esté disponible y una curva calibrada cuando no. Cualquier valor
visible se nombrará como estimación y conservará su versión de calibración.

## ADR-005 — Orquestación Codex por roles

**Estado:** aceptada.

El agente principal usa Sol con razonamiento alto exclusivamente como jefe de
orquestación: planifica, define criterios, asigna, media, decide y sintetiza. No
implementa, no edita archivos, no genera activos y no ejecuta validaciones rutinarias.
Cada encargo se clasifica antes de ejecutarse y se delega al rol ejecutor más específico,
incluso si solo tiene una línea de trabajo. GPT-5.4 implementa motor y código general;
Terra cubre frontend, coaching y activos visuales originales; Luna explora y evalúa;
GPT-5.4 mini realiza cambios mecánicos; y GPT-5.5 aporta una revisión independiente
read-only.

Cada entrega del ejecutor incluye un handoff con diff, evidencia y riesgos. Sol envía ese
material al revisor y devuelve `NEEDS_CHANGES` al mismo ejecutor mediante follow-up,
conservando la propiedad de archivos. El ciclo continúa mientras haya progreso y termina
con `APPROVED` y criterios/pruebas cumplidos, ante un bloqueo que exige usuario, permiso o
expansión, o por estancamiento cuando se repite un hallazgo sin evidencia nueva. El revisor
puede responder `APPROVED_WITH_CONTINUATION`; Sol solo inicia esa continuación si es
concreta, medible, segura y permanece dentro del objetivo original. Las expansiones se
presentan al usuario.

La política del repositorio limita la profundidad a 1 para evitar delegación
recursiva y la concurrencia a cuatro subagentes. Estos límites viven en `AGENTS.md`
para ser compatibles con las superficies de Codex que usan esquemas de configuración
distintos. Los modelos configurados son preferencias por rol, no concesiones de
acceso: si una cuenta o superficie no ofrece uno, el orquestador mantiene el rol y
declara el fallback disponible más cercano.

## ADR-006 — Feedback determinista sin LLM

**Estado:** aceptada.

El MVP no utilizará modelos de lenguaje remotos ni locales. Las explicaciones se
generan con evidencia de Stockfish, detectores de motivos y plantillas localizadas.
Esto mantiene el producto offline, reproducible y libre de coste por inferencia.

Ollama queda aplazado, no como dependencia prevista. Solo se reconsiderará mediante
una ADR nueva si una evaluación demuestra una mejora pedagógica concreta que no pueda
lograrse con reglas, y siempre como opción desactivada por defecto con fallback local
determinista.

## ADR-007 — Desarrollo vertical con TDD selectivo

**Estado:** aceptada.

Las entregas se organizan como funcionalidades verticales completas. Dentro de cada
funcionalidad se aplica TDD a reglas de ajedrez, contratos UCI, concurrencia,
cancelación, métricas, persistencia y otros comportamientos deterministas. La UI y
el diseño pueden iterarse exploratoriamente, pero deben acabar con criterios de
aceptación y pruebas de regresión apropiadas.

Esta combinación mantiene el foco en valor usable sin sacrificar confianza en las
partes donde un error sería difícil de detectar manualmente.

## ADR-008 — Piezas de ajedrez originales y locales

**Estado:** aceptada.

El tablero utiliza un juego de piezas SVG dibujado específicamente para el proyecto.
Puede compartir el lenguaje visual general de piezas Staunton digitales —volumen,
contorno y legibilidad—, pero no incorpora, descarga ni traza activos de Chess.com u
otros servicios. Las siluetas, gradientes y detalles se mantienen como código local
para que la experiencia siga funcionando sin red y no añada dependencias de terceros.

Los cambios futuros del juego de piezas deben conservar una procedencia documentada.
Un activo externo solo podrá incorporarse después de verificar su licencia y actualizar
`docs/THIRD_PARTY.md` antes de distribuirlo.

## ADR-009 — Maia-3 como oponente en el modo de escritorio local

**Estado:** aceptada con restricción de distribución.

El oponente humano-realista usa Maia-3 5M mediante su interfaz UCI. Un companion Node
local mantiene el proceso Python/PyTorch caliente y ofrece a la PWA un contrato HTTP
limitado a `127.0.0.1`. Stockfish WASM permanece separado y continúa siendo la fuente
de verdad para evaluación y feedback; Maia-3 solo selecciona movimientos del rival.

Se elige el modelo 5M por su latencia y tamaño. `pnpm dev` y `play` instalan el código
desde el commit oficial fijado, verifican el SHA-256 del checkpoint y no exponen la web
hasta que el bridge responde `ready` tras un calentamiento real. El entorno y los pesos
viven bajo `.runtime`, fuera del repositorio, y solo la primera preparación necesita red.

El código upstream está bajo AGPL-3.0. La tarjeta pública del checkpoint no declara
una licencia de pesos inequívoca por separado: hasta obtener confirmación del autor,
no se empaquetarán ni redistribuirán código, entorno o pesos de Maia-3. El instalador
personal descarga el material directamente de sus fuentes oficiales.

## ADR-010 — Voz editorial determinista y línea temporal analítica

**Estado:** aceptada.

El entrenador usa una voz cercana y serena compuesta mediante plantillas españolas
versionadas. Cada frase se deriva de evidencia validada; la variación solo modifica
cadencia y entrada, es reproducible y no puede introducir hechos nuevos. No se añade
LLM ni síntesis de voz al camino principal.

Stockfish evalúa cada posición desde la perspectiva elegida por el usuario. El
historial muestra la cifra tras las jugadas de ambos bandos, pero reserva clasificación,
icono y explicación para las decisiones del usuario. Los registros se indexan por
media jugada para que navegar, persistir o crear una rama no mezcle feedback de
posiciones distintas.

## ADR-011 — Trabajo incremental en partidas largas

**Estado:** aceptada.

Una sesión creada por `chess-core` avanza desde su FEN actual y mantiene el PGN de
forma incremental. Las sesiones deserializadas siguen reproduciéndose y validándose
antes de considerarse confiables. Deshacer una sesión creada durante la ejecución
recupera su predecesora sin reconstruir la partida completa.

Cuando varios consumidores necesitan las posiciones de todo el historial, usan un
único recorrido compartido por media jugada. Persistencia e interfaz no validan cada
registro mediante deshacer repetido. En Stockfish, `MultiPV` se limita a la posición
donde el entrenador compara alternativas y la legalidad completa se comprueba sobre
las variantes finales, no sobre cada línea intermedia emitida por UCI.

Una caché LRU pequeña reutiliza únicamente análisis completos cuya FEN, perspectiva,
preset, MultiPV y límite coinciden. No comparte resultados parciales, cancelados o
fallidos y su capacidad acotada evita convertir la optimización en crecimiento de
memoria durante sesiones largas.

## ADR-012 — Navegación por cursor y precálculo exacto

**Estado:** aceptada.

La navegación mantiene una sola `GameSession` con la línea completa y un cursor. Una
posición histórica se materializa mediante un recorrido hacia delante hasta el cursor;
no se conserva un array de sesiones que repita todos los prefijos y crezca de forma
cuadrática. Crear una continuación es el único momento en que se trunca la línea.

El análisis de la posición anterior se inicia durante el tiempo de reflexión del
usuario con la misma FEN, perspectiva, preset, `MultiPV` y límite que pedirá después
el entrenador. La caché comparte tanto resultados completos como la promesa exacta en
curso. La posición resultante mantiene siempre una búsqueda independiente y completa:
las puntuaciones y WDL de una candidata MultiPV pertenecen a la raíz y no son una
evaluación semánticamente equivalente de la posición hija.

Stockfish recibe `Hash=64` una sola vez durante el arranque UCI y conserva la tabla de
transposición entre búsquedas. No se reducen tiempos, variantes requeridas ni fuerza;
la mejora desplaza trabajo fuera de la ruta crítica y reutiliza únicamente cálculos
idénticos.

## ADR-013 — Iconos provisionales desde progreso UCI

**Estado:** aceptada.

El icono de valoración puede aparecer antes de `bestmove` usando snapshots `info` de
la misma búsqueda posterior. Se espera una profundidad mínima de 6, se normalizan
score y WDL a la perspectiva del usuario y solo se renderiza de nuevo si cambia la
categoría. El estado provisional es transitorio, se anuncia como tal y se elimina al
cancelar, navegar o terminar.

Antes de clasificar un snapshot se reproducen completamente las variantes anterior y
posterior. Si un backend falla después de publicar progreso, el adaptador emite un
`reset` antes del fallback para que nunca sobreviva una valoración obsoleta.

La clasificación final continúa usando el resultado completo con el presupuesto
original y es la única que se persiste o alimenta el feedback. No se añade una búsqueda
rápida independiente —que consumiría tiempo adicional— ni se reutiliza una puntuación
MultiPV de la posición padre como evaluación del hijo. La función pura de assessment
es compartida entre ambos caminos para impedir divergencias de reglas o umbrales.

## ADR-014 — Stockfish local como rival hosted/móvil

**Estado:** aceptada.

El modo hosted, estático o móvil sin companion no llamará a `/maia3-api`. En ese
entorno, Stockfish WASM local asume también el rol de `opponent` para conservar una
ruta offline completa y no filtrar FEN/PGN a la red. Maia-3 sigue siendo una mejora
opcional limitada al desarrollo local sobre `127.0.0.1`.

Para evitar dos Workers compitiendo por CPU y memoria en móvil, análisis y rival
comparten un único broker UCI. El broker serializa trabajos, da prioridad a la jugada
del rival frente a análisis en cola, valida toda salida UCI y restaura las opciones del
motor al cambiar de actor. El análisis pedagógico mantiene fuerza completa; el rival
degrada por tiempo breve y por las opciones de fuerza limitada que el backend soporte,
primero `UCI_LimitStrength`/`UCI_Elo` y, si no existen, `Skill Level`.

La tabla `Hash` deja de fijarse a 64 MB en todos los dispositivos. El runtime local la
adapta a 16/32/64 MB según memoria expuesta y concurrencia para reducir presión en
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

## ADR-017 --- Publicacion del mismo repositorio con GitHub Pages

**Estado:** aceptada.

El mismo repositorio publico `chess-coach` publica los artefactos estaticos
generados desde el commit exacto de origen. El flujo de CI construye
`build:pages`, valida el arbol resultante y lo despliega con el pipeline oficial
de GitHub Pages (`configure-pages`, `upload-pages-artifact`, `deploy-pages`)
usando el entorno `github-pages` y OIDC, sin mirrors paralelos ni deploy keys SSH.

La publicacion usa una base `/chess-coach/` separada de Sites/root y conserva la
misma ruta offline-first del producto: la app publicada sigue usando
Stockfish/WASM local para analisis y feedback, y no introduce Maia hosted ni
dependencias remotas en la experiencia de Pages.

El disparador operativo queda en `push` a `main` y `workflow_dispatch`. Un
rollback se resuelve revirtiendo el commit de origen o redeplegando una version
anterior validada; el commit publicado debe quedar trazable en el historial del
propio repositorio para poder auditar que arbol exacto se difundio.

La validacion minima antes de publicar incluye `pnpm check`, `pnpm build:pages`
y la validacion del arbol generado. Si falla el despliegue, la version publica
anterior permanece como referencia hasta que una publicacion nueva complete la
cadena entera.
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

## ADR-020 — Centro de entrenamiento local verificado

**Estado:** aceptada.

El centro de entrenamiento se publica como contenido local verificado, no como
material curado sin comprobación. Los 4 puzles del MVP solo se consideran aptos
cuando `tools/training/verify-puzzles-v1.mjs` los valida contra Stockfish 18 Lite
WASM y emite un reporte con hashes, licencia y presupuesto fijados.

La Apertura Italiana conserva dos respuestas verificadas en el tramo principal y
separa explicación de práctica. La práctica usa evidencia diferida, cancelable y
con fallback local; si la evidencia no confirma una respuesta, la UI no inventa
una jugada automática.

`PositionKey` queda como llave canónica para detectar transposiciones y
`openingPeriodForSession` comparte la misma política de apertura con la revisión
postpartida. Esto evita duplicar reglas de fase y mantiene coherencia entre
entrenamiento activo y análisis posterior.

## ADR-021 --- Publicacion GPL y source correspondiente

**Estado:** aceptada.

La distribucion publica del proyecto se mantiene bajo `GPL-3.0-or-later`. Cada
release y espejo estatico debe enlazar la licencia raiz, los avisos de terceros y
la fuente correspondiente de Stockfish redistribuido. El repositorio publico solo
publica artefactos derivados del commit exacto de origen; no hay edicion manual del
producto publicado ni excepciones a la trazabilidad por hash.

## ADR-022 --- CSP por meta para GitHub Pages

**Estado:** aceptada.

La publicacion en GitHub Pages no puede depender de cabeceras HTTP propias, asi que
la CSP del sitio estatica se entrega mediante meta tag y se limita a los recursos
locales necesarios para la PWA. Esto mantiene la ruta publica compatible con Pages
sin introducir un servidor intermedio ni relajar la politica de origen.

## ADR-023 --- Maia-3 local con riesgo aceptado de dependencias transitivas

**Estado:** aceptada con restriccion de distribucion.

Maia-3 se usa solo como companion local sobre `127.0.0.1`. El instalador fija el
commit de origen, verifica el checkpoint y guarda evidencia local del despliegue,
pero acepta que las dependencias transitivas de Python sigan resolviendose desde
upstream durante la instalacion inicial. Ese riesgo queda registrado en los reportes
locales y no implica redistribucion del entorno ni de los pesos.

## ADR-024 --- Snapshot de Stockfish y verificacion del source correspondiente

**Estado:** aceptada.

El Stockfish redistribuido se produce a partir de un snapshot local fijado por
`gitHead` y hashes de artefactos. Antes de publicar binarios o WASM se verifica el
source snapshot, el manifiesto de hashes y el archivo de licencia correspondiente.
Si el snapshot cambia, la fuente documentada y los hashes publicados deben
actualizarse en la misma revision.
