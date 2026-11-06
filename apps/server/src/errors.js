// Errores de negocio con su código HTTP. El manejador global de Express responde
// `{ message }` con `status`; cualquier otro error se trata como interno (500).
// No llevan `code`: así `isPermanentSyncError` (db.js) los sigue tratando como definitivos.

export class AppError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = new.target.name;
    this.status = status;
  }
}

/** Datos inválidos o regla de negocio rechazada (400). */
export class ValidationError extends AppError {
  constructor(message) { super(message, 400); }
}

/** El rol del usuario no puede hacer ese cambio, aunque sí entre a la ruta (403). */
export class ForbiddenError extends AppError {
  constructor(message) { super(message, 403); }
}

/** El recurso pedido en la URL no existe (404). */
export class NotFoundError extends AppError {
  constructor(message) { super(message, 404); }
}

/** Choca con el estado actual: duplicado, versión vieja, recurso en uso (409). */
export class ConflictError extends AppError {
  constructor(message) { super(message, 409); }
}
