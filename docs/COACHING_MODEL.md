# Modelo pedagógico

## Separación de capas

El entrenador produce cinco artefactos distintos:

1. Evidencia del motor: variantes, WDL, centipeones o mate.
2. Métrica calibrada: resultado esperado antes y después.
3. Clasificación: excelente, buena, imprecisión, error o error grave.
4. Explicación: motivo verificable, consecuencia principal y mejor jugada.
5. Presentación: resumen y detalle visible, distintos pero derivados de la misma
   explicación.
6. Pista: revelación progresiva para la siguiente decisión.

No combines estas capas en una sola cadena de texto interna.

## Revisión postpartida

La revisión postpartida usa `PostgameSummary v1`. Resume únicamente la línea final,
con los momentos críticos y su contexto, y no convierte cada jugada en una pieza
pedagógica independiente. `StoredGame` y `SessionWorkspace` siguen en v6; la revisión
es una vista opcional sobre la partida ya terminada.

## Índice de estabilidad RMS

El índice de estabilidad RMS clasifica cada jugada final en buckets `coverage`,
`partial` o `no-margin` según la cobertura de las variaciones, la presencia de
margen y la dispersión entre candidatas. Cada jugador mantiene sus propios buckets;
no se mezclan estadísticas de blancas y negras en un único contador.

## Generación de explicaciones sin LLM

El feedback se construye de forma determinista:

1. El motor aporta evaluación, variantes y WDL.
2. Los detectores comparan el tablero antes y después para identificar material,
   amenazas, seguridad del rey, desarrollo, actividad y motivos tácticos.
3. Un selector prioriza un motivo principal; si la confianza es baja, evita inventar
   una causa y solo ofrece la recomendación mínima.
4. Plantillas localizadas insertan piezas, casillas, movimientos SAN y consecuencias.
5. Un validador confirma que cada movimiento citado es legal en la FEN correspondiente.

Este enfoque es reproducible, funciona offline y evita explicaciones inventadas. Un
modelo local como Ollama no es necesario para el MVP y no debe añadirse como atajo
para suplir detectores o datos estructurados ausentes.

La confianza interna no se expone en la UI. `high` y `medium` pueden justificar una
causa visible; `low` cae en `recommendation-only` y muestra únicamente la mejor
jugada y la consecuencia directa que sí se puede defender.

## Resultado esperado

La clasificación actual sigue las categorías públicas de Chess.com Classification
V2 y está versionada como `chesscom-classification-v2`; los
motivos verificables como `motif-v2`. Los registros antiguos con `motif-v1`
siguen siendo legibles al recuperar partidas guardadas.

Cuando el motor ofrece WDL, deriva el resultado esperado como:

```text
expectedScore = (wins + 0.5 * draws) / total
```

Si solo existen centipeones, utiliza una curva calibrada y versionada. La curva es
una estimación para ordenar decisiones, no una probabilidad exacta de victoria.
Chess.com indica que su conversión exacta depende también del rating, pero no
publica la función completa; por eso el proyecto replica sus cortes de
clasificación, no pretende reproducir su Expected Points numérico bit a bit.

## Pérdida de la jugada

```text
expectedLoss = max(0, expectedScoreBest - expectedScorePlayed)
```

La clasificación debe incorporar contexto:

- cambio de resultado esperado;
- mate creado, perdido o evitado;
- material y táctica inmediata;
- posición ya ganada o perdida;
- dificultad y unicidad de la mejor jugada;
- nivel de ayuda elegido.

Los cortes públicos replicados son: `Best=0`, `Excellent=0–0,02`,
`Good=0,02–0,05`, `Inaccuracy=0,05–0,10`, `Mistake=0,10–0,20` y
`Blunder=0,20–1,00`. Los límites se mantienen como configuración versionada,
nunca dispersos por la UI. `Great`, `Brilliant` y `Miss` siguen siendo reglas
especiales que no se reducen a la pérdida esperada.

## Feedback

Un mensaje útil responde, cuando sea posible, a tres preguntas: qué pasó, por qué
importa y cuál es la mejor jugada. La versión visible debe ser corta: una línea para
la jugada y una o dos frases para la causa y la consecuencia.

