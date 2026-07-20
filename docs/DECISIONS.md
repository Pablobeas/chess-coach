# Registro de decisiones

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

El agente principal usa Sol con razonamiento alto. Terra cubre tareas especializadas,
Luna exploración/evaluaciones acotadas y GPT-5.5 aporta una revisión independiente.
La profundidad máxima es 1 para evitar delegación recursiva.

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

Se elige el modelo 5M por su latencia y tamaño. `play` instala el código desde el commit
oficial fijado y verifica el SHA-256 del checkpoint. El entorno y los pesos viven bajo
`.runtime`, fuera del repositorio, y solo la primera preparación necesita red.

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
