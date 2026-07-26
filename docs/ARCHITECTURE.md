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

## LÃ­mites

### `apps/web`

Compone la experiencia, administra estado de pantalla y adapta eventos de usuario.
No implementa reglas de ajedrez ni interpreta texto UCI.

### `packages/chess-core`

Contiene tipos de dominio, validaciÃ³n legal y serializaciÃ³n. Envuelve la librerÃ­a de
reglas para evitar que detalles de terceros se propaguen por toda la aplicaciÃ³n.

### `packages/engine`

Expone contratos asÃ­ncronos y cancelables separados para anÃ¡lisis y oponente. El
adaptador de Stockfish vive en un Web Worker y valida toda salida UCI antes de
normalizarla. En navegador hosted o estÃ¡tico, el mismo broker Stockfish local cubre
anÃ¡lisis y rival para no depender de `/maia3-api`; serializa bÃºsquedas, restaura las
opciones UCI por actor y drena `stop`/`readyok` antes de reutilizar el Worker. El
adaptador de Maia-3 llama al companion local por HTTP loopback y nunca expone texto
UCI a React. Todos los backends asignan identificadores y la UI descarta respuestas
antiguas. El presupuesto de anÃ¡lisis se expresa por tiempo/nodos y el hash de
Stockfish se adapta al dispositivo con escalones de 16/32/64 MB.

El companion no publica su estado `ready` hasta completar el handshake UCI, cargar el
modelo y obtener una jugada legal de calentamiento. Por tanto, `pnpm dev` y `play`
solo exponen la interfaz cuando la primera inferencia real ya terminÃ³. El lanzador
elige puertos locales libres para la web y para el bridge, inyecta ese destino real en
Vite y cierra ambos procesos juntos. Un fallo posterior conserva la FEN y el historial:
el usuario puede reintentar con un identificador nuevo, mientras la UI descarta
cualquier respuesta perteneciente a la solicitud anterior.

### `packages/coach`

Consume posiciones y resultados normalizados del motor. Produce feedback estructurado;
no toca DOM, Workers ni almacenamiento.

El texto visible se produce con un renderizador determinista de plantillas. Recibe
evidencia estructurada â€”clasificaciÃ³n, motivo, piezas, casillas y varianteâ€” y devuelve
mensajes localizados. No consulta un LLM ni una API para redactar cada explicaciÃ³n.

Cada media jugada posee un registro versionado e indexado. El registro mantiene por
separado actor, FEN anterior/posterior, evaluaciÃ³n normalizada, evidencia, clasificaciÃ³n,
motivo, pistas y copia renderizada. La UI deriva el texto y los iconos finales solo de
los registros del usuario. Mientras la bÃºsqueda sigue activa puede mostrar un icono
provisional transitorio, que nunca se persiste.

## Contrato de anÃ¡lisis

Cada solicitud incluye FEN, lÃ­mite, MultiPV y perspectiva. Cada resultado incluye
identificador, profundidad, nodos, variantes y una puntuaciÃ³n discriminada como
centipeones o mate; WDL es opcional. Nunca uses un valor de mate como centipeones.

Una solicitud puede suscribirse a progreso normalizado. Cada snapshot procede de una
lÃ­nea UCI `info` vÃ¡lida de la misma bÃºsqueda y declara identificador, perspectiva,
profundidad, nodos y variantes disponibles. El progreso no resuelve la promesa, no
ejecuta otro `go` y deja de notificarse al cancelar o recibir `bestmove`. Si un backend
que ya publicÃ³ progreso falla, el adaptador emite un `reset` antes de intentar el
fallback para retirar cualquier valoraciÃ³n basada en esa bÃºsqueda descartada.

El entrenador solicita varias variantes Ãºnicamente para la posiciÃ³n anterior a la
jugada, donde se necesitan para detectar alternativas equivalentes. Para evaluar la
posiciÃ³n resultante basta la variante principal. Las lÃ­neas `info` se validan primero
de forma sintÃ¡ctica y acotada; la reproducciÃ³n legal completa se realiza una sola vez
sobre las variantes finales antes de publicar el resultado.

Stockfish configura la tabla de transposiciÃ³n una sola vez durante el handshake UCI.
El valor objetivo es 64 MB, pero en dispositivos lentos baja a 32 o 16 MB segÃºn la
memoria expuesta y la concurrencia disponible. La tabla no se limpia entre bÃºsquedas,
de modo que las posiciones repetidas pueden reutilizar trabajo sin cambiar `movetime`,
`MultiPV` ni la fuerza del anÃ¡lisis pedagÃ³gico.

## Secuencia tras una jugada

1. `chess-core` valida y aplica el movimiento.
2. Se cancela cualquier anÃ¡lisis incompatible con la nueva posiciÃ³n.
3. El motor evalÃºa la mejor alternativa previa y la posiciÃ³n resultante.
4. Desde profundidad suficiente, `coach` clasifica el progreso y la UI puede mostrar
   un icono provisional identificado como tal.
5. Al llegar `bestmove`, `coach` normaliza la evidencia final desde la perspectiva del
   jugador, calcula el cambio de resultado esperado y detecta motivos verificables.
6. La UI sustituye el provisional por el icono final y presenta el feedback completo.
7. El oponente selecciona una jugada acorde con la fuerza configurada.

