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
