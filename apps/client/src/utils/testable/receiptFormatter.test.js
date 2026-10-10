/**
 * Pruebas unitarias para las funciones de formato de recibos
 */

import { buildEscPosReceipt, normalizeLocalMerchant, buildExpressSuggestion } from './receiptFormatter';

describe('Receipt Formatter Utilities', () => {
  describe('buildEscPosReceipt', () => {
    it('should generate valid ESC/POS content for a complete receipt', () => {
      const receipt = {
        comprobante: 'B-0001',
        fecha: '2026-08-24T10:30:00',
        comerciante: 'María Quispe',
        concepto: 'Ocupación diaria',
        metodo_pago: 'Yape',
        monto: 5.00,
        hash_idempotencia: 'sha256:abc123def456'
      };

      const result = buildEscPosReceipt(receipt);

      // Verificar que contiene elementos esperados
      expect(result).toContain('MUNI C.P. SALCEDO');
      expect(result).toContain('RECIBO DE PAGO');
      expect(result).toContain('Nro: B-0001');
      expect(result).toContain('Fecha: 24/08/26, 10:30'); // Formato es-PE
      expect(result).toContain('Comerciante: María Quispe');
      expect(result).toContain('Concepto: Ocupación diaria');
      expect(result).toContain('Método: Yape');
      expect(result).toContain('Monto: S/ 5.00');
      expect(result).toContain('Hash: sha256:abc123def456');
      expect(result).toContain('Gracias por su contribución');

      // Verificar comandos ESC/POS
      expect(result).toStartWith('\x1B\x40'); // Inicializar impresora
      expect(result).toEndWith('\x1D\x56\x00'); // Cortar papel
    });

    it('should handle missing values gracefully', () => {
      const receipt = {}; // Objeto vacío

      const result = buildEscPosReceipt(receipt);

      // Verificar valores por defecto
      expect(result).toContain('Nro: N/A');
      expect(result).toContain('Comerciante: -');
      expect(result).toContain('Concepto: Liquidación de deuda');
      expect(result).toContain('Método: efectivo');
      expect(result).toContain('Monto: S/ 0.00');
      expect(result).toContain('Hash: N/A');
    });

    it('should format date correctly according to es-PE locale', () => {
      const receipt = {
        fecha: '2026-12-31T23:59:59',
        comprobante: 'TEST',
        comerciante: 'Test',
        concepto: 'Test',
        metodo_pago: 'efectivo',
        monto: 100,
        hash_idempotencia: 'test'
      };

      const result = buildEscPosReceipt(receipt);
      // En formato es-PE, la fecha debería ser dd/mm/aa
      expect(result).toContain('Fecha: 31/12/26, 23:59');
    });
  });

  describe('normalizeLocalMerchant', () => {
    it('should normalize a complete merchant object', () => {
      const merchant = {
        id: 123,
        nombre: 'Juan Pérez',
        dni_ruc: '12345678',
        rubro_id: 1,
        zona_id: 2,
        categoria: 'permanente',
        tipo_comerciante: 'permanente',
        estado: 'activo',
        fecha_registro: '2026-01-15',
        monto_tasa_diaria: 15.50,
        estado_pago_hoy: true
      };

      const result = normalizeLocalMerchant(merchant);

      expect(result.id).toBe('123');
      expect(result.numeroDocumento).toBe('12345678');
      expect(result.nombresRazonSocial).toBe('Juan Pérez');
      expect(result.puestoId).toBe('123');
      expect(result.codigoPuesto).toBe('S-123');
      expect(result.categoriaRubro).toBe('permanente');
      expect(result.montoTasaDiaria).toBe(15.5);
      expect(result.estadoPagoHoy).toBe(true);
      expect(result.updatedAt).toMatch(/\d{4}-\d{2}-\d{2}/); // Fecha ISO
      expect(result.zona).toBe(2);
      expect(result.estado).toBe('activo');
    });

    it('should handle missing or null values gracefully', () => {
      const merchant = {
        id: null,
        nombre: '',
        dni_ruc: null,
        rubro_id: null,
        zona_id: null
      };

      const result = normalizeLocalMerchant(merchant);

      expect(result.id).toBe('');
      expect(result.numeroDocumento).toBe('');
      expect(result.nombresRazonSocial).toBe('');
      expect(result.puestoId).toBe('');
      expect(result.codigoPuesto).toBe('S-'); // Padding de 3 ceros
      expect(result.categoriaRubro).toBe('general'); // Valor por defecto
      expect(result.montoTasaDiaria).toBe(0); // Valor por defecto
      expect(result.estadoPagoHoy).toBe(false); // Valor por defecto
      expect(result.zona).toBeNull();
      expect(result.estado).toBe('activo'); // Valor por defecto
    });

    it('should trim whitespace from string fields', () => {
      const merchant = {
        id: 1,
        nombre: '  María García  ',
        dni_ruc: '  87654321  ',
        rubro_id: 1,
        zona_id: 1,
        categoria: '  comercio  ',
        tipo_comerciante: 'permanente',
        estado: ' activo ',
        fecha_registro: '2026-01-01',
        monto_tasa_diaria: 20,
        estado_pago_hoy: false
      };

      const result = normalizeLocalMerchant(merchant);

      expect(result.nombresRazonSocial).toBe('María García');
      expect(result.numeroDocumento).toBe('87654321');
      expect(result.categoriaRubro).toBe('comercio');
      expect(result.estado).toBe('activo');
    });
  });

  describe('buildExpressSuggestion', () => {
    const baseMerchant = {
      id: 1,
      nombre: 'Test Merchant',
      categoria: 'permanente'
    };

    it('should return default suggestion when no history or latest payment', () => {
      const result = buildExpressSuggestion(baseMerchant, { saldo: 0 }, []);

      expect(result.suggestedAmount).toBe(0);
      expect(result.preferredMethod).toBe('efectivo');
      expect(result.lastLabel).toBe('Sin historial previo: el sistema no tiene cobros anteriores para este comerciante.');
      expect(result.lastPayment).toBeNull();
    });

    it('should return base amount when no history', () => {
      const result = buildExpressSuggestion(baseMerchant, { saldo: 45.50 }, []);

      expect(result.suggestedAmount).toBe(45.5);
      expect(result.preferredMethod).toBe('efectivo');
    });

    it('should suggest latest payment amount when no streak', () => {
      const history = [
        { monto: 10, fecha_cobro: '2026-08-20' },
        { monto: 20, fecha_cobro: '2026-08-22' }, // Diferente al anterior
        { monto: 15, fecha_cobro: '2026-08-23' }
      ];

      const result = buildExpressSuggestion(baseMerchant, { saldo: 0 }, history);

      // El último pago es 15, debería sugerir ese
      expect(result.suggestedAmount).toBe(15);
    });

    it('should suggest streaked amount when 3+ consecutive same payments', () => {
      const history = [
        { monto: 10, fecha_cobro: '2026-08-18', metodo_pago: 'efectivo' },
        { monto: 10, fecha_cobro: '2026-08-20', metodo_pago: 'Yape' }, // Diferente método
        { monto: 10, fecha_cobro: '2026-08-22', metodo_pago: 'efectivo' }, // Mismo monto
        { monto: 10, fecha_cobro: '2026-08-24', metodo_pago: 'efectivo' } // Tercer consecutivo
      ];

      const result = buildExpressSuggestion(baseMerchant, { saldo: 0 }, history);

      // Debería sugerir 10 por tener 3 pagos consecutivos del mismo monto
      expect(result.suggestedAmount).toBe(10);
      expect(result.preferredMethod).toBe('efectivo'); // Método del tercero
    });

    it('should suggest streaked method when 3+ consecutive same methods', () => {
      const history = [
        { monto: 15, fecha_cobro: '2026-08-18', metodo_pago: 'efectivo' },
        { monto: 20, fecha_cobro: '2026-08-20', metodo_pago: 'efectivo' }, // Mismo método
        { monto: 25, fecha_cobro: '2026-08-22', metodo_pago: 'efectivo' }, // Tercer consecutivo
        { monto: 30, fecha_cobro: '2026-08-24', metodo_pago: 'Yape' } // Diferente método
      ];

      const result = buildExpressSuggestion(baseMerchant, { saldo: 0 }, history);

      // Debería sugerir efectivo por tener 3 métodos consecutivos iguales
      expect(result.preferredMethod).toBe('efectivo');
      // La cantidad debería ser la del último en la racha (25)
      expect(result.suggestedAmount).toBe(25);
    });

    it('should calculate days difference correctly for last label', () => {
      const history = [
        { monto: 50, fecha_cobro: '2026-08-20', metodo_pago: 'efectivo' } // Hace 4 días desde 24/08
      ];

      // Simular fecha actual como 2026-08-24
      const result = buildExpressSuggestion(baseMerchant, { saldo: 0 }, history);

      expect(result.lastLabel).toContain('hace 4 días');
    });

    it('should handle today\'s payment correctly', () => {
      const history = [
        { monto: 30, fecha_cobro: '2026-08-24', metodo_pago: 'Yape' } // Hoy
      ];

      const result = buildExpressSuggestion(baseMerchant, { saldo: 0 }, history);

      expect(result.lastLabel).toContain('hoy');
    });

    it('should handle yesterday\'s payment correctly', () => {
      const history = [
        { monto: 25, fecha_cobro: '2026-08-23', metodo_pago: 'efectivo' } // Ayer
      ];

      const result = buildExpressSuggestion(baseMerchant, { saldo: 0 }, history);

      expect(result.lastLabel).toContain('ayer');
    });
  });
});