# Alfil Norte

<p align="left">
  <strong>Entrena ajedrez con un rival local y un entrenador determinista que explica cada decisión.</strong>
</p>

<p align="left">
  <img alt="Estado MVP" src="https://img.shields.io/badge/Estado-MVP-2f6f4f?style=flat-square" />
  <img alt="Offline-first" src="https://img.shields.io/badge/Modo-Offline--first-1f6feb?style=flat-square" />
  <img alt="PWA" src="https://img.shields.io/badge/Formato-PWA-0f766e?style=flat-square" />
  <img alt="Motor local" src="https://img.shields.io/badge/Motor-Stockfish%20%2B%20Maia--3-8b5cf6?style=flat-square" />
  <img alt="Node" src="https://img.shields.io/badge/Node-%3E%3D22%20%3C25-333333?style=flat-square" />
  <img alt="pnpm" src="https://img.shields.io/badge/pnpm-11.x-f59e0b?style=flat-square" />
</p>

Alfil Norte es una web/PWA de entrenamiento de ajedrez pensada para jugar partidas completas y entender por qué una jugada funciona o falla. El MVP combina:

- un oponente local basado en Maia-3 5M;
- análisis pedagógico local con Stockfish;
- feedback determinista con detectores de motivos y plantillas;
- puzles y repertorios de aperturas;
- persistencia local y experiencia instalable como PWA.

## Capturas

<table>
  <tr>
    <td align="center">
      <img src="docs/screenshots/home.png" alt="Pantalla principal de Alfil Norte con acceso a partida, puzles y aperturas" width="100%" />
      <br />
      <sub>Inicio</sub>
    </td>
    <td align="center">
      <img src="docs/screenshots/puzzles.png" alt="Modo puzles con ejercicios locales de entrenamiento" width="100%" />
      <br />
      <sub>Puzles</sub>
    </td>
    <td align="center">
      <img src="docs/screenshots/openings.png" alt="Entrenamiento de aperturas con líneas y práctica local" width="100%" />
      <br />
      <sub>Aperturas</sub>
    </td>
  </tr>
</table>

## Qué hace

- Jugar contra un rival local con estilo humano en el modo de escritorio y desarrollo local.
- Analizar cada jugada con evidencia del motor, sin depender de un LLM.
- Mostrar explicaciones breves, deterministas y verificables.
- Dar pistas progresivas: objetivo, pieza o zona, y solo al final el movimiento.
- Guardar partida, historial y PGN en local.
- Funcionar como PWA instalable con una interfaz móvil cuidada.
- Mantener la privacidad por defecto: la partida no necesita salir del dispositivo para jugar ni para recibir feedback.

## Inicio rápido

Requisitos:

- Node.js `>=22 <25`
- pnpm `11.x`
- Python `3.10–3.12`
- Git

Instalación y arranque:

```powershell
pnpm install
pnpm dev
```

Si prefieres abrir el navegador automáticamente en Windows, usa:

```powershell
.\play.ps1
```

Notas importantes:

- `pnpm dev` levanta la app y el companion local que habilita Maia-3.
- La primera ejecución puede descargar e instalar dependencias locales de Maia-3, preparar `.runtime/maia3` y bajar el checkpoint necesario para jugar.
- Ese arranque inicial usa `setup-maia3.ps1` y puede requerir red; después, el juego y el análisis siguen funcionando localmente.
- El lanzador elige puertos locales libres y muestra la URL activa en consola.

## Maia-3 y Stockfish

El proyecto usa dos piezas distintas:

- **Maia-3 5M**: oponente local con estilo más humano, pensado para practicar partidas.
- **Stockfish local**: fuente de análisis pedagógico y respaldo cuando el companion de Maia-3 no está disponible.

En la práctica:

- Maia-3 decide las jugadas del rival cuando el companion local está listo.
- Stockfish aporta la evidencia técnica que usa el entrenador.
- Si Maia-3 no puede arrancar, la aplicación conserva un camino local con Stockfish como fallback.

## Arquitectura del monorepo

La estructura principal es:

- `apps/web`: interfaz React/Vite, PWA y composición visual.
- `packages/chess-core`: reglas, FEN, PGN y tipos de dominio.
- `packages/engine`: contrato UCI y ejecución del motor en Worker.
- `packages/coach`: evaluación pedagógica, pistas y mensajes estructurados.
- `tests/evals`: posiciones y partidas de referencia para validar el entrenador.
- `docs`: alcance, arquitectura, modelo pedagógico, calidad, roadmap y terceros.

Dependencias unidireccionales:

- `web -> coach -> engine`
- `web -> chess-core`
- `coach -> chess-core`
- `engine -> chess-core`

## Calidad y verificación

Comandos principales:

```powershell
pnpm typecheck
pnpm test
pnpm build
pnpm check
pnpm format:check
```

Comandos adicionales útiles:

```powershell
pnpm test:e2e
pnpm verify:training-content
pnpm build:pages
pnpm build:sites
```

## Estado del proyecto

Alfil Norte sigue en estado MVP. El foco actual es la experiencia de entrenamiento local, no un producto terminado para despliegue masivo.

Alcance ya cubierto a nivel de producto:

- tablero React/Vite interactivo y persistente;
- Stockfish WASM local como base de análisis;
- Maia-3 5M local como oponente mediante companion UCI separado;
- tests de dominio, motor, persistencia e interacción.

Fuera del MVP:

- multijugador en línea;
- rankings o antitrampas;
- sincronización obligatoria en la nube;
- LLM remoto o local para generar feedback;
- dependencias de red para jugar o analizar.

## Fuente de verdad

La documentación de referencia vive en:

- [docs/PRODUCT.md](docs/PRODUCT.md)
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- [docs/COACHING_MODEL.md](docs/COACHING_MODEL.md)
- [docs/QUALITY.md](docs/QUALITY.md)
- [docs/ROADMAP.md](docs/ROADMAP.md)
- [docs/DECISIONS.md](docs/DECISIONS.md)
- [docs/THIRD_PARTY.md](docs/THIRD_PARTY.md)

## Licencia

El repositorio no declara todavía un archivo `LICENSE`. Si se añade una licencia formal, conviene reflejarla aquí y en la documentación de terceros.
