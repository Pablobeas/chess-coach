# Evaluación reproducible: `local-game-slice`

Esta colección cubre el flujo mínimo de una partida local contra un motor
simulado determinista. Las posiciones son sintéticas y se expresan con FEN; las
secuencias de partida se expresan con PGN y, cuando se comprueba el contrato del
motor, también con movimientos UCI. No se asume el nombre de una apertura ni un
valor exacto de centipeones.

## Reglas de ejecución

- Cada caso empieza con una sesión nueva o carga exactamente el FEN indicado.
- El FEN observado después de una jugada debe conservar sus seis campos y el
  PGN debe poder reconstruir la misma posición.
- Una jugada del usuario se aplica antes de solicitar la respuesta del motor.
- El motor simulado usa semilla fija `local-game-slice-v1` y una tabla de
  respuestas por FEN. No se permite aleatoriedad no sembrada.
- En casos de UI, "visible" significa que el estado tiene texto accesible y no
  depende únicamente de color, animación o iconos.
- Los estados asíncronos se comprueban con reloj controlado: ninguna espera del
  motor debe bloquear la interacción del hilo principal.

## Fixtures de posición y partida

### `LG-001` — Posición inicial y primer turno

```text
FEN: rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1
PGN: *
Turno esperado: white
```

Propiedad verificada: la sesión comienza en la posición estándar, muestra un
tablero 8x8 y el usuario blanco puede iniciar la partida.

### `LG-002` — Secuencia legal mínima con respuesta del motor

```text
FEN inicial: rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1
PGN esperado: 1. e4 e5
Movimientos usuario/motor: e2e4, e7e5
FEN tras e4: rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1
FEN final: rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2
Turnos: white -> black -> white
```

Propiedad verificada: cada movimiento legal alterna el turno, actualiza el
historial una sola vez y deja habilitada la siguiente interacción solo cuando
corresponde.

### `LG-003` — Movimiento ilegal no mutante

```text
FEN: rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1
PGN antes: *
Intento ilegal: e2e5
FEN/PGN/turno después: iguales a antes; white
```

Propiedad verificada: una pieza no puede saltar dos casillas desde e2; el
intento no cambia piezas, FEN, PGN, turno ni dispara una solicitud al motor.
El rechazo debe ser comprensible y accesible.

### `LG-004` — Turno negro y legalidad de captura

```text
FEN: 4k3/8/8/3p4/4P3/8/8/4K3 b - - 0 1
PGN: *
Movimiento legal: d5xe4 (UCI d5e4)
FEN posterior: 4k3/8/8/8/4p3/8/8/4K3 w - - 0 2
```

Propiedad verificada: una posición cargada respeta el color activo del FEN y
solo ese color puede mover; la captura elimina el peón blanco y devuelve el
turno a white. Un intento de `e4e5` antes de la captura debe rechazarse.

### `LG-005` — Deshacer después de una pareja usuario/motor

```text
PGN antes de deshacer: 1. e4 e5
FEN antes de deshacer: rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2
Acción: deshacer una vez
FEN esperada: rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1
PGN esperado: 1. e4
Turno esperado: black (respuesta pendiente del motor)
```

Propiedad verificada: deshacer quita la última media jugada del motor, conserva
la de usuario y cancela cualquier análisis o turno de motor asociado a la
posición descartada. No se reutiliza feedback calculado para e5.

### `LG-006` — Deshacer durante carga y resultado tardío

```text
FEN de solicitud A: rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1
PGN de solicitud A: 1. e4
Acción: deshacer antes de resolver A
FEN actual: rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1
PGN actual: *
Resultado tardío A: bestmove e7e5
```

Propiedad verificada: el resultado tardío no puede escribir una jugada, feedback
ni estado de carga en la posición inicial. La sesión queda en turno white y el
botón de motor no queda bloqueado.

### `LG-007` — Respuesta determinista del motor simulado

```text
FEN: rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1
PGN: 1. e4
Respuesta UCI esperada: e7e5
FEN después de aplicar respuesta: rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2
```

Propiedad verificada: para el mismo FEN, presupuesto y semilla el motor devuelve
la misma jugada legal. La UI no debe aceptar una jugada de color incorrecto,
una casilla inexistente o una línea UCI que no pueda aplicarse a ese FEN.

### `LG-008` — Estado de error del motor

```text
FEN: rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1
PGN: 1. e4
Respuesta simulada inválida: bestmove e2e5
Alternativa de fallo: la promesa del motor rechaza con EngineUnavailable
```

Propiedad verificada: una respuesta inválida o un rechazo no muta la partida,
mantiene el turno black, termina el loading y muestra un error accionable con
reintento. El error no expone un stack trace como único mensaje ni deja la sesión
inutilizable.

## Criterios de aceptación observables

### Legalidad y turnos

