# Producto

## Líneas de prueba

La partida principal puede convivir con hasta cinco líneas de prueba locales. Cada
prueba conserva historial, cursor, feedback y anotaciones, y no cambia la principal
hasta una promoción explícita. Las estadísticas, el resumen y la exportación usan la
principal hasta esa promoción.

## Problema

Jugar contra un motor tradicional dice poco sobre por qué una jugada funciona.
Chess Coach debe convertir una partida de práctica en una conversación pedagógica
sin exigir una cuenta, conexión o servicio de análisis remoto.

## Usuario inicial

Jugadores principiantes e intermedios, aproximadamente entre 600 y 1800 Elo, que
quieren practicar decisiones completas de partida y no solo tácticas aisladas.

## Propuesta de valor

Después de cada jugada del usuario, la aplicación presenta feedback oportuno y
proporcional: confirma ideas buenas, detecta errores relevantes y ofrece una pista
progresiva cuando ayuda a aprender. El motor sigue siendo el oponente y la fuente
de evidencia; el entrenador interpreta esa evidencia.

## MVP

- Elegir color, Elo humano aproximado y nivel de ayuda.
- Jugar una partida legal contra Maia-3 local, manteniendo Stockfish para análisis.
- Ver siempre las piezas del usuario en la zona inferior del tablero, también al
  jugar con negras, sin demoras artificiales después de que Maia elija su jugada.
- Pausar, reanudar, deshacer y abandonar.
- Feedback tras la jugada con evidencia estructurada.
- Voz cercana y serena, con consecuencia, mejor alternativa y lógica verificables.
- Historial analítico: evaluación de ambos bandos e icono de calidad solo del usuario.
- Pistas en tres niveles: objetivo, zona/pieza y movimiento.
- Opciones para flechas de sugerencia y barra de evaluación.
- Guardado local de partida y exportación PGN.
- Revisión final con momentos críticos.
- Interfaz móvil, accesible e instalable como PWA.

## Fuera del MVP

- Multijugador en línea, rankings o antitrampas.
- Entrenadores humanos, marketplace o videollamadas.
- Sincronización obligatoria en la nube.
- Clonación visual o de personajes de Chess.com.
- Uso de LLM remoto o local para generar el feedback del MVP.
- Dependencias de red obligatorias para jugar, recibir feedback o revisar partidas.

## Métricas de producto

- Porcentaje de partidas iniciadas que llegan a 20 medias jugadas.
- Uso de pistas por nivel y repetición después de deshacer.
- Latencia p50/p95 del feedback en dispositivos objetivo.
- Coherencia del feedback en el conjunto de evaluaciones.
- Tasa de sesiones que terminan con PGN guardado o revisión consultada.

## Criterios de confianza

El usuario debe poder distinguir siempre entre dato del motor, interpretación del
entrenador y consejo opcional. Nunca se mostrará un porcentaje sin una definición
visible y una calibración documentada.

## Política de servicios externos

Las APIs gratuitas se pueden evaluar para mejoras no esenciales, pero deben tener
fallback local, límites y privacidad documentados. La partida, el análisis y el
feedback principal funcionan completamente sin red. No se enviarán FEN, PGN ni datos
del usuario a terceros sin una función explícita y consentimiento informado.
