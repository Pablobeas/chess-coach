# Arquitectura

`SessionWorkspace` v6 guarda `mainLineId`, `activeLineId`, revision, un cursor independiente por linea, relaciones de bifurcacion y orden de creacion persistido. La migracion v6 mantiene compatibilidad con partidas guardadas existentes y trata `RecoverySnapshot` como carga heredada de solo lectura, nunca como semantica principal.

El arbol de lineas se materializa en memoria como una principal activa y sus variantes. Navegar por una posicion historica cambia el cursor de la linea actual; jugar desde ese punto fuerza una nueva continuacion del motor y, si la jugada del usuario y la respuesta del rival coinciden con una linea ya existente, ambas continuaciones se fusionan. Si la respuesta cambia, se conserva una variante independiente.

La poda automatica elimina la variante mas antigua cuando el arbol supera cinco ramas, reparentando sus descendientes por el prefijo comun y cancelando cualquier trabajo asincronico pendiente asociado a la linea retirada.

## Vista general

```text
React/PWA
  -> GameSession
      -> chess-core (legalidad, FEN, PGN)
      -> analysis engine client
          -> Web Worker
              -> UCI adapter
                  -> Stockfish/WASM
      -> opponent client
          -> HTTP loopback (127.0.0.1)
              -> Node companion
                  -> UCI subprocess
                      -> Maia-3 5M / PyTorch CPU
      -> coach pipeline
          -> turn record -> evidence -> score -> motif -> hint -> message
      -> local storage (settings, session, PGN)
```

## Límites

### `apps/web`

Compone la experiencia, administra estado de pantalla y adapta eventos de usuario.
No implementa reglas de ajedrez ni interpreta texto UCI.

### `packages/chess-core`

Contiene tipos de dominio, validación legal y serialización. Envuelve la librería de
reglas para evitar que detalles de terceros se propaguen por toda la aplicación.

### `packages/engine`

Expone contratos asíncronos y cancelables separados para análisis y oponente. El
adaptador de Stockfish vive en un Web Worker y valida toda salida UCI antes de
normalizarla. En navegador hosted o estático, el mismo broker Stockfish local cubre
análisis y rival para no depender de `/maia3-api`; serializa búsquedas, restaura las
opciones UCI por actor y drena `stop`/`readyok` antes de reutilizar el Worker. El
adaptador de Maia-3 llama al companion local por HTTP loopback y nunca expone texto
UCI a React. Todos los backends asignan identificadores y la UI descarta respuestas
antiguas. El presupuesto de análisis se expresa por tiempo/nodos y el hash de
Stockfish se adapta al dispositivo con escalones de 16/32/64 MB.

El companion no publica su estado `ready` hasta completar el handshake UCI, cargar el
modelo y obtener una jugada legal de calentamiento. Por tanto, `pnpm dev` y `play`
solo exponen la interfaz cuando la primera inferencia real ya terminó. El lanzador
elige puertos locales libres para la web y para el bridge, inyecta ese destino real en
Vite y cierra ambos procesos juntos. Un fallo posterior conserva la FEN y el historial:
el usuario puede reintentar con un identificador nuevo, mientras la UI descarta
cualquier respuesta perteneciente a la solicitud anterior.

## Gates de integracion

- Bridge local: la web y el companion solo se comunican por loopback; ninguna ruta
  central depende de un backend remoto.
- Cola compartida: `missing-only` y `cancel-resume` se aplican de forma secuencial
  para no mezclar resultados ni reusar respuestas stale.
- UCI/PGN: toda salida UCI se valida antes de convertirse en evidencia, feedback o
  persistencia.
- Pages CSP: la publicacion estatica usa base `/chess-coach-play/` y una CSP
  compatible con GitHub Pages mediante metadatos, no mediante cabeceras.
- Source boundaries: `web -> coach -> engine` y `web -> chess-core`; `coach`,
  `engine` y `chess-core` no importan componentes de `apps/web`.

