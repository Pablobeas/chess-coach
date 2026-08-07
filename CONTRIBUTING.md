# Contribuir

Gracias por ayudar a mejorar `chess-coach`.

## Antes de abrir un cambio

- Lee `AGENTS.md` y respeta su alcance.
- Mantén el trabajo pequeño y alineado con TDD cuando toque reglas, contratos o
  persistencia.
- No mezcles cambios funcionales con actualizaciones masivas de dependencias.

## Flujo recomendado

1. Crea una rama de trabajo desde `main`.
2. Haz commits pequeños y coherentes.
3. Abre un pull request contra `main`.
4. No escribas directamente en `main`.

## Validación mínima

Ejecuta lo que corresponda al cambio. Comandos habituales del repositorio:

```powershell
pnpm typecheck
pnpm test
pnpm build
pnpm check
pnpm format:check
```

## Estilo de trabajo

- TypeScript estricto.
- Nombres y comentarios técnicos en inglés.
- Textos visibles y documentación en español por defecto.
- Capa de dominio pequeña y pura; efectos en adaptadores.

## Pull requests

Describe:

- Qué cambió.
- Qué validaste.
- Qué riesgos quedan.

Si el cambio afecta a la UI, añade capturas o evidencia equivalente.

## Seguridad

No abras issues públicos para vulnerabilidades. Usa `SECURITY.md` para el canal
privado.