- **AC-L01:** con `LG-001`, el tablero contiene 64 casillas y la posición coincide
  con el FEN inicial.
- **AC-L02:** con `LG-002`, una jugada legal actualiza FEN e historial y alterna
  exactamente el turno; no se duplica por doble clic o re-render.
- **AC-L03:** con `LG-003`, la posición, PGN, turno y número de solicitudes del
  motor no cambian.
- **AC-L04:** con `LG-004`, se respeta el color activo cargado y la captura
  produce exactamente el FEN posterior indicado.
- **AC-L05:** una jugada legal siempre puede reconstruirse desde el PGN acumulado;
  una jugada rechazada no aparece en el PGN.

### Deshacer y reiniciar

- **AC-U01:** `LG-005` devuelve el snapshot exacto indicado, elimina solo la
  última media jugada y permite volver a jugar desde esa posición.
- **AC-U02:** `LG-006` descarta resultados tardíos mediante id/generación de
  sesión; no sobrescribe posición, turno, PGN, feedback ni loading.
- **AC-U03:** reiniciar desde cualquier punto devuelve `LG-001`, borra historial
  y feedback, y deja el turno en white.

### Motor simulado

- **AC-E01:** `LG-007` produce una respuesta determinista y legal para el FEN
  solicitado; la petición conserva id, FEN, límite y `multiPv`.
- **AC-E02:** la aplicación no espera sincrónicamente al motor: durante una
  respuesta retrasada el tablero sigue pintándose y los controles no esenciales
  siguen respondiendo.
- **AC-E03:** la cancelación se observa al cambiar de posición o deshacer; una
  promesa abortada no se presenta como error de usuario.
- **AC-E04:** `LG-008` valida el resultado antes de aplicarlo y permite reintentar
  sin recargar ni perder la partida.

### Accesibilidad e interacción

- **AC-A01:** cada casilla/pieza accionable tiene nombre accesible que incluye
  origen, destino o pieza relevante; el foco visible no se pierde al mover.
- **AC-A02:** se puede seleccionar y mover una pieza con teclado, incluyendo
  confirmar una casilla destino y cancelar la selección, sin depender de color.
- **AC-A03:** la misma jugada de `LG-002` funciona con interacción táctil; la
  selección se comunica con texto o estado semántico, no solo con resaltado.
- **AC-A04:** turno, movimiento rechazado, loading, error y confirmación de
  deshacer se anuncian en una región `status`/live apropiada sin robar el foco.
- **AC-A05:** botones de deshacer, reiniciar y reintentar tienen nombre, estado
  disabled correcto y orden de foco lógico; el contraste y el foco son visibles.

### Loading y resiliencia

- **AC-S01:** al solicitar `LG-007`, se muestra un estado de espera textual y
  accesible antes de resolver la promesa; no se anuncia como partida terminada.
- **AC-S02:** al resolver el motor, loading desaparece exactamente una vez y el
  turno/historial reflejan el FEN final, sin parpadeos ni movimiento duplicado.
- **AC-S03:** al deshacer durante loading (`LG-006`), el estado queda listo para
  una nueva jugada y ningún resultado antiguo puede reactivar loading.
- **AC-S04:** ante `LG-008`, el error es distinguible de loading, persiste hasta
  que se reintenta o se descarta y ofrece una salida recuperable.

## Matriz mínima de ejecución

| Caso   | Dominio | Integración Worker simulado | E2E/UI | Riesgo cubierto                    |
| ------ | ------- | --------------------------- | ------ | ---------------------------------- |
| LG-001 | Sí      | No                          | Sí     | Estado inicial y tablero           |
| LG-002 | Sí      | Sí                          | Sí     | Flujo feliz y alternancia          |
| LG-003 | Sí      | No                          | Sí     | Jugada ilegal no mutante           |
| LG-004 | Sí      | No                          | Sí     | FEN con turno negro y captura      |
| LG-005 | Sí      | Sí                          | Sí     | Deshacer y feedback obsoleto       |
| LG-006 | No      | Sí                          | Sí     | Cancelación y respuesta tardía     |
| LG-007 | Sí      | Sí                          | Sí     | Legalidad/determinismo UCI         |
| LG-008 | No      | Sí                          | Sí     | Validación y recuperación de error |

## Condiciones de salida

La feature no pasa si falla cualquier `AC-L*`, `AC-U*` o `AC-E*`, si un resultado
tardío muta la sesión, o si loading/error no es operable con teclado y lector de
pantalla. Los detalles visuales no fijados aquí pueden variar, pero deben conservar
los estados semánticos y los FEN/PGN de los fixtures.

Las pruebas automatizadas de este documento deben incorporarse junto al paquete
que posee el comportamiento; este archivo solo define el contrato reproducible y
no importa componentes de `apps/web` ni implementa lógica de `packages`.
