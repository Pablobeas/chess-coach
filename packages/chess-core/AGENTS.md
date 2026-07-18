# Reglas de chess-core

- Este paquete es la única puerta de entrada a la librería de reglas.
- Tipos de dominio estables; no exportes objetos mutables de terceros sin envolver.
- Cada operación que recibe FEN o PGN debe validar y devolver errores útiles.
- Añade tests para enroque, promoción, jaque, mate, ahogado y repetición cuando
  implementes esas superficies.
- No importes motor, entrenador, React ni almacenamiento.
