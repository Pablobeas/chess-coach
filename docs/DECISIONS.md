# Registro de decisiones

## ADR-008 — Workspace de líneas v6

Se reemplaza la recuperación de una rama por líneas identificadas persistentes para
que una prueba inválida no reemplace a la principal. Al alcanzar cinco, la persona
elige explícitamente cuál borrar; no hay eliminación automática.

## ADR-001 — Aplicación web/PWA primero

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

## ADR-014 â€” Stockfish local como rival hosted/mÃ³vil

**Estado:** aceptada.

El modo hosted, estÃ¡tico o mÃ³vil sin companion no llamarÃ¡ a `/maia3-api`. En ese
entorno, Stockfish WASM local asume tambiÃ©n el rol de `opponent` para conservar una
ruta offline completa y no filtrar FEN/PGN a la red. Maia-3 sigue siendo una mejora
opcional limitada al desarrollo local sobre `127.0.0.1`.

Para evitar dos Workers compitiendo por CPU y memoria en mÃ³vil, anÃ¡lisis y rival
comparten un Ãºnico broker UCI. El broker serializa trabajos, da prioridad a la jugada
del rival frente a anÃ¡lisis en cola, valida toda salida UCI y restaura las opciones del
motor al cambiar de actor. El anÃ¡lisis pedagÃ³gico mantiene fuerza completa; el rival
degrada por tiempo breve y por las opciones de fuerza limitada que el backend soporte,
primero `UCI_LimitStrength`/`UCI_Elo` y, si no existen, `Skill Level`.

La tabla `Hash` deja de fijarse a 64 MB en todos los dispositivos. El runtime local la
adapta a 16/32/64 MB segÃºn memoria expuesta y concurrencia para reducir presiÃ³n en
dispositivos lentos sin romper la partida. El fallback ASM.js permanece disponible solo
cuando el backend WASM no puede arrancar.
