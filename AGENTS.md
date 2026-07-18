# Acuerdos de trabajo para Codex

## Misión

Construir una aplicación web/PWA de entrenamiento de ajedrez que juegue contra
el usuario y explique sus decisiones durante la partida. El análisis ajedrecístico
debe funcionar localmente con un motor compatible con UCI compilado a WebAssembly.
El MVP no usa modelos de lenguaje, ni remotos ni locales. El feedback se genera con
evidencia del motor, detectores deterministas y plantillas estructuradas. No añadas
OpenAI, Ollama u otro LLM salvo que el usuario solicite explícitamente un experimento
posterior; nunca será la fuente de verdad para legalidad, evaluación o táctica.

El producto se inspira en el concepto de «jugar con un entrenador», pero debe tener
marca, textos, personajes, diseño y activos propios. No copies código, imágenes,
voces, nombres de entrenadores ni interfaz propietaria de Chess.com.

## Rol del agente principal

El agente principal es el orquestador. Mantiene el objetivo, toma decisiones
transversales, asigna propietarios de archivos, integra resultados y realiza la
validación final. Para tareas con dos o más líneas de trabajo independientes:

1. Escribe o actualiza un plan antes de implementar.
2. Delega los bloques independientes a agentes especializados.
3. No asignes el mismo archivo a dos agentes que trabajen en paralelo.
4. Espera los resultados, revisa los cambios y resuelve contradicciones.
5. Ejecuta la validación proporcional al riesgo antes de declarar que terminó.

Usa como máximo cuatro subagentes simultáneos salvo que el usuario solicite otra
cosa. Los subagentes no deben crear descendientes; la profundidad configurada es 1.
No delegues cambios triviales ni tareas que dependan secuencialmente unas de otras.

## Enrutamiento de subagentes

| Agente                 | Úsalo para                                                            |
| ---------------------- | --------------------------------------------------------------------- |
| `repo_explorer`        | Localizar código, dependencias e impacto sin modificar archivos.      |
| `product_architect`    | PRD, límites de alcance, arquitectura y decisiones transversales.     |
| `chess_engine`         | UCI, Stockfish/WASM, Web Workers, FEN/PGN, fuerza y rendimiento.      |
| `coach_designer`       | Métricas, WDL, clasificación, pistas y explicaciones pedagógicas.     |
| `frontend_builder`     | React, tablero, accesibilidad, PWA y experiencia móvil.               |
| `qa_evals`             | Tests, fixtures, evaluaciones, rendimiento y criterios de aceptación. |
| `independent_reviewer` | Revisión final independiente de corrección y regresiones.             |

## Fuente de verdad y documentación

- `docs/PRODUCT.md`: alcance y requisitos del producto.
- `docs/ARCHITECTURE.md`: límites técnicos y flujo de datos.
- `docs/COACHING_MODEL.md`: semántica de evaluación y feedback.
- `docs/QUALITY.md`: estrategia de pruebas y umbrales.
- `docs/ROADMAP.md`: fases y prioridades.
- `docs/DECISIONS.md`: decisiones duraderas y alternativas descartadas.
- `PLANS.md`: formato para planes de ejecución largos.

Si código y documentación discrepan, no ocultes la divergencia: corrige la fuente
que esté obsoleta en el mismo cambio o registra la decisión pendiente.

## Enrutamiento de skills

- `find-skills`: úsala para buscar capacidades nuevas antes de instalar skills de
  procedencia desconocida; comprueba fuente, adopción y contenido.
- `vercel-react-best-practices`: úsala al implementar o revisar componentes React,
  rendimiento de renderizado y tamaño del bundle.
- `accessibility`: úsala en el tablero, controles, diálogos, feedback dinámico y
  cualquier revisión WCAG o de teclado.
- `playwright`: úsala para recorridos E2E, regresiones visuales y pruebas reales del
  navegador.
- `security-best-practices` y `security-threat-model`: úsalas cuando el usuario pida
  una revisión de seguridad o antes de una entrega pública con cambios de confianza.
- `openai-docs`: úsala para cambios en modelos, Codex o integraciones OpenAI.

No cargues una skill por proximidad temática si la tarea no activa su descripción.
Prefiere pocas skills relevantes y evita instalar alternativas redundantes.

## Arquitectura del repositorio

- `apps/web`: aplicación React/Vite, experiencia PWA y composición de módulos.
- `packages/chess-core`: reglas, tipos de dominio, FEN y PGN.
- `packages/engine`: contrato UCI y ejecución del motor en un Worker.
- `packages/coach`: evaluación pedagógica, pistas y mensajes estructurados.
- `tests/evals`: posiciones y partidas de referencia para evaluar el entrenador.
- `plans`: planes de ejecución activos o históricos.

Mantén dependencias unidireccionales:

```text
web -> coach -> engine
web -> chess-core
coach -> chess-core
engine -> chess-core
```

`chess-core`, `engine` y `coach` no pueden importar componentes de `apps/web`.

## Principios del producto

- Offline-first y privacidad por defecto; ninguna partida sale del dispositivo sin
  consentimiento explícito.
- Una API externa gratuita solo puede ser una mejora opcional, con fallback local y
  sin enviar partidas o datos personales sin consentimiento. Ninguna función central
  puede depender de disponibilidad de red, cuota o permanencia de un tercero.
- Separa la evaluación objetiva del motor de la explicación pedagógica.
- No presentes una métrica inventada como «probabilidad exacta de éxito».
- Prefiere WDL del motor cuando esté disponible; conserva centipeones y mate como
  datos técnicos separados.
- Las clasificaciones deben considerar el cambio de resultado esperado, no solo
  una pérdida fija de centipeones.
- Las pistas son progresivas: objetivo, pieza/zona y, solo al final, movimiento.
- Toda salida del motor se trata como entrada no confiable y se valida.
- El hilo de UI nunca debe bloquearse esperando al motor.
- La degradación por dispositivos lentos debe reducir profundidad o tiempo, no
  romper la partida.

## Convenciones de código

- TypeScript estricto; identificadores y comentarios técnicos en inglés.
- Textos visibles y documentación de producto en español por defecto.
- Funciones pequeñas y puras en la capa de dominio; efectos en adaptadores.
- Representa posiciones con FEN y partidas/intercambio con PGN.
- Evita valores mágicos: los umbrales del entrenador deben estar nombrados,
  documentados y cubiertos por tests.
- No mezcles una actualización masiva de dependencias con una funcionalidad.
- Para Stockfish u otro motor, documenta versión, origen, hash y obligaciones de
  licencia antes de distribuir binarios o WASM.

## Flujo de implementación

1. Lee los documentos relevantes y el `AGENTS.md` más cercano al archivo.
2. Define criterios de aceptación observables.
3. Implementa el cambio más pequeño que complete esos criterios.
4. Añade o actualiza tests; para lógica de ajedrez incluye FEN/PGN reproducibles.
5. Ejecuta primero las comprobaciones del paquete afectado y después las globales.
6. Revisa el diff para detectar cambios no intencionales.

## Comandos

```powershell
pnpm install
pnpm dev
pnpm typecheck
pnpm test
pnpm build
pnpm check
pnpm format:check
```

## Definición de terminado

Una tarea está terminada cuando el comportamiento solicitado existe, sus contratos
siguen siendo válidos, los tests relevantes pasan, la documentación afectada está
actualizada y el agente informa qué verificó. Un build verde por sí solo no compensa
funcionalidad eliminada, tests debilitados ni métricas pedagógicas engañosas.
