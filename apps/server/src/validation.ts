/**
 * Middleware de validación de entrada para mejorar la seguridad
 * Utiliza validaciones básicas sin dependencias externas para mantener simplicidad
 */

import type { Request, Response, NextFunction } from 'express';
import { validationResult } from 'express-validator';
import { body, param } from 'express-validator';

// Validaciones comunes
export const validateEmail = body('email')
  .trim()
  .isEmail()
  .normalizeEmail()
  .withMessage('Email válido requerido');

export const validatePassword = body('password')
  .isLength({ min: 6, max: 255 })
  .withMessage('La contraseña debe tener entre 6 y 255 caracteres');

export const validateId = param('id')
  .isInt({ gt: 0 })
  .withMessage('ID debe ser un número entero positivo');

export const validateNombre = body('nombre')
  .trim()
  .isLength({ min: 2, max: 100 })
  .withMessage('Nombre debe tener entre 2 y 100 caracteres');

export const validateMonto = body('monto')
  .isFloat({ gt: 0 })
  .withMessage('Monto debe ser un número positivo');

// Middleware para manejar resultados de validación
export const handleValidationErrors = (req: Request, res: Response, next: NextFunction) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    // Convert to any to inspect the error structure
    const errorArray = errors.array() as any[];
    res.status(400).json({
      message: errorArray[0]?.msg || 'Datos inválidos',
      errors: errorArray.map(err => ({
        field: err.field || err.param || 'unknown',
        message: err.msg
      }))
    });
    return;
  }
  next();
};

// Validación para login
export const validateLogin = [
  validateEmail,
  validatePassword,
  handleValidationErrors
];

// Validación para registro de comerciante
export const validateComerciante = [
  validateNombre,
  body('dni_ruc')
    .trim()
    .isLength({ min: 8, max: 12 })
    .matches(/^[0-9]+$/)
    .withMessage('DNI/RUC debe contener solo números y tener entre 8 y 12 dígitos'),
  body('rubro_id')
    .isInt({ gt: 0 })
    .withMessage('Rubro ID debe ser un número entero positivo'),
  body('zona_id')
    .isInt({ gt: 0 })
    .withMessage('Zona ID debe ser un número entero positivo'),
  body('monto_tasa_diaria')
    .optional({ values: 'falsy' })
    .isFloat({ gt: 0 })
    .withMessage('Monto tasa diaria debe ser un número positivo'),
  handleValidationErrors
];

// Validación para pagos/cobros
export const validateCobro = [
  body('comerciante_id')
    .isInt({ gt: 0 })
    .withMessage('ID de comerciante debe ser un número entero positivo'),
  body('monto')
    .isFloat({ gt: 0 })
    .withMessage('Monto debe ser un número positivo'),
  body('metodo_pago')
    .customSanitizer((value) => String(value ?? '').trim().toLowerCase())
    .isIn(['efectivo', 'yape', 'plin', 'pos'])
    .withMessage('Método de pago no válido'),
  body('fecha_cobro')
    .optional({ values: 'falsy' })
    .isISO8601()
    .withMessage('Fecha de cobro debe ser una fecha válida'),
  handleValidationErrors
];