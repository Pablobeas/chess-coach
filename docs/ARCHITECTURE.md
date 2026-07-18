# Arquitectura

## Vista general

```text
React/PWA
  -> GameSession
      -> chess-core (legalidad, FEN, PGN)
      -> engine client
          -> Web Worker
              -> UCI adapter
                  -> Stockfish/WASM
      -> coach pipeline
          -> evidence -> score -> motif -> hint -> message
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

Expone un contrato asíncrono y cancelable. El adaptador real vive en un Web Worker,
asigna identificadores a cada análisis y descarta respuestas antiguas. El presupuesto
de análisis se expresa por tiempo/nodos y se adapta al dispositivo.

### `packages/coach`

Consume posiciones y resultados normalizados del motor. Produce feedback estructurado;
no toca DOM, Workers ni almacenamiento.

El texto visible se produce con un renderizador determinista de plantillas. Recibe
evidencia estructurada —clasificación, motivo, piezas, casillas y variante— y devuelve
mensajes localizados. No consulta un LLM ni una API para redactar cada explicación.

## Contrato de análisis

Cada solicitud incluye FEN, límite, MultiPV y perspectiva. Cada resultado incluye
identificador, profundidad, nodos, variantes y una puntuación discriminada como
centipeones o mate; WDL es opcional. Nunca uses un valor de mate como centipeones.

## Secuencia tras una jugada

1. `chess-core` valida y aplica el movimiento.
2. Se cancela cualquier análisis incompatible con la nueva posición.
3. El motor evalúa la mejor alternativa previa y la posición resultante.
4. `coach` normaliza ambas desde la perspectiva del jugador.
5. Se calcula el cambio de resultado esperado y se detectan motivos verificables.
6. La UI presenta feedback y habilita la siguiente interacción.
7. El oponente selecciona una jugada acorde con la fuerza configurada.

## Fuerza del oponente

La fuerza no debe depender solo de profundidad. La implementación evaluará opciones
UCI soportadas, presupuesto, MultiPV y selección controlada entre candidatas. Toda
aleatoriedad debe admitir semilla para tests reproducibles.

## Persistencia

El MVP conserva ajustes, partida activa y archivos PGN en almacenamiento local. Una
futura sincronización debe ser opt-in y tener un adaptador separado.

## Integraciones opcionales

Toda API externa vive detrás de un adaptador y no participa en el camino crítico. La
aplicación debe conservar el mismo contrato funcional cuando no haya conexión. Ollama
o cualquier otro modelo de lenguaje no forma parte de la arquitectura aprobada del
MVP; una prueba futura requeriría una decisión nueva, opt-in y fallback determinista.

## Licencias

Antes de integrar un binario Stockfish/WASM se registrarán versión, URL de origen,
hash, licencia, avisos y mecanismo para ofrecer el código fuente correspondiente.
