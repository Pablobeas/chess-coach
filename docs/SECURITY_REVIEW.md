# Security review

## Executive summary

Revisión puntual del estado actual del repositorio a fecha `2026-08-07`, limitada a la demo pública estática de GitHub Pages, el bridge local opcional de Maia-3 y los controles de publicación/licencia visibles en el código.

Conclusión corta:

- No aparecen hallazgos abiertos `Critical` o `High` dentro de la superficie runtime actual.
- Los controles principales para loopback, publicación y entradas locales están implementados y tienen evidencia en tests.
- Los residuales más relevantes son operativos/documentales: limitación estructural de CSP en GitHub Pages, cadena transitiva/licencia de Maia y la necesidad de revisar historial/visibilidad del repo público antes de ampliar difusión.

## Findings

### 1. Medium - `SC-MAIA-001` - Reproducibilidad portátil y licencia de pesos de Maia siguen abiertas

- Rule ID: `SC-MAIA-001`
- Ubicación: `tools/maia3-manifest.json:25-27`, `tools/setup-maia3.ps1:83-99`, `docs/THIRD_PARTY.md:42-59`, `README.md:91-98`
- Evidencia: el manifiesto declara `portableTransitiveLock: false`; el instalador advierte explícitamente que las dependencias transitivas siguen abiertas por upstream y solo registra `install-report.json` y `resolved-packages.json`; `docs/THIRD_PARTY.md` documenta además que la licencia de los pesos no está declarada de forma inequívoca.
- Impacto: no compromete la demo pública estática de Pages, pero sí limita la reproducibilidad fuerte del entorno local de Maia y hace insegura cualquier redistribución del entorno o checkpoint.
- Fix: si Maia pasa de mejora local a parte distribuida del producto, cerrar una cadena reproducible con lock portable por plataforma o vendorizar/verificar wheels, y obtener aclaración explícita de licencia para pesos.
- Mitigación / false positives: hoy el repo no redistribuye Maia ni el checkpoint; el riesgo queda acotado a instalación local del desarrollador.
- Status: `Accepted residual`

### 2. Medium - `WEB-PAGES-001` - GitHub Pages obliga a degradar la política anti-framing a meta CSP

- Rule ID: `WEB-PAGES-001`
- Ubicación: `apps/web/public/_headers:1-18`, `tools/publish-pages.mjs:14-29`, `tools/pwa-headers.test.mjs:31-37`, `tools/publish-pages.test.mjs:79-113`
- Evidencia: `_headers` incluye `frame-ancestors 'none'` y `X-Frame-Options: DENY`, pero la política meta inyectada para Pages omite `frame-ancestors`; el test lo afirma de forma explícita y comprueba que el meta CSP no pretende imponer cabeceras de framing.
- Impacto: en GitHub Pages la protección de clickjacking depende de lo que puede expresar un meta CSP, no del set completo de headers; la superficie pública sigue siendo reducida, pero el control no es equivalente al host con headers completos.
- Fix: mover la demo pública a un host que soporte headers HTTP completos si el producto necesita garantías más fuertes de anti-framing; mientras tanto, mantener la limitación documentada.
- Mitigación / false positives: la app no tiene auth, pagos ni cambios remotos de estado, lo que reduce el valor práctico de un escenario de clickjacking.
- Status: `Accepted residual`

### 3. Informational - `DOC-SEC-001` - La política de seguridad y reporte existe en la raíz del repositorio

- Rule ID: `DOC-SEC-001`
- Ubicación: `SECURITY.md:1-31`, `README.md:8`, `README.md:121`
- Evidencia: `SECURITY.md` existe en la raíz del repositorio, describe divulgación responsable y ofrece dos canales de reporte: email y GitHub Security Advisory privado. El README enlaza a esa ruta real.
- Impacto: mejora la claridad pública sobre reporte responsable y reduce ambigüedad operativa para disclosure.
- Fix: mantener `SECURITY.md` como fuente de verdad y conservar el enlace desde `README.md`.
- Mitigación / false positives: es un control documental y operativo; no cambia por sí solo los riesgos runtime ya descritos.
- Status: `Addressed`

### 4. Informational - `BRIDGE-LOOPBACK-001` - El bridge local de Maia está endurecido de forma coherente

- Rule ID: `BRIDGE-LOOPBACK-001`
- Ubicación: `tools/maia3-bridge.mjs:7-15`, `tools/maia3-bridge.mjs:110-160`, `tools/maia3-bridge.mjs:225-281`, `tools/maia3-bridge.mjs:462-607`, `apps/web/vite.config.ts:13-18`, `apps/web/src/viteProxy.test.mjs:61-126`
- Evidencia: bind a `127.0.0.1`; validación de `Host`; validación de `Origin` loopback y puertos permitidos; preflight limitado a `POST` + `content-type`; cuerpo máximo `64 KB`; validación estricta de FEN, UCI, historial y `multiPv`; control de cola con `429` y `Retry-After`; el proxy Vite usa `changeOrigin: true` para reescribir `Host` hacia el target del bridge mientras preserva el `Origin` del navegador, que el bridge sigue validando contra el puerto web permitido; la regresión en `apps/web/src/viteProxy.test.mjs` cubre tanto el caso permitido `127.0.0.1:5173` como el rechazo `403` para `127.0.0.1:5174`.
- Impacto: reduce de forma material la probabilidad de abuso cross-origin o de procesos locales oportunistas.
- Fix: mantener pruebas de regresión y conservar el bridge fuera de la demo pública.
- Mitigación / false positives: el control no protege frente a un host ya comprometido; ese escenario está fuera de alcance.
- Status: `Addressed`

