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
pnpm dev
```

`pnpm dev` prepara Maia-3 local, espera a que `/health` confirme una inferencia de
calentamiento real y arranca Vite con el proxy apuntando al puerto correcto del bridge.
El comando elige el primer puerto libre para la web empezando por `5173` y muestra la
URL activa en consola. Al cerrar el proceso se detienen juntos Vite y el companion local.

Si prefieres abrir el navegador automáticamente, usa `play.ps1` o el comando global
`play` descrito debajo.

En esta máquina también está instalado el comando global `play`. Puede ejecutarse
desde cualquier carpeta de PowerShell:

```powershell
play
```

`play` usa el mismo lanzador que `pnpm dev`, abre el navegador automáticamente y reutiliza
la URL real elegida por Vite. La primera ejecución
instala Maia-3 y PyTorch en `.runtime/maia3` (aprox. 750 MB) y descarga el checkpoint
5M (aprox. 21 MB); las siguientes partidas funcionan sin conexión. Si un puerto
pertenece a otro programa, el lanzador elige otro puerto local libre en lugar de cerrar
un proceso ajeno.

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

El agente principal usa `gpt-5.6-sol` exclusivamente como jefe: planifica, define
criterios, asigna, media y sintetiza, pero no implementa ni genera activos. La ejecución
se delega al rol más específico: `chess_engine` usa GPT-5.4, Terra cubre frontend,
coaching y activos visuales originales, Luna explora y prueba, y GPT-5.5 revisa.
Después de cada entrega, el orquestador pasa el diff y la evidencia al revisor y devuelve
los hallazgos al mismo ejecutor mediante follow-up hasta aprobar, bloquearse o estancarse.
Una continuación aprobada solo se ejecuta automáticamente si es concreta, medible, segura
y no amplía el objetivo. La disponibilidad efectiva sigue dependiendo de la cuenta y del
cliente de Codex. Abre una sesión nueva tras cambiar `.codex/` y consulta `AGENTS.md` para
el enrutamiento.

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