La revisión posterior usa una voz cercana y serena, pero continúa siendo una
proyección determinista de evidencia estructurada. Si la confianza interna es alta o
media, puede nombrar una causa verificable; si es baja, evita inventarla y se limita
a recomendar la mejor continuación legal. La PV solo sirve como evidencia, no como
texto de interfaz.

Si varias jugadas son equivalentes, debe decirlo en lugar de inventar una única
solución. Si no hay PV legal, el texto lo declara y no nombra una mejor jugada. Las
calibraciones desde centipeones se marcan como «estimación» incluso en este formato
compacto.

El texto visible no contiene identificadores internos de motivos ni convierte la
pérdida esperada en el centro del mensaje. La evaluación numérica se conserva en el
historial, normalizada siempre desde la perspectiva del usuario. Las jugadas de Maia
reciben evaluación técnica, pero no clasificación pedagógica ni icono de calidad.

### Valoración progresiva

La clasificación numérica se calcula en una función pura separada de motivos, texto y
pistas. Durante la búsqueda posterior, la UI puede aplicar esa misma función a una
línea `info` normalizada desde profundidad 6 y mostrar un icono provisional. El icono
se marca como provisional para tecnologías de asistencia, solo cambia cuando cambia
la categoría y nunca se guarda en la partida. Antes de clasificar se reproducen por
completo las PV anterior y posterior; una línea sintáctica pero ilegal se descarta.

La vista compacta y la ampliada deben derivarse del mismo registro, pero no repetir el
mismo texto literal: el resumen prioriza jugada, motivo y mejor continuación; el
detalle añade la evidencia técnica que lo respalda.

El registro final sigue dependiendo del resultado completo de Stockfish. Al recibir
`bestmove`, se repite exactamente la misma función con las líneas finales validadas y
su etiqueta sustituye al provisional. Por tanto, una estimación temprana puede
estabilizarse o corregirse, pero nunca modifica la evidencia, explicación o
clasificación persistida.

Las familias de plantillas pueden variar la entrada y la cadencia, nunca el hecho
afirmado. El renderizador dispone de un catálogo acotado de variantes
semánticamente equivalentes y selecciona una de forma estable a partir de la
identidad de la media jugada y del tipo de explicación; no usa aleatoriedad, ni
estado mutable, ni memoria de visitas recientes. La misma identidad reproduce la
misma familia y los mismos hechos, aunque `summary` y `detail` deban expresarse con
frases distintas. Si falta evidencia suficiente, el renderizador usa una explicación
neutral y honesta.

## Pistas progresivas

- Nivel 1: objetivo estratégico o táctico.
- Nivel 2: pieza, casilla o zona relevante.
- Nivel 3: movimiento recomendado y variante corta.

Cada nivel debe poder generarse desde datos estructurados y mantener la legalidad.

Los niveles de ayuda se interpretan así: «Sin ayudas» conserva solo historial,
evaluación e iconos; «Normal» añade la revisión completa posterior; «Guiada» añade
además pistas progresivas para la siguiente decisión. La revisión de un error puede
mostrar directamente la mejor alternativa ya pasada: las pistas siguen reservadas
para la posición que el usuario todavía debe resolver.

## Reglas de honestidad

- Di «estimación» cuando haya calibración heurística.
- Muestra incertidumbre si varias jugadas son equivalentes.
- No reprendas una jugada por una diferencia inferior al ruido del análisis.
- No llames error a perder centipeones si el resultado esperado apenas cambia.
- No felicites una jugada ilegal, imposible en la posición o atribuida a otra FEN.

## Identidad y estados del feedback

Cada feedback queda anclado a una media jugada concreta: línea, índice, actor, UCI y
FEN de entrada/salida. Si la línea cambia mientras llega un resultado, ese resultado
se descarta y la sesión no puede quedarse en `pending`.

La experiencia visible distingue entre estado lento, resultado listo, error
recuperable y análisis no disponible. El detalle completo sigue accesible aunque la
tarjeta compacta sea la vista principal en móvil.
