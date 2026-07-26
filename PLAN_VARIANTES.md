# PLAN_VARIANTES

Fuente de verdad para la implementaciÃƒÂ³n del sistema de variantes mediante flechas y ÃƒÂ¡rbol de historial.

## Objetivo

Sustituir los modos de prueba actuales por una navegaciÃƒÂ³n natural de variantes desde el tablero, con:

- `Ã¢â€ Â` para retroceder por la ruta activa.
- `Ã¢â€ â€™` para avanzar por la ÃƒÂºltima ruta utilizada.
- creaciÃƒÂ³n automÃƒÂ¡tica de continuaciones al jugar desde el pasado.
- respuesta nueva del rival desde la posiciÃƒÂ³n histÃƒÂ³rica.
- ÃƒÂ¡rbol indentado de la lÃƒÂ­nea principal y sus variantes en el historial.

La implementaciÃƒÂ³n debe quedar lista para producciÃƒÂ³n, pero no debe desplegarse, publicarse, fusionarse ni enviarse al repositorio remoto sin aprobaciÃƒÂ³n explÃƒÂ­cita.

## Auditoria inicial verificada

- [x] Este archivo no existÃƒÂ­a y se crea ahora como fuente de progreso.
- [x] `SessionWorkspace` ya existe en `version: 6`.
- [x] La eliminaciÃƒÂ³n actual puede dejar descendientes huÃƒÂ©rfanos porque no reparenta ramas.
- [x] La promociÃƒÂ³n actual no reparenta correctamente a las demÃƒÂ¡s lÃƒÂ­neas.
- [x] Existe fencing asÃƒÂ­ncrono para anÃƒÂ¡lisis, pero algunos flujos antiguos siguen pasando por limpieza compartida incompleta.
- [x] No hay una suite Playwright comprometida para este flujo.
- [x] La UI antigua y la recuperaciÃƒÂ³n/dependencia visual asociada al modo de prueba siguen presentes.

## Hitos

- [x] 0. Auditoria inicial y mapa de diferencias verificadas
- [x] 1. Modelo de lineas, rutas y cursores
- [x] 2. Navegacion historica con flechas
- [x] 3. Creacion y fusion de continuaciones
- [x] 4. Integracion con Stockfish y cancelacion de resultados tardios
- [x] 5. Arbol visual del historial
- [x] 6. Promocion, poda y reparentado de variantes
- [x] 7. Persistencia y compatibilidad
- [x] 8. Eliminacion de la interfaz antigua
- [x] 9. Pruebas unitarias, integracion y Playwright
- [x] 10. Revision independiente final

## Requisitos funcionales inmutables

### Navegacion

- Retroceder no debe crear una variante.
- Retroceder no debe provocar automaticamente una respuesta del rival.
- El tablero historico solo sera jugable cuando corresponda al color del usuario.
- `activeLineId` debe recordar la ultima ruta recorrida.
- Cada linea debe mantener su propio cursor.
- Las flechas deben continuar siempre por la ultima ruta seleccionada.
- Seleccionar una jugada del historial debe cambiar la ruta activa.

### Creacion de variantes

- Jugar desde el pasado debe crear una continuacion automaticamente.
- Stockfish debe recalcular desde esa posicion incluso cuando la jugada del usuario coincida con una jugada ya almacenada.
- Si la jugada del usuario y la nueva respuesta del rival coinciden con una linea existente, ambas continuaciones deben fusionarse.
- Si la respuesta del rival es diferente, debe conservarse como variante independiente.

### Arbol de historial

- La principal y las variantes deben aparecer en su punto correcto de bifurcacion.
- Las variantes deben mostrarse indentadas.
- Cada jugada debe poder seleccionarse mediante toque, raton y teclado.
- El arbol debe seguir siendo utilizable en pantallas de 320 y 390 px.
- Cada variante debe conservar unicamente un menu contextual `...` para eliminarla.
- La eliminacion manual debe requerir confirmacion.