### `packages/coach`

Consume posiciones y resultados normalizados del motor. Produce feedback estructurado;
no toca DOM, Workers ni almacenamiento.

El texto visible se produce con un renderizador determinista de plantillas. Recibe
evidencia estructurada —clasificación, motivo, piezas, casillas y variante— y devuelve
mensajes localizados. No consulta un LLM ni una API para redactar cada explicación.
El contrato v3 separa `explanation` de `presentation`: la primera guarda la razón
verificable y la segunda expone `summary` y `detail` para la UI.

Cada media jugada posee un registro versionado e indexado. El registro mantiene por
separado actor, FEN anterior/posterior, evaluación normalizada, evidencia, clasificación,
motivo, pistas y copia renderizada. La UI deriva el texto y los iconos finales solo de
los registros del usuario. Mientras la búsqueda sigue activa puede mostrar un icono
provisional transitorio, que nunca se persiste. `decodeCoachTurnRecord` acepta v2
legible y v3 completo; `StoredGame` permanece en v6.

La revisión final se serializa como un snapshot terminal `PostgameSummary v1`.
Ese snapshot es de solo lectura, se deriva de la sesión activa y no cambia la
semántica de `SessionWorkspace` ni de `StoredGame`, que siguen en v6. La revisión
es opcional y se consume como una vista final, no como un estado intermedio.

## Contrato de análisis

Cada solicitud incluye FEN, límite, MultiPV y perspectiva. Cada resultado incluye
identificador, profundidad, nodos, variantes y una puntuación discriminada como
centipeones o mate; WDL es opcional. Nunca uses un valor de mate como centipeones.

Una solicitud puede suscribirse a progreso normalizado. Cada snapshot procede de una
línea UCI `info` válida de la misma búsqueda y declara identificador, perspectiva,
profundidad, nodos y variantes disponibles. El progreso no resuelve la promesa, no
ejecuta otro `go` y deja de notificarse al cancelar o recibir `bestmove`. Si un backend
que ya publicó progreso falla, el adaptador emite un `reset` antes de intentar el
fallback para retirar cualquier valoración basada en esa búsqueda descartada.

El entrenador solicita varias variantes únicamente para la posición anterior a la
jugada, donde se necesitan para detectar alternativas equivalentes. Para evaluar la
posición resultante basta la variante principal. Las líneas `info` se validan primero
de forma sintáctica y acotada; la reproducción legal completa se realiza una sola vez
sobre las variantes finales antes de publicar el resultado.

Stockfish configura la tabla de transposición una sola vez durante el handshake UCI.
El valor objetivo es 64 MB, pero en dispositivos lentos baja a 32 o 16 MB según la
memoria expuesta y la concurrencia disponible. La tabla no se limpia entre búsquedas,
de modo que las posiciones repetidas pueden reutilizar trabajo sin cambiar `movetime`,
`MultiPV` ni la fuerza del análisis pedagógico.

## Secuencia tras una jugada

1. `chess-core` valida y aplica el movimiento.
2. Se cancela cualquier análisis incompatible con la nueva posición.
3. El motor evalúa la mejor alternativa previa y la posición resultante.
4. Desde profundidad suficiente, `coach` clasifica el progreso y la UI puede mostrar
   un icono provisional identificado como tal.
5. Al llegar `bestmove`, `coach` normaliza la evidencia final desde la perspectiva del
   jugador, calcula el cambio de resultado esperado y detecta motivos verificables.
6. La UI sustituye el provisional por el icono final y presenta el resumen compacto;
   el detalle completo queda disponible sin duplicar lógica ni inventar hechos nuevos.
7. El oponente selecciona una jugada acorde con la fuerza configurada.

La jugada del oponente se aplica en cuanto llega una respuesta legal; no existe una
espera artificial adicional. El tiempo visible procede únicamente de la inferencia y
de la animación no bloqueante de la pieza.

