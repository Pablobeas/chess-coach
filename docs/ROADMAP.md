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
- [x] Navegación atrás/adelante con bloqueo al llegar a la última jugada.
- [x] Aviso visual y accesible para jaque y jaque mate.
- [ ] Reloj opcional.

## Fase 2 — Entrenador

- [x] Contrato de evidencia antes/después y pérdida esperada.
- [x] Clasificación determinista con tests.
- [x] Evidencia Stockfish y evaluación normalizada para jugadas del usuario.
- [ ] Extender la evaluación histórica a jugadas de Maia sin saturar la cola serial.
- [x] Indicadores visuales de calidad asociados a las jugadas del usuario.
- [x] Primera colección de detectores tácticos y estratégicos verificables.
- [x] Voz editorial determinista y feedback recuperable desde el historial.
- [x] Feedback contextual v3 con resumen compacto y detalle visible separado.
- [ ] Ampliar pistas progresivas 1/2/3, flechas y amenazas visuales.

## Fase 3 — Sesión y revisión

- [x] Revisión postpartida accesible, responsive y sin pedagogía por movimiento.

- [x] Persistencia local versionada y recuperación.
- [x] Exportación/importación PGN.
- [ ] Resumen final y momentos críticos.
- [x] Configuración de accesibilidad y nivel de ayuda.

## Fase 4 — Preparación pública (en progreso)

- [x] Base PWA instalable y service worker.
- [x] Espejo público privado→público automatizado con Pages y build:pages verificado.
- [ ] Drill de rollback trazable para el espejo público.
- [ ] E2E móvil/escritorio y perfil de rendimiento.
- [x] Layout responsive validado en viewport móvil y escritorio.
- [ ] Auditoría de privacidad, licencias y accesibilidad WCAG 2.2.
- [ ] Estrategia de actualización del Worker/WASM y beta sin telemetría.