### Promocion

Una variante debe convertirse automaticamente en principal cuando:

- quede al menos dos plies por delante de la principal; o
- termine la partida.

Al promoverla:

- la principal anterior debe eliminarse;
- las ramas descendientes deben conservarse y reubicarse correctamente;
- no debe mantenerse una copia recuperable de la principal eliminada;
- PGN, resumen y estadisticas deben utilizar unicamente la nueva principal.

### Limite de variantes

- Debe existir un maximo de cinco variantes.
- Al crear una sexta, debe eliminarse automaticamente la variante mas antigua.
- La antiguedad se determina mediante el orden de creacion persistido.
- Sus variantes descendientes deben reparentarse utilizando su prefijo comun.
- No deben quedar referencias, cursores o lineas huerfanas.

### Analisis y concurrencia

- El analisis provisional y el feedback deben permanecer aislados por linea.
- Cambiar de ruta debe invalidar resultados que ya no correspondan a la ruta activa.
- Fusionar, eliminar, podar o promover una linea debe invalidar cualquier resultado tardio asociado.
- Una respuesta tardia de Stockfish o del generador de feedback nunca debe modificar una linea eliminada, fusionada o reemplazada.
- Los estados de carga y error deben permanecer asociados a su linea correspondiente.

### Persistencia

- Mantener `SessionWorkspace` v6.
- Conservar compatibilidad con las partidas guardadas existentes.
- Deben persistir correctamente:
  - lineas;
  - relaciones entre lineas;
  - orden de creacion;
  - cursores independientes;
  - `activeLineId`;
  - principal vigente.
- Una partida recargada debe continuar siendo navegable y jugable.
- PGN, estadisticas y resumen deben seguir utilizando unicamente la principal.

### Limpieza de interfaz

Eliminar completamente:

- `Continuar desde aqui`;
- `Probar otra jugada`;
- `Volver a principal`;
- `Pruebas (N)`;
- la barra de preparacion;
- la sugerencia de promocion;
- cualquier estado o logica que solo exista para los antiguos modos de prueba.

No deben quedar componentes, acciones, flags, textos, estilos o ramas muertas relacionadas con ese sistema.

### Accesibilidad

Anunciar discretamente mediante `role="status"`:

- creacion de una variante;
- fusion con una linea existente;
- eliminacion automatica;
- promocion a principal.

Los anuncios no deben interrumpir la navegacion ni duplicarse innecesariamente.

### Transiciones deterministas

Implementar y probar transiciones puras o deterministas para:

- crear una continuacion historica;
- seleccionar una linea;
- mover el cursor de una linea;
- fusionar continuaciones identicas;
- promover una variante;
- eliminar la principal anterior;
- podar la variante mas antigua;
- eliminar manualmente una variante;
- reparentar ramas mediante el prefijo comun;
- invalidar trabajos asincronos relacionados.

La logica debe centralizarse en dominio y no distribuirse entre componentes visuales.

## Plan de implementacion por hitos

### 1. Modelo de lineas, rutas y cursores

Objetivo:

- formalizar la estructura de lineas, forks, cursores y linea activa;
- mantener cursor independiente por linea;
- establecer los invariantes de identidad y revision;
- dejar preparada la seleccion de ruta activa.

Corte de progreso verificado:

- APIs deterministas ya cubren cursores por linea, seleccion, poda automatica por orden persistido, reparentado por prefijo comun, fusion de continuaciones identicas y distintas, primitiva de promocion automatica y fencing por revision.
- Verificacion reportada: 14 tests de dominio relacionados y `web tsc` pasaron.
- Riesgo restante: estas APIs aun no estan cableadas en `App`, persistencia ni UI.

Criterios de aceptacion:

- `activeLineId` persiste y cambia solo por seleccion explicita o promocion.
- Cada linea conserva su cursor independiente.
- La navegacion historica no crea variantes por si sola.
- Los estados derivados siguen siendo deterministas.