El análisis mantiene una línea temporal de evaluaciones por posición. Las solicitudes
Stockfish se serializan y cancelan por generación. Seleccionar una posición pasada
mueve el cursor real conservando temporalmente el futuro; continuar desde ese punto
descarta automáticamente la rama posterior, sin confirmación, y conserva un único
respaldo recuperable con la línea completa, el cursor, las anotaciones y el feedback
disponible.

Los análisis completos se conservan en una caché LRU local y acotada, identificada por
FEN, perspectiva, preset, MultiPV y límite. Las solicitudes idénticas que coinciden en
el tiempo comparten además una única promesa en curso y distribuyen progreso a sus
consumidores activos. Durante el turno del usuario se
precalcula exactamente la evaluación anterior que consumirá el entrenador: si termina,
se lee de caché y, si sigue ejecutándose, se espera la misma búsqueda. La posición
posterior siempre recibe su búsqueda completa; una puntuación MultiPV calculada en la
raíz anterior nunca se reutiliza como evaluación del hijo. Abortos y errores nunca
entran en la caché.

La cola compartida de engine conserva una estrategia secuencial de `missing-only` y
`cancel-resume`: solo resuelve lo que falta, puede reanudar una petición cancelada si
sigue siendo la misma identidad y nunca mezcla resultados entre solicitudes distintas.

## Fuerza del oponente

Maia-3 5M recibe `SelfElo` y `OppoElo` por UCI. Mientras no exista una estimación
independiente de la fuerza del usuario, ambos reciben el Elo objetivo elegido para
modelar una partida del mismo segmento. `Temperature=1` conserva variedad humana y
`MultiPV=5` permite registrar candidatas; Stockfish no selecciona la jugada rival.

La escala procede de partidas Lichess Blitz y no representa una equivalencia exacta
con FIDE o Chess.com. El companion escucha solo en `127.0.0.1`, procesa las solicitudes
en serie y el cliente vuelve a validar la legalidad de cada `bestmove` contra el FEN
actual antes de aplicarlo.

En navegador hosted o móvil sin companion, Stockfish local asume también el papel de
`opponent`. El broker reutiliza el mismo Worker del análisis, pero aplica una
configuración limitada y aproximada para el rival: tiempo breve, `MultiPV` corto y, si
el motor lo soporta, `UCI_LimitStrength`/`UCI_Elo`; si no, degrada con `Skill Level`.
Antes de volver a una búsqueda pedagógica restablece la fuerza completa del análisis.

## Persistencia

El MVP conserva ajustes, partida activa y archivos PGN en almacenamiento local. Una
futura sincronización debe ser opt-in y tener un adaptador separado.

La sesión persistida incluye cursor, continuación recuperable, un checkpoint opcional
de la última rama reemplazada y registros del entrenador validados contra índice, UCI
y FEN. El checkpoint sobrevive a una recarga y se consume al recuperarlo. Una
migración nunca inventa feedback para una jugada que no pueda asociarse de forma
inequívoca. `StoredGame` sigue en v6 y no cambia por el feedback contextual v3.
La migración normaliza cualquier registro pendiente heredado como no disponible antes
de exponerlo de nuevo.

Para renderizar y validar listas completas, las posiciones históricas se reconstruyen
en un único recorrido hacia delante compartido por UI y persistencia. La navegación
interactiva conserva una sola sesión completa y un cursor entero. La posición visible
se materializa con un único recorrido hacia delante hasta ese cursor; deshacer o
rehacer ya no almacena sesiones-prefijo duplicadas. Solo al continuar desde una
posición pasada se crea una nueva rama truncada.

## Integraciones opcionales

Toda API externa vive detrás de un adaptador y no participa en el camino crítico. La
aplicación debe conservar el mismo contrato funcional cuando no haya conexión. Ollama
o cualquier otro modelo de lenguaje no forma parte de la arquitectura aprobada del
MVP; una prueba futura requeriría una decisión nueva, opt-in y fallback determinista.

