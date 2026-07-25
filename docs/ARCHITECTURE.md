# Arquitectura

`SessionWorkspace` v6 guarda `mainLineId`, `activeLineId`, revisión e independientes
líneas con timeline/cursor, feedback, anotaciones y metadatos de bifurcación. La
migración v5 convierte la sesión activa en principal y `RecoverySnapshot` en prueba.

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

### `packages/coach`

Consume posiciones y resultados normalizados del motor. Produce feedback estructurado;
no toca DOM, Workers ni almacenamiento.

El texto visible se produce con un renderizador determinista de plantillas. Recibe
evidencia estructurada —clasificación, motivo, piezas, casillas y variante— y devuelve
mensajes localizados. No consulta un LLM ni una API para redactar cada explicación.

Cada media jugada posee un registro versionado e indexado. El registro mantiene por
separado actor, FEN anterior/posterior, evaluación normalizada, evidencia, clasificación,
motivo, pistas y copia renderizada. La UI deriva el texto y los iconos finales solo de
los registros del usuario. Mientras la búsqueda sigue activa puede mostrar un icono
provisional transitorio, que nunca se persiste.

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
6. La UI sustituye el provisional por el icono final y presenta el feedback completo.
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
inequívoca.

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

## Licencias

Antes de integrar un binario Stockfish/WASM se registrarán versión, URL de origen,
hash, licencia, avisos y mecanismo para ofrecer el código fuente correspondiente.
Maia-3 se instala desde un commit fijado del repositorio oficial en un entorno local
ignorado por Git; no se redistribuye su código ni su checkpoint con esta aplicación.
La procedencia, hash y restricción de redistribución están en `docs/THIRD_PARTY.md`.
