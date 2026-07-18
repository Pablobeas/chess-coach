# Roadmap

## Fase 0 — Cimientos

- [x] Monorepo, configuración de Codex y agentes especializados.
- [x] Contratos de dominio, motor y entrenador.
- [x] Aplicación web mínima y tests iniciales.
- [x] Artefacto Stockfish/WASM registrado, versionado y documentado.

## Fase 1 — Partida local

- [x] Tablero accesible con movimientos legales.
- [x] Adaptador UCI real dentro de Web Worker validado en navegador.
- [x] Presets de fuerza, cancelación, fallback y protección contra resultados obsoletos.
- [x] Deshacer, pausar, abandonar, reiniciar y nueva partida.
- [x] Piezas SVG bicolor y bandejas de capturas.
- [x] Rastro persistente de origen/destino y última jugada tras deshacer.
- [ ] Reloj opcional.

## Fase 2 — Entrenador

- [x] Contrato de evidencia antes/después y pérdida esperada.
- [x] Clasificación determinista con tests.
- [ ] Evidencia real Stockfish y WDL normalizado en la UI.
- [x] Indicadores visuales de calidad asociados a las jugadas del usuario.
- [ ] Detectores tácticos y estratégicos verificables completos.
- [ ] Pistas progresivas 1/2/3, flechas, evaluación y amenazas.

## Fase 3 — Sesión y revisión

- [x] Persistencia local versionada y recuperación.
- [x] Exportación/importación PGN.
- [ ] Resumen final y momentos críticos.
- [x] Configuración de accesibilidad, sonido y nivel de ayuda.

## Fase 4 — Preparación pública

- [x] Base PWA instalable y service worker.
- [ ] E2E móvil/escritorio y perfil de rendimiento.
- [x] Layout responsive validado en viewport móvil y escritorio.
- [ ] Auditoría de privacidad, licencias y accesibilidad WCAG 2.2.
- [ ] Estrategia de actualización del Worker/WASM y beta sin telemetría.