## Publicación pública y espejo de Pages

El repositorio privado es la fuente de verdad. El repositorio público `chess-coach-play`
solo actúa como espejo de artefactos estáticos y no admite edición manual del producto.
La conexión entre ambos lados es unidireccional: el flujo de CI publica el árbol
generado desde el commit exacto del repo privado y deja trazabilidad por hash, no por
contenido recreado a mano.

`pnpm build:pages` construye el artefacto público con base `/chess-coach-play/`, separado
del despliegue de Sites/root, e incluye los activos necesarios para que la PWA funcione
desde GitHub Pages. Esta vía conserva el modelo offline-first: la app publicada sigue
dependiendo de Stockfish/WASM local para análisis y feedback, y no introduce Maia
hosted ni ningún backend remoto en la ruta pública.

## Licencias

Antes de integrar un binario Stockfish/WASM se registrarán versión, URL de origen,
hash, licencia, avisos y mecanismo para ofrecer el código fuente correspondiente.
Maia-3 se instala desde un commit fijado del repositorio oficial en un entorno local
ignorado por Git; no se redistribuye su código ni su checkpoint con esta aplicación.
La procedencia, hash y restricción de redistribución están en `docs/THIRD_PARTY.md`.

## Ajustes recientes

La identidad del feedback se fija por media jugada: línea, índice, actor, UCI y
FEN antes/después. Un resultado tardío solo se aplica si esa misma jugada sigue vigente;
si la línea cambia, el resultado se descarta y la solicitud termina como `ready` o
`unavailable`, nunca como `pending` persistente.

En navegador hosted o estático, y en móvil, análisis y oponente comparten un único
broker Stockfish. Ese broker serializa trabajos, da prioridad a la jugada del rival
frente al análisis en cola y evita dos Workers compitiendo por CPU y memoria.

El broker separa tres presupuestos distintos: bootstrap del motor de 15 s, handshake
`ready` de 15 s y búsqueda activa de 5 s. El timeout de búsqueda solo se arma después
de recibir `readyok`, para no penalizar el arranque en frío ni confundir un cold
start con una búsqueda lenta. En móvil esto también reduce el impacto de la
preemption del sistema: si la app vuelve al frente después de una pausa, el
bootstrap y el handshake siguen teniendo su margen propio antes de empezar a contar
la búsqueda real.

Cuando el coach cede temporalmente la CPU al rival prioritario, esa preemption interna
no se presenta como fallo: el estado puede seguir en `pending` y se reencola una sola
vez tras completar la jugada del rival. En cambio, una cancelación externa o una
respuesta stale no se reintenta. Si una segunda preemption o cualquier error vuelve a
interrumpir la misma petición, el resultado pasa a `unavailable` y la UI ofrece
reintento manual.

La composición de la UI se decide por ancho de pantalla: en <=720 px la experiencia
usa una vista fija con tablero, resumen, navegación y acciones compactas; en
orientación horizontal se reorganiza en dos columnas. El shell móvil bloquea el
scroll del documento en uso normal y deja un fallback accesible para alturas
extremas, zoom o texto grande.

## Centro de entrenamiento

- `PositionKey` normaliza el FEN a tablero, turno, enroques y en-passant; ignora el contador de medias jugadas y de jugadas completas para que las transposiciones coincidan.
- El curso de Apertura Italiana indexa cada nodo por `PositionKey` y reutiliza la misma posición común cuando dos ramas transponen a ese estado.
- `openingPeriodForSession` comparte la política temporal de apertura con la revisión postpartida, así que la clasificación de fases no depende de una regla paralela distinta.
- La pantalla de aperturas pide evidencia local solo al entrar en práctica, usa `AbortController` para cancelar trabajo obsoleto y descarta resultados viejos con una versión de solicitud.
