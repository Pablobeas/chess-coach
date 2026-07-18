# Chess Coach

Web/PWA de entrenamiento de ajedrez que combina una partida contra un motor local
con explicaciones, pistas progresivas y feedback en tiempo real. El proyecto está
en su fase de cimentación: la estructura multiagente y los contratos iniciales ya
están definidos; la integración real de Stockfish/WASM es el siguiente hito.

El producto no necesita un LLM: el feedback se construirá localmente mediante
Stockfish, detectores de motivos y plantillas pedagógicas. Ollama y los modelos
remotos quedan fuera del MVP.

## Inicio rápido

Requisitos: Node.js 22–24, pnpm 11 y Codex CLI 0.144.6 o posterior para usar
los modelos GPT-5.6 configurados.

```powershell
pnpm install
pnpm dev
```

Comprobación completa:

```powershell
pnpm check
pnpm format:check
```

## Desarrollo con Codex

Abre Codex desde la raíz. Codex carga `AGENTS.md`, `.codex/config.toml` y los
agentes personalizados de `.codex/agents/` en una sesión nueva.

Ejemplo de encargo:

```text
Implementa la primera integración UCI. Usa repo_explorer para inventariar,
chess_engine para la implementación y qa_evals para diseñar las pruebas.
Espera a ambos y pasa el resultado a independent_reviewer antes de terminar.
```

El agente principal usa `gpt-5.6-sol`. Los especialistas usan Terra o Luna según
la carga y el revisor independiente usa GPT-5.5. Consulta `AGENTS.md` para el
enrutamiento y `docs/ROADMAP.md` para el orden de construcción.

Skills globales recomendadas para este repositorio: `find-skills`,
`vercel-react-best-practices`, `accessibility`, `playwright`,
`security-best-practices`, `security-threat-model` y `openai-docs`. Las skills
globales deben instalarse de nuevo cuando se prepare otra máquina; `AGENTS.md`
define cuándo corresponde usar cada una.

## Estado del producto

- Base React/Vite y paquetes de dominio creados.
- Contratos iniciales de motor y entrenador definidos.
- Tests unitarios iniciales incluidos.
- Stockfish/WASM, tablero interactivo y persistencia: pendientes.
