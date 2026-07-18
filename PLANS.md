# Formato de planes de ejecución

Usa este formato para trabajos que duren más de una sesión, toquen varios paquetes
o requieran coordinación de subagentes. Guarda cada plan activo en `plans/`.

```markdown
# <resultado observable>

## Contexto

Estado actual, necesidad del usuario y restricciones.

## Criterios de aceptación

- Resultado verificable 1.
- Resultado verificable 2.

## Propiedad y coordinación

| Bloque | Agente | Archivos permitidos | Dependencias |
| ------ | ------ | ------------------- | ------------ |

## Pasos

- [ ] Paso con resultado observable.
- [ ] Validación del paquete.
- [ ] Revisión independiente.

## Decisiones

Decisiones tomadas durante la ejecución y su razón.

## Validación

Comandos, resultados y comprobaciones manuales.

## Estado final

Qué cambió, qué no cambió, riesgos y siguiente paso.
```
