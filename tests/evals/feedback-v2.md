# Evaluaciones reproducibles de feedback v2

Esta colección es un contrato de evaluación para el entrenador. Cada caso se
ejecuta con la posición FEN indicada (o reproduciendo el PGN), una semilla fija
`feedback-v2-fixtures-1` y una respuesta de motor simulada. La evidencia es
deliberadamente cualitativa (WDL, mate, mejores alternativas y señales
deterministas); nunca se compara un número exacto de centipeones de Stockfish.

## Contrato común

- `userMove` es la única jugada que se clasifica. La perspectiva siempre es la
  del bando que la realizó; invertir el tablero no invierte la etiqueta.
- Antes de aplicar una jugada se valida su legalidad contra el FEN. Una jugada
  ilegal no cambia FEN, PGN, turno, historial ni solicita análisis.
- La salida del motor se valida (FEN de origen, color, PV legal y tipo de score).
  Evidencia ausente o inválida produce `analysis-unavailable`, nunca una
  afirmación de certeza.
- El historial conserva exactamente una entrada por jugada legal del usuario,
  con FEN anterior/posterior y el resultado de su análisis. Deshacer/reiniciar
  elimina entradas descendientes.
- Toda petición lleva `requestId`; cancelar o cambiar de posición invalida la
  generación anterior. Un mensaje tardío no puede mutar partida, feedback,
  loading ni sugerencias.
- La calidad (`quality`) solo se calcula para jugadas del usuario. Las jugadas
  del motor pueden aportar contexto, pero no penalizan ni mejoran la puntuación
  del usuario.
- El copy visible del entrenador tiene una o dos frases: motivo comprobable
  y mejor jugada legal. Si `userMove` inicia la PV validada, debe nombrarla como
  la mejor jugada salvo que tenga una etiqueta negativa o pierda un mate; en ese
  caso describe la PV sin llamarla mejor. Sin PV legal, debe declarar esa ausencia
  y no inventar una alternativa. Las conversiones desde centipeones se marcan como
  estimación.
- Las pistas son progresivas: objetivo → pieza/zona → movimiento concreto; no se
  revela el movimiento en el primer nivel.

## Fixtures sintéticas

### FV2-001 — Apertura equilibrada

```text
FEN: rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1
PGN: 1. e4
userMove: e2e4 (white)
evidence: playedWdl=equal; bestWdl=equal; pv=e7e5,g1f3,b8c6; alternatives=[d2d4,c2c4] all legal
```

Esperado: `classification=book-like-or-equal`, calidad alta/no penalización;
mensaje factual (“mantienes el equilibrio”), sin afirmar nombre de apertura;
las alternativas equivalentes no se presentan como errores.

### FV2-002 — Pieza colgada / pérdida material

```text
FEN: 6k1/2p2ppp/8/8/8/2N5/5P2/6K1 w - - 0 1
PGN: *
userMove: c3b5 (white)
evidence: playedWdl=loss; bestWdl=draw; hangingPiece=Nb5; opponentCanCapture=c6xb5; alternatives=[f2f3,g1f1] legal
```

La evidencia debe corresponder a una posición legal y no inventar una captura:
si el detector no puede demostrar una pieza atacada y sin defensa, la etiqueta
es `inconclusive`. Con evidencia válida, `classification=mistake-material` y
la explicación nombra la pieza/zona, no una causa no observada.

### FV2-003 — Táctica no vista

```text
FEN: 6k1/5ppp/8/8/2B5/8/5PPP/6K1 w - - 0 1
PGN: *
userMove: c4e2 (white)
evidence: playedWdl=loss; bestMove=c4f7; bestWdl=win; tactic=skewer-on-f7; pv=[c4f7,g8h8]; alternatives=[f2f3] legal
```

Esperado: `classification=tactical-miss`; se conserva cualquier score de mate
como tipo separado de cp; el primer hint pide buscar jaques/amenazas, el segundo
señala la diagonal del alfil y solo el tercero puede revelar `Bf7`.

### FV2-004 — Seguridad del rey

```text
FEN: r3k2r/pppq1ppp/2np1n2/8/2B1P3/2N2N2/PPP2PPP/R2Q1RK1 w kq - 6 4
PGN: 1. e4 e5 2. Nf3 Nc6 3. Bc4 Nf6
userMove: g2g3 (white)
evidence: playedWdl=loss; bestWdl=equal; kingExposure=back-rank/diagonal; pv=d1e2; alternatives=[f1e1,d2d3] legal
```

