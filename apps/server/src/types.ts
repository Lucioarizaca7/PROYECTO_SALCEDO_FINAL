import { Request as ExpressRequest, Response as ExpressResponse, NextFunction as ExpressNextFunction } from 'express';

declare global {
  namespace Express {
    interface Request {
      user?: { id: number; email: string; rol: string };
      portal?: { comercianteId: number };
    }
  }
}

export interface AuthRequest extends ExpressRequest {
  user?: {
    id: number;
    email: string;
    rol: string;
  };
  // Sesión del portal del comerciante (carnet): solo lectura de sus propios datos.
  portal?: { comercianteId: number };
}

export type Request = AuthRequest;
export type Response = ExpressResponse;
export type NextFunction = ExpressNextFunction;
