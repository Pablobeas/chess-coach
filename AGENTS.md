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

El agente principal usa Sol con razonamiento alto exclusivamente como jefe de
orquestación. Mantiene el objetivo, define o actualiza el plan y los criterios de
aceptación, toma decisiones transversales, asigna propietarios de archivos, media
contradicciones y sintetiza resultados. Sol no escribe código, no edita archivos, no
genera ni edita imágenes y no ejecuta validaciones rutinarias. Antes de cualquier
cambio, clasifica el trabajo y selecciona el agente ejecutor más específico de la
tabla de enrutamiento; conserva el contexto global y delega la ejecución y la
validación.

Para una sola línea de trabajo, delega en un agente especializado. Usa `fast_worker`
para cambios inequívocos y mecánicos, e `implementation_worker` para implementación
general que no pertenezca a otro dominio. Para tareas con dos o más líneas de trabajo
independientes:

1. Escribe o actualiza un plan antes de implementar.
2. Delega los bloques independientes a agentes especializados.
3. No asignes el mismo archivo a dos agentes que trabajen en paralelo.
4. Espera los resultados, revisa los cambios y resuelve contradicciones.
5. Encarga la validación proporcional al riesgo al ejecutor o a `qa_evals`, y revisa
   la evidencia devuelta antes de declarar que terminó.

Usa como máximo cuatro subagentes simultáneos salvo que el usuario solicite otra
cosa. Los subagentes no deben crear descendientes; la profundidad permitida es 1.
Las tareas dependientes deben delegarse en secuencia, pasando un resumen verificado
entre agentes. No crees varios agentes para una tarea trivial.

### Ciclo mediado de ejecución y revisión

Cada ejecutor entrega un handoff conciso con archivos modificados, criterios cubiertos,
comandos y resultados, evidencia relevante y riesgos. El orquestador entrega al
`independent_reviewer` el diff y esa evidencia. El revisor responde exclusivamente
con `APPROVED`, `NEEDS_CHANGES` con hallazgos accionables, o
`APPROVED_WITH_CONTINUATION` con una mejora concreta dentro del alcance.

Ante `NEEDS_CHANGES`, el orquestador devuelve los hallazgos al mismo ejecutor mediante
un follow-up, conservando su propiedad de archivos. El ejecutor corrige, vuelve a
entregar handoff y se repite la revisión mientras haya evidencia de progreso. Los
subagentes no crean descendientes ni se transfiere la propiedad de archivos durante
el ciclo salvo una decisión explícita del orquestador.

No hay un máximo numérico de ciclos. El ciclo termina cuando `APPROVED` y se cumplen
los criterios y pruebas requeridos; cuando existe un bloqueo que exige al usuario,
permiso o expansión de alcance; o por estancamiento si reaparece el mismo hallazgo sin
evidencia de progreso. Una `APPROVED_WITH_CONTINUATION` se ejecuta automáticamente
solo si la mejora es concreta, medible, segura y está dentro del objetivo original.
Si amplía el alcance, el orquestador la presenta al usuario.

## Enrutamiento de subagentes

| Agente                  | Modelo       | Úsalo para                                                               |
| ----------------------- | ------------ | ------------------------------------------------------------------------ |
| `repo_explorer`         | 5.6 Luna     | Localizar código, dependencias e impacto sin modificar archivos.         |
| `product_architect`     | 5.6 Sol      | PRD, límites de alcance, arquitectura y decisiones transversales.        |
| `chess_engine`          | GPT-5.4      | Implementar UCI, Stockfish/WASM, Workers, FEN/PGN, fuerza y rendimiento. |
| `coach_designer`        | 5.6 Terra    | Métricas, WDL, clasificación, pistas y explicaciones pedagógicas.        |
| `frontend_builder`      | 5.6 Terra    | React, tablero, accesibilidad, PWA y experiencia móvil.                  |
| `qa_evals`              | 5.6 Luna     | Tests, fixtures, evaluaciones, rendimiento y criterios de aceptación.    |
| `implementation_worker` | GPT-5.4      | Código acotado que no pertenezca a un especialista de dominio.           |
| `fast_worker`           | GPT-5.4 mini | Ediciones triviales, mecánicas, documentales o de configuración.         |
| `visual_asset_worker`   | 5.6 Terra    | Generar o editar imágenes y activos visuales originales del proyecto.    |
| `independent_reviewer`  | GPT-5.5      | Revisión final independiente de corrección y regresiones.                |

La selección se hace por ajuste entre tarea y rol, no para repartir uso entre
modelos. Sol solo planifica, define criterios, asigna, media, decide y sintetiza; no
se asigna como ejecutor. Si una tarea es ambigua o cruza dominios,
`product_architect` delimita primero los contratos de forma read-only y después
ejecutan los especialistas afectados. Usa
`independent_reviewer` tras cambios de alto riesgo, concurrentes, transversales o
listos para entrega. Si el cliente no ofrece el modelo configurado, conserva el rol,
elige el modelo disponible más cercano en capacidad y comunica el fallback; el
repositorio no puede conceder acceso a modelos que la cuenta o la superficie no tenga.

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

El proyecto combina desarrollo guiado por funcionalidades con TDD:

1. Lee los documentos relevantes y el `AGENTS.md` más cercano al archivo.
2. Define una funcionalidad vertical y criterios de aceptación observables.
3. Escribe primero tests para dominio, contratos y casos de riesgo.
4. Implementa el cambio mínimo que haga pasar esos tests.
5. Completa la funcionalidad de extremo a extremo, incluyendo integración y E2E
   cuando afecte a la interfaz o al flujo de sesión.
6. Ejecuta primero las comprobaciones del paquete afectado y después las globales.
7. Revisa el diff, el rendimiento, la accesibilidad y los cambios no intencionales.

TDD es obligatorio para reglas de ajedrez, contratos UCI, cancelación, métricas,
clasificación y persistencia. Para estilos o exploración visual se pueden crear
primero criterios de aceptación y una implementación manual, pero la funcionalidad
terminada debe conservar pruebas de regresión apropiadas.

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
