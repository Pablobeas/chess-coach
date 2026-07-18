# Modelo pedagógico

## Separación de capas

El entrenador produce cinco artefactos distintos:

1. Evidencia del motor: variantes, WDL, centipeones o mate.
2. Métrica calibrada: resultado esperado antes y después.
3. Clasificación: excelente, buena, imprecisión, error o error grave.
4. Explicación: motivo verificable y consecuencia principal.
5. Pista: revelación progresiva para la siguiente decisión.

No combines estas capas en una sola cadena de texto interna.

## Generación de explicaciones sin LLM

El feedback se construye de forma determinista:

1. El motor aporta evaluación, variantes y WDL.
2. Los detectores comparan el tablero antes y después para identificar material,
   amenazas, seguridad del rey, desarrollo, actividad y motivos tácticos.
3. Un selector prioriza un motivo principal y, cuando ayuda, uno secundario.
4. Plantillas localizadas insertan piezas, casillas, movimientos SAN y consecuencias.
5. Un validador confirma que cada movimiento citado es legal en la FEN correspondiente.

Este enfoque es reproducible, funciona offline y evita explicaciones inventadas. Un
modelo local como Ollama no es necesario para el MVP y no debe añadirse como atajo
para suplir detectores o datos estructurados ausentes.

## Resultado esperado

Cuando el motor ofrece WDL, deriva el resultado esperado como:

```text
expectedScore = (wins + 0.5 * draws) / total
```

Si solo existen centipeones, utiliza una curva calibrada y versionada. La curva es
una estimación para ordenar decisiones, no una probabilidad exacta de victoria.

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

No fijes todavía los umbrales definitivos. Se calibrarán con `tests/evals` y quedarán
como configuración versionada, nunca dispersos por la UI.

## Feedback

Un mensaje útil responde, cuando sea posible, a tres preguntas: qué cambió, por qué
y qué patrón debe buscar el jugador después. Evita afirmar intenciones que no puedan
deducirse de la posición.

## Pistas progresivas

- Nivel 1: objetivo estratégico o táctico.
- Nivel 2: pieza, casilla o zona relevante.
- Nivel 3: movimiento recomendado y variante corta.

Cada nivel debe poder generarse desde datos estructurados y mantener la legalidad.

## Reglas de honestidad

- Di «estimación» cuando haya calibración heurística.
- Muestra incertidumbre si varias jugadas son equivalentes.
- No reprendas una jugada por una diferencia inferior al ruido del análisis.
- No llames error a perder centipeones si el resultado esperado apenas cambia.
- No felicites una jugada ilegal, imposible en la posición o atribuida a otra FEN.