### 2. Navegacion historica con flechas

Objetivo:

- conectar `Ã¢â€ Â` y `Ã¢â€ â€™` con la ruta activa;
- permitir retroceso y avance por la ultima ruta seleccionada;
- bloquear la interaccion historica cuando no corresponda al color del usuario;
- evitar que retroceder dispare automaticamente al rival.

Criterios de aceptacion:

- `Ã¢â€ Â` retrocede por la ruta activa sin crear una linea nueva.
- `Ã¢â€ â€™` avanza por la ultima ruta usada.
- seleccionar una jugada del historial cambia la ruta activa.
- el tablero historico solo es jugable cuando corresponde.

### 3. Creacion y fusion de continuaciones

Objetivo:

- crear continuaciones automaticas al jugar desde el pasado;
- recalcular desde la posicion historica;
- fusionar ramas cuando la jugada y la respuesta del rival ya existen;
- conservar variantes independientes cuando la respuesta cambia.

Criterios de aceptacion:

- jugar desde un ply historico crea una continuacion nueva.
- una jugada repetida no evita el nuevo calculo del rival.
- continuaciones identicas se fusionan.
- respuestas distintas se conservan como variantes separadas.

### 4. Integracion con Stockfish y cancelacion de resultados tardios

Objetivo:

- aislar analisis provisional y feedback por linea;
- invalidar resultados tardios al cambiar de ruta, fusionar, eliminar, podar o promover;
- impedir que resultados viejos modifiquen lineas reemplazadas o eliminadas;
- conservar estados de carga y error por linea.

Criterios de aceptacion:

- las respuestas tardias se descartan de forma segura.
- la limpieza compartida no deja flujos activos obsoletos.
- el analisis sigue la linea activa correcta.

### 5. Arbol visual del historial

Objetivo:

- renderizar la principal y las variantes en el punto correcto de bifurcacion;
- mostrar la indentacion del arbol;
- soportar raton, toque y teclado;
- mantener la usabilidad en 320 px y 390 px.

Criterios de aceptacion:

- el historial refleja el arbol real.
- cada jugada es seleccionable por todos los modos de entrada.
- la vista sigue siendo utilizable en pantallas pequenas.

### 6. Promocion, poda y reparentado de variantes

Objetivo:

- promover automaticamente la variante que avance dos plies sobre la principal o termine la partida;
- eliminar la principal anterior al promover;
- reubicar descendientes de forma correcta;
- podar la variante mas antigua al superar el limite;
- reparentar por prefijo comun;
- evitar referencias huerfanas.

Criterios de aceptacion:

- la nueva principal es la unica base de PGN, resumen y estadisticas.
- no queda copia recuperable de la principal anterior.
- la sexta variante elimina la mas antigua.
- los descendientes conservan su estructura tras poda o promocion.

### 7. Persistencia y compatibilidad

Objetivo:

- mantener compatibilidad con partidas guardadas existentes;
- persistir lineas, relaciones, orden de creacion, cursores, `activeLineId` y principal vigente;
- asegurar que una partida recargada siga siendo navegable y jugable.

Criterios de aceptacion:

- la carga conserva el arbol y el estado activo.
- la recarga no rompe la navegacion historica.
- el formato v6 sigue siendo compatible.

### 8. Eliminacion de la interfaz antigua

Objetivo:

- retirar por completo la experiencia anterior de modos de prueba;
- eliminar textos, flags, estilos, acciones y ramas muertas.

Criterios de aceptacion:

- no quedan `Continuar desde aqui`, `Probar otra jugada`, `Volver a principal`, `Pruebas (N)`, barra de preparacion ni sugerencia de promocion.
- no quedan flujos de recuperacion o UI que solo sirvan al sistema antiguo.

### 9. Pruebas unitarias, integracion y Playwright

Objetivo:

