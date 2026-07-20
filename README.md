# Chess Coach

Web/PWA de entrenamiento de ajedrez que combina una partida contra un motor local
con explicaciones, pistas progresivas y feedback en tiempo real. El proyecto está
incluye Stockfish local para el análisis pedagógico y Maia-3 5M como oponente
humano-realista en el modo de escritorio local.

El producto no necesita un LLM: el feedback se construirá localmente mediante
Stockfish, detectores de motivos y plantillas pedagógicas. Ollama y los modelos
remotos quedan fuera del MVP.

## Inicio rápido

Requisitos de desarrollo: Node.js 22–24 y pnpm 11. Para jugar contra Maia-3 se
necesita además Python 3.10–3.12 y Git.

```powershell
pnpm install
.\play.ps1
```

`pnpm dev` inicia únicamente la interfaz Vite para desarrollo. Para jugar una partida
completa debe usarse `play.ps1` (o el comando global `play` descrito debajo), que prepara
y arranca también el companion local de Maia-3 antes de abrir la web.

En esta máquina también está instalado el comando global `play`. Puede ejecutarse
desde cualquier carpeta de PowerShell:

```powershell
play
```

`play` prepara el companion local de Maia-3, cierra únicamente procesos anteriores
de este proyecto, fuerza una reconstrucción de desarrollo, inicia la última versión
en `http://127.0.0.1:5173` y abre el navegador automáticamente. La primera ejecución
instala Maia-3 y PyTorch en `.runtime/maia3` (aprox. 750 MB) y descarga el checkpoint
5M (aprox. 21 MB); las siguientes partidas funcionan sin conexión. Si un puerto
pertenece a otro programa, el lanzador se detiene en lugar de cerrar un proceso ajeno.

El Elo configurado para Maia-3 está calibrado sobre partidas Lichess Blitz. Es una
referencia de estilo de juego, no una equivalencia directa con Elo FIDE o Chess.com.

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

- Tablero React/Vite interactivo, accesible y persistente.
- Stockfish WASM local como fuente de análisis pedagógico.
- Maia-3 5M local como oponente mediante un companion UCI separado.
- Tests unitarios de dominio, motor, persistencia e interacción incluidos.
