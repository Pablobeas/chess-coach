# Producto

## Lineas y variantes

La partida principal puede convivir con hasta cinco lineas locales organizadas como arbol. El historial permite navegar con flechas sobre la ruta activa, crear continuaciones al jugar desde posiciones pasadas y mostrar la rama principal y sus variantes de forma indentada. La exportacion, el resumen y las estadisticas siguen ancladas a la principal vigente hasta que una variante sea promovida.

## Problema

Jugar contra un motor tradicional dice poco sobre por quÃ© una jugada funciona.
Chess Coach debe convertir una partida de prÃ¡ctica en una conversaciÃ³n pedagÃ³gica
sin exigir una cuenta, conexiÃ³n o servicio de anÃ¡lisis remoto.

## Usuario inicial

Jugadores principiantes e intermedios, aproximadamente entre 600 y 1800 Elo, que
quieren practicar decisiones completas de partida y no solo tÃ¡cticas aisladas.

## Propuesta de valor

DespuÃ©s de cada jugada del usuario, la aplicaciÃ³n presenta feedback oportuno y
proporcional: confirma ideas buenas, detecta errores relevantes y ofrece una pista
progresiva cuando ayuda a aprender. El motor sigue siendo el oponente y la fuente
de evidencia; el entrenador interpreta esa evidencia.

## MVP

- Elegir color, Elo humano aproximado y nivel de ayuda.
- Jugar una partida legal contra Maia-3 local, manteniendo Stockfish para anÃ¡lisis.
- Ver siempre las piezas del usuario en la zona inferior del tablero, tambiÃ©n al
  jugar con negras, sin demoras artificiales despuÃ©s de que Maia elija su jugada.
- Pausar, reanudar, deshacer y abandonar.
- Feedback contextual tras la jugada con evidencia estructurada y texto breve.
- Voz cercana y serena, con consecuencia, mejor alternativa y lÃ³gica verificables.
- Historial analÃ­tico: evaluaciÃ³n de ambos bandos e icono de calidad solo del usuario.
- Pistas en tres niveles: objetivo, zona/pieza y movimiento.
- Opciones para flechas de sugerencia y barra de evaluaciÃ³n.
- Guardado local de partida y exportaciÃ³n PGN.
- RevisiÃ³n final con momentos crÃ­ticos.
- Interfaz mÃ³vil, accesible e instalable como PWA.

## Fuera del MVP

- Multijugador en lÃ­nea, rankings o antitrampas.
- Entrenadores humanos, marketplace o videollamadas.
- SincronizaciÃ³n obligatoria en la nube.
- ClonaciÃ³n visual o de personajes de Chess.com.
- Uso de LLM remoto o local para generar el feedback del MVP.
- Dependencias de red obligatorias para jugar, recibir feedback o revisar partidas.

## MÃ©tricas de producto

- Porcentaje de partidas iniciadas que llegan a 20 medias jugadas.
- Uso de pistas por nivel y repeticiÃ³n despuÃ©s de deshacer.
- Latencia p50/p95 del feedback en dispositivos objetivo.
- Coherencia del feedback en el conjunto de evaluaciones.
- Tasa de sesiones que terminan con PGN guardado o revisiÃ³n consultada.

## Criterios de confianza

El usuario debe poder distinguir siempre entre dato del motor, interpretaciÃ³n del
entrenador y consejo opcional. Nunca se mostrarÃ¡ un porcentaje sin una definiciÃ³n
visible y una calibraciÃ³n documentada.

La explicación visible debe ser compacta y concreta: decir qué pasó, por qué importa
y cuál es la mejor jugada, sin mostrar términos internos ni reutilizar la PV como
texto de interfaz.

## PolÃ­tica de servicios externos

Las APIs gratuitas se pueden evaluar para mejoras no esenciales, pero deben tener
fallback local, lÃ­mites y privacidad documentados. La partida, el anÃ¡lisis y el
feedback principal funcionan completamente sin red. No se enviarÃ¡n FEN, PGN ni datos
del usuario a terceros sin una funciÃ³n explÃ­cita y consentimiento informado.

## Experiencia actual

- En móvil, la interfaz de partida usa un shell fijo hasta 720 px, con safe areas,
  tablero protagonista, resumen compacto del entrenador y acciones agrupadas en un
  dock o menú.
- El feedback visible muestra primero un resumen breve y abre el detalle completo en
  un panel desplazable.
- En escritorio no se altera la composición actual.