- cubrir las transiciones deterministas y los casos de riesgo;
- actualizar pruebas que codifiquen el comportamiento antiguo;

Corte de progreso verificado:

- La capa de dominio, persistencia y frontend ya validan la navegacion por rutas, la fusion/poda/promocion y la invalidacion asincrona por linea.
- La suite web completa paso con 109 tests, incluidas las pruebas PWA en Node.
- El matrix Playwright completo paso en 320 px y 390 px.
- `pnpm check` paso sin fallos.
- E2E detecto un error de promocion: la variante promovida dejaba recuperable la principal anterior; se fijo eliminando la principal anterior al promover y reubicando sus descendientes antes de persistir el nuevo estado.
- anadir Playwright para el flujo completo en 320 px y 390 px.

Pruebas obligatorias a cubrir:

1. Retroceder sin crear variantes.
2. Retroceder sin activar al rival.
3. Bloqueo del tablero historico cuando no sea el turno del usuario.
4. Creacion de una nueva respuesta del motor desde una jugada historica repetida.
5. Fusion cuando jugada y respuesta son identicas.
6. Creacion de variante cuando la respuesta es distinta.
7. Continuidad de las flechas sobre la ultima ruta seleccionada.
8. Renderizado correcto del arbol y sus bifurcaciones.
9. Seleccion mediante teclado, raton y toque.
10. Promocion al superar por dos plies la principal.
11. Promocion al finalizar la partida.
12. Eliminacion de la principal anterior.
13. Poda de la sexta variante.
14. Conservacion y reparentado de descendientes.
15. Persistencia y recarga.
16. Coherencia del feedback por linea.
17. Invalidacion de respuestas tardias.
18. PGN, resumen y estadisticas basados solo en la principal.
19. Continuacion normal de la partida despues de recargar.

Playwright obligatorio:

1. Iniciar o cargar una partida.
2. Retroceder varias jugadas.
3. Crear varias variantes.
4. Navegar entre ellas desde el historial y con flechas.
5. Repetir una jugada para forzar un nuevo calculo.
6. Fusionar una continuacion identica.
7. Mantener una continuacion cuando la respuesta sea distinta.
8. Promover una variante.
9. Crear una sexta variante y comprobar la poda.
10. Recargar la aplicacion.
11. Verificar la ruta activa.
12. Continuar jugando normalmente.

Verificacion obligatoria:

- ejecutar todos los tests web relacionados;
- ejecutar la suite completa de tests web;
- ejecutar `pnpm check`;
- ejecutar las pruebas Playwright relevantes;
- ejecutar el build de produccion, si existe un comando definido para ello.

### 10. Revision independiente final

Objetivo:

- revisar el cumplimiento completo del plan sin sesgo de implementacion;
- detectar errores de navegacion, consistencia del arbol, invariantes, carreras, persistencia, accesibilidad, mobile y codigo antiguo residual;
- corregir hallazgos y volver a verificar.

Corte de revision final verificado:

- La revision independiente inicial devolvio `NEEDS_CHANGES` por un ciclo de hermanos, pausa historica y UI de historial muerta.
- Esos hallazgos quedaron corregidos.
- La validacion posterior en 320 px y 390 px paso, y `pnpm check` quedo verde.
- La revision final devolvio `APPROVED_WITH_CONTINUATION`, resuelta por la nueva regla de ignore para preservar `output/hosting/` sin reportarlo.

Criterios de aceptacion:

- un revisor independiente aprueba sin problemas criticos o importantes pendientes.
- no quedan regresiones conocidas.
- el plan puede considerarse terminado solo con pruebas y revision verde.

## Regla de avance

- Solo el hito de auditoria inicial puede marcarse como completado ahora.
- Todos los hitos de implementacion permanecen pendientes hasta que se verifiquen con pruebas y revision.
- Si la implementacion real diverge de este plan, primero se actualiza este archivo.
