# Reglas del motor

- El contrato público no debe depender de mensajes UCI sin procesar.
- Todo análisis lleva ID y admite cancelación; descarta respuestas obsoletas.
- Nunca bloquees el hilo principal ni ocultes errores de carga del WASM.
- Mantén centipeones y mate como unión discriminada.
- Usa adaptadores falsos en tests; los benchmarks con motor real son una suite aparte.
- No añadas un binario sin procedencia, hash y documentación de licencia.