### 5. Informational - `PUB-ALLOWLIST-001` - El publicador a Pages bloquea artefactos sensibles y tipos no previstos

- Rule ID: `PUB-ALLOWLIST-001`
- Ubicación: `tools/publish-pages.mjs:30-40`, `tools/publish-pages.mjs:110-118`, `tools/publish-pages.mjs:159-228`, `.github/workflows/publish-pages.yml:40-50`, `tools/publish-pages.test.mjs:49-158`
- Evidencia: denylist para `.git`, `.env`, `.runtime`, source maps, checkpoints, claves y secretos; allowlist cerrada de extensiones; validación obligatoria antes de `sync`; tests que rechazan `.map`, checkpoints, `.env.production`, `.pem` y binarios no soportados.
- Impacto: baja el riesgo operativo de filtrar material sensible al espejo público.
- Fix: conservar esta validación como requisito previo a cualquier cambio del workflow o del árbol publicado.
- Mitigación / false positives: no sustituye una revisión del historial Git previo ni de la configuración de visibilidad del repo público.
- Status: `Addressed`

### 6. Informational - `INPUT-LOCAL-001` - Las entradas locales tienen límites y los logs depuran sin filtrar FEN/PGN

- Rule ID: `INPUT-LOCAL-001`
- Ubicación: `apps/web/src/App.tsx:130-183`, `apps/web/src/App.tsx:206-245`, `apps/web/src/App.test.ts:82-115`
- Evidencia: límite PGN de `256 KB`, límite de `1_024` medias jugadas, parseo legal y función de redacción que sustituye FEN/PGN por `[redacted-position-data]` en `coachDebug`.
- Impacto: reduce presión de memoria en UI y evita exponer posiciones completas en logs de depuración.
- Fix: mantener estos límites si se añade import/export adicional o más telemetría local.
- Mitigación / false positives: no es protección contra un dispositivo ya comprometido; es endurecimiento de la app.
- Status: `Addressed`

### 7. Informational - `LIC-STOCKFISH-001` - Stockfish redistribuido conserva trazabilidad técnica suficiente

- Rule ID: `LIC-STOCKFISH-001`
- Ubicación: `docs/THIRD_PARTY.md:3-40`, `docs/STOCKFISH_SOURCE.md:20-109`, `docs/STOCKFISH_SOURCE.md:181-192`
- Evidencia: versión fija `stockfish@18.0.8`, `gitHead` upstream, hashes de JS/WASM/ASM, copia de licencia, snapshot local de fuente correspondiente y guía de verificación.
- Impacto: reduce riesgo de incumplimiento GPL y mejora auditabilidad de la demo pública.
- Fix: repetir este nivel de trazabilidad cada vez que cambie la versión o el binario redistribuido.
- Mitigación / false positives: en esta estación no se ejecutó rebuild completo con `emcc`/`make`; la evidencia es fuerte para procedencia y hashes, no para recompilación completa local.
- Status: `Addressed`

## Secretos, PII, licencia y dependencias

### Secretos

- No se observaron secretos embebidos en `apps/web` ni en el árbol de publicación previsto.
- El workflow usa `PAGES_DEPLOY_KEY` como secret de Actions y desactiva credenciales persistentes de `checkout` (`.github/workflows/publish-pages.yml:26-30`, `52-69`).
- El publicador bloquea `.env`, claves, `known_hosts`, `authorized_keys`, ficheros `credential|secret` y extensiones privadas (`tools/publish-pages.mjs:30-39`).

### PII

- No hay autenticación, perfiles, formularios remotos ni telemetría en la demo pública revisada.
- FEN/PGN se tratan como datos locales de sesión; el README y la arquitectura describen explícitamente la ruta offline/local (`README.md:73-82`, `docs/ARCHITECTURE.md:43-59`).
- Los logs de depuración del coach redaccionan FEN/PGN (`apps/web/src/App.tsx:214-217`).

### Licencia

- El proyecto declara `GPL-3.0-or-later` (`README.md:118`).
- Stockfish tiene postura de redistribución fuerte y documentada (`docs/THIRD_PARTY.md`, `docs/STOCKFISH_SOURCE.md`).
- Maia source está fijado y documentado como `AGPL-3.0`, pero la licencia de los pesos sigue sin aclaración inequívoca (`docs/THIRD_PARTY.md:42-59`).

### Dependencias

- El árbol JS del monorepo está bajo `pnpm-lock.yaml`.
- El workflow de publicación fija SHAs de `actions/checkout` y `actions/setup-node` (`.github/workflows/publish-pages.yml:27-35`).
- La parte Python de Maia no tiene lock portátil cerrado; el propio manifiesto lo declara (`tools/maia3-manifest.json:25-27`).

## Readiness conclusion

La demo pública estática es razonablemente apta para visibilidad de portfolio en su estado actual. No hay evidencia de una exposición runtime grave dentro del alcance revisado, y los controles del bridge local, del import local y del publicador son coherentes con el modelo offline-first del repositorio.

La decisión de publicación pública no debería condicionarse por el runtime actual, sino por dos verificaciones operativas externas al código:

1. que el historial completo del repositorio público no haya expuesto nunca secretos, artefactos privados ni contenido que deba permanecer privado;
2. que la visibilidad pública del espejo `chess-coach-play` y de GitHub Pages sea intencional y revisada por el mantenedor.

Si esas dos comprobaciones son satisfactorias, no veo un bloqueo técnico adicional para la demo estática actual. Si en el futuro se amplía el alcance a backend remoto, autenticación, telemetría o redistribución de Maia, esta revisión deja de ser suficiente y debe rehacerse.
