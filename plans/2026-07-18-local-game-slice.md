# Primera feature vertical: partida local jugable

## Contexto

La base del monorepo ya compila, pero la web solo muestra estado del proyecto. Esta
feature valida el flujo completo con un motor simulado determinista antes de añadir
Stockfish/WASM.

## Criterios de aceptación

- La posición inicial se muestra como un tablero 8x8.
- El usuario puede seleccionar una pieza y realizar una jugada legal.
- Las jugadas ilegales no modifican la posición.
- Se muestra claramente el turno actual y el historial de movimientos.
- El motor simulado responde con una jugada legal determinista.
- Deshacer devuelve la sesión a la posición anterior y cancela el turno del motor.
- Reiniciar devuelve la partida a la posición inicial.
- Los estados de espera y error son visibles y accesibles.
- La interacción funciona con teclado y controles táctiles sin depender solo de color.

## Propiedad y coordinación

| Bloque                   | Agente             | Archivos permitidos                      | Dependencias            |
| ------------------------ | ------------------ | ---------------------------------------- | ----------------------- |
| Exploración              | `repo_explorer`    | Ninguno                                  | Ninguna                 |
| Dominio y motor simulado | `chess_engine`     | `packages/chess-core`, `packages/engine` | Contratos existentes    |
| Interfaz                 | `frontend_builder` | `apps/web`                               | Contratos existentes    |
| QA y fixtures            | `qa_evals`         | `tests/evals`                            | Criterios de aceptación |
| Integración y revisión   | Orquestador        | Archivos asignados tras recibir handoffs | Todos los bloques       |

## Metodología

- TDD para legalidad, turnos, historial, cancelación y contrato del motor.
- Implementación vertical de la experiencia, no capas aisladas sin flujo usable.
- Motor simulado únicamente para esta fase; Stockfish queda fuera del alcance.
- Revisión independiente después de integrar los bloques.

## Validación final

```powershell
pnpm check
pnpm format:check
```

Después se hará una comprobación manual de la UI en viewport móvil y escritorio.