La jugada del oponente se aplica en cuanto llega una respuesta legal; no existe una
espera artificial adicional. El tiempo visible procede Ãºnicamente de la inferencia y
de la animaciÃ³n no bloqueante de la pieza.

El anÃ¡lisis mantiene una lÃ­nea temporal de evaluaciones por posiciÃ³n. Las solicitudes
Stockfish se serializan y cancelan por generaciÃ³n. Seleccionar una posiciÃ³n pasada
mueve el cursor real conservando temporalmente el futuro; continuar desde ese punto
descarta automÃ¡ticamente la rama posterior, sin confirmaciÃ³n, y conserva un Ãºnico
respaldo recuperable con la lÃ­nea completa, el cursor, las anotaciones y el feedback
disponible.

Los anÃ¡lisis completos se conservan en una cachÃ© LRU local y acotada, identificada por
FEN, perspectiva, preset, MultiPV y lÃ­mite. Las solicitudes idÃ©nticas que coinciden en
el tiempo comparten ademÃ¡s una Ãºnica promesa en curso y distribuyen progreso a sus
consumidores activos. Durante el turno del usuario se
precalcula exactamente la evaluaciÃ³n anterior que consumirÃ¡ el entrenador: si termina,
se lee de cachÃ© y, si sigue ejecutÃ¡ndose, se espera la misma bÃºsqueda. La posiciÃ³n
posterior siempre recibe su bÃºsqueda completa; una puntuaciÃ³n MultiPV calculada en la
raÃ­z anterior nunca se reutiliza como evaluaciÃ³n del hijo. Abortos y errores nunca
entran en la cachÃ©.

## Fuerza del oponente

Maia-3 5M recibe `SelfElo` y `OppoElo` por UCI. Mientras no exista una estimaciÃ³n
independiente de la fuerza del usuario, ambos reciben el Elo objetivo elegido para
modelar una partida del mismo segmento. `Temperature=1` conserva variedad humana y
`MultiPV=5` permite registrar candidatas; Stockfish no selecciona la jugada rival.

La escala procede de partidas Lichess Blitz y no representa una equivalencia exacta
con FIDE o Chess.com. El companion escucha solo en `127.0.0.1`, procesa las solicitudes
en serie y el cliente vuelve a validar la legalidad de cada `bestmove` contra el FEN
actual antes de aplicarlo.

En navegador hosted o mÃ³vil sin companion, Stockfish local asume tambiÃ©n el papel de
`opponent`. El broker reutiliza el mismo Worker del anÃ¡lisis, pero aplica una
configuraciÃ³n limitada y aproximada para el rival: tiempo breve, `MultiPV` corto y, si
el motor lo soporta, `UCI_LimitStrength`/`UCI_Elo`; si no, degrada con `Skill Level`.
Antes de volver a una bÃºsqueda pedagÃ³gica restablece la fuerza completa del anÃ¡lisis.

## Persistencia

El MVP conserva ajustes, partida activa y archivos PGN en almacenamiento local. Una
futura sincronizaciÃ³n debe ser opt-in y tener un adaptador separado.

La sesiÃ³n persistida incluye cursor, continuaciÃ³n recuperable, un checkpoint opcional
de la Ãºltima rama reemplazada y registros del entrenador validados contra Ã­ndice, UCI
y FEN. El checkpoint sobrevive a una recarga y se consume al recuperarlo. Una
migraciÃ³n nunca inventa feedback para una jugada que no pueda asociarse de forma
inequÃ­voca.

Para renderizar y validar listas completas, las posiciones histÃ³ricas se reconstruyen
en un Ãºnico recorrido hacia delante compartido por UI y persistencia. La navegaciÃ³n
interactiva conserva una sola sesiÃ³n completa y un cursor entero. La posiciÃ³n visible
se materializa con un Ãºnico recorrido hacia delante hasta ese cursor; deshacer o
rehacer ya no almacena sesiones-prefijo duplicadas. Solo al continuar desde una
posiciÃ³n pasada se crea una nueva rama truncada.

## Integraciones opcionales

Toda API externa vive detrÃ¡s de un adaptador y no participa en el camino crÃ­tico. La
aplicaciÃ³n debe conservar el mismo contrato funcional cuando no haya conexiÃ³n. Ollama
o cualquier otro modelo de lenguaje no forma parte de la arquitectura aprobada del
MVP; una prueba futura requerirÃ­a una decisiÃ³n nueva, opt-in y fallback determinista.

## Licencias

Antes de integrar un binario Stockfish/WASM se registrarÃ¡n versiÃ³n, URL de origen,
hash, licencia, avisos y mecanismo para ofrecer el cÃ³digo fuente correspondiente.
Maia-3 se instala desde un commit fijado del repositorio oficial en un entorno local
ignorado por Git; no se redistribuye su cÃ³digo ni su checkpoint con esta aplicaciÃ³n.
La procedencia, hash y restricciÃ³n de redistribuciÃ³n estÃ¡n en `docs/THIRD_PARTY.md`.

## Ajustes recientes

La identidad del feedback se fija por media jugada: línea, índice, actor, UCI y FEN
antes/después. Un resultado tardío solo se aplica si esa misma jugada sigue vigente;
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