Esperado: `classification=king-safety`; feedback explica la exposición creada
por el enroque/diagonales y ofrece objetivo antes que una jugada; nunca afirma
“pierdes” si la evidencia solo cambia de `equal` a `slight-loss`.

### FV2-005 — Mate y perspectiva

```text
FEN: 7k/5Q2/6K1/8/8/8/8/8 w - - 0 1
PGN: *
userMove: f7e7 (white)
evidence: playedWdl=loss; bestWdl=win; bestMove=f7f8#; mateScore=mate(1) for white; legalMovesAfter=0
```

Esperado: se etiqueta `already-lost` si el bando ya estaba forzado a perder,
pero se informa el mate disponible en la posición sin atribuirlo a la jugada si
no cambia el resultado. Al analizar la misma posición desde la perspectiva
negra, el signo/voz cambia (“el rival tiene mate”), no la identidad del usuario.

### FV2-006 — Alternativas equivalentes

```text
FEN: 8/8/8/8/3k4/8/3PPP2/4K3 w - - 0 1
PGN: *
userMove: e2e3 (white)
evidence: playedWdl=draw; bestWdl=draw; alternatives=[d2d3,f2f3] sameOutcome=draw; allPvLegal=true
```

Esperado: `classification=good-or-equivalent`; no se marca error por no elegir
la primera línea principal y se puede mostrar “también eran buenas” solo cuando
`sameOutcome=true` y todas las PV son legales.

### FV2-007 — Final ya perdido

```text
FEN: 7k/8/8/8/6q1/8/8/5RK1 w - - 0 1
PGN: *
userMove: f1f2 (white)
evidence: playedWdl=loss; bestWdl=loss; forcedMateForOpponent=mate(1); legalMoves=2
```

Esperado: `classification=already-lost`; `quality` no cae por debajo de la
calidad mínima definida para posiciones sin salvación; el mensaje reconoce que
la partida ya estaba perdida y sugiere el objetivo práctico (prolongar/evitar
mate) sin prometer remontada.

### FV2-008 — Análisis no disponible

```text
FEN: rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1
PGN: 1. e4
userMove: e7e5 (black)
evidence: engine=timeout; bestMove=null; wdl=null; pv=[]; elapsedMs=budget
```

Esperado: `classification=analysis-unavailable`, calidad `null` (no cero),
mensaje honesto (“no pude analizar esta jugada”), sin hint concreto ni score
inventado; la partida e historial permanecen utilizables y el reintento crea un
`requestId` nuevo.

## Invariantes de ejecución

1. Reproducir el mismo FEN/PGN, semilla y evidencia produce la misma clasificación,
   severidad, hints y texto parametrizado.
2. Cada `userMove` aceptado es legal y aparece una sola vez en PGN; los intentos
   ilegales son no mutantes.
3. Cambiar de perspectiva solo cambia pronombres/color y signo interpretado,
   nunca convierte una jugada del motor en jugada del usuario.
4. Cancelar, deshacer o cargar otro FEN hace inerte cualquier resultado tardío.
5. En dispositivo lento se reduce profundidad/tiempo dentro del presupuesto;
   nunca se bloquea el hilo, se rompe la legalidad ni se sustituye evidencia por
   una certeza inventada.

## Matriz de cobertura

| Caso    | Apertura | Material | Táctica | Rey | Mate | Equivalentes | Ya perdida | No disponible |
| ------- | -------: | -------: | ------: | --: | ---: | -----------: | ---------: | ------------: |
| FV2-001 |        ✓ |          |         |     |      |              |            |               |
| FV2-002 |          |        ✓ |         |     |      |              |            |               |
| FV2-003 |          |          |       ✓ |     |    ✓ |              |            |               |
| FV2-004 |          |          |         |   ✓ |      |              |            |               |
| FV2-005 |          |          |         |     |    ✓ |              |            |               |
| FV2-006 |          |          |         |     |      |            ✓ |            |               |
| FV2-007 |          |          |         |     |    ✓ |              |          ✓ |               |
| FV2-008 |          |          |         |     |      |              |            |             ✓ |
