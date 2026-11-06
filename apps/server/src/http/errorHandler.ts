import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { AppError } from '../errors.js';

// Manejador global: Express 5 envía aquí los errores de las rutas async en lugar de tumbar el proceso.
// Los errores de negocio (AppError) llevan su código y un mensaje para el usuario; los de PostgreSQL
// se traducen a un mensaje genérico (el detalle técnico queda solo en el log).
const PG_ERRORS: Record<string, [number, string]> = {
  '23505': [409, 'El registro ya existe'],
  '23503': [400, 'El registro referenciado no existe o está en uso'],
  '23514': [400, 'Datos no válidos'],
  '22P02': [400, 'Datos no válidos']
};

export function errorHandler(error: any, req: Request, res: Response, _next: NextFunction) {
  let status = 500;
  let message = 'Error interno del servidor';
  if (error instanceof AppError) {
    status = (error as any).status;
    message = error.message;
  } else if (PG_ERRORS[error?.code]) {
    [status, message] = PG_ERRORS[error.code];
    console.warn(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} PostgreSQL ${error.code}: ${error.detail || error.message}`);
  } else if (error instanceof multer.MulterError) {
    status = 400;
    message = error.code === 'LIMIT_FILE_SIZE' ? 'El archivo supera el tamaño permitido' : 'No se pudo recibir el archivo';
  } else if (Number(error?.status) >= 400 && Number(error?.status) < 500) {
    // Errores del propio Express (JSON mal formado, cuerpo demasiado grande…).
    status = Number(error.status);
    message = status === 413 ? 'La petición es demasiado grande' : 'Petición inválida';
  }
  if (status >= 500) console.error(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`, error);
  if (res.headersSent) return;
  res.status(status).json({ message });
}
