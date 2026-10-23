-- Una zona puede tener varias tarifas (por ejemplo, pista asfaltada y pista sin asfaltar);
-- cada puesto paga la de su categoría. Además, cada puesto guarda desde cuándo está asignado
-- y en qué zona y tarifa estuvo cada día, para no cobrar hacia atrás ni recalcular el pasado.

BEGIN;

CREATE TABLE categorias_cobro (
  id             SERIAL PRIMARY KEY,
  zona_id        INTEGER NOT NULL REFERENCES zonas(id) ON DELETE CASCADE,
  nombre         TEXT NOT NULL,
  predeterminada BOOLEAN NOT NULL DEFAULT FALSE,
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_categorias_cobro_nombre ON categorias_cobro (zona_id, lower(btrim(nombre)));
-- Una sola tarifa predeterminada por zona: la que toma un puesto si no se indica otra.
CREATE UNIQUE INDEX uq_categorias_cobro_predeterminada ON categorias_cobro (zona_id) WHERE predeterminada;

ALTER TABLE tarifas ADD COLUMN IF NOT EXISTS categoria_id INTEGER REFERENCES categorias_cobro(id);
CREATE INDEX IF NOT EXISTS idx_tarifas_categoria_vigencia ON tarifas(categoria_id, vigencia_inicio);

-- El monto único de S/ 5 por zona era de prueba: queda como historial y se reemplaza por
-- pista asfaltada S/ 3 (predeterminada) y pista sin asfaltar S/ 2 por día de feria.
UPDATE tarifas SET activo = FALSE WHERE rubro_id IS NULL AND zona_id IS NOT NULL AND categoria_id IS NULL;
INSERT INTO categorias_cobro (zona_id, nombre, predeterminada) SELECT id, 'Pista asfaltada', TRUE FROM zonas;
INSERT INTO categorias_cobro (zona_id, nombre, predeterminada) SELECT id, 'Pista sin asfaltar', FALSE FROM zonas;
INSERT INTO tarifas (rubro_id, zona_id, categoria_id, tipo_tarifa, monto_fijo, monto_variable, unidad_medida, vigencia_inicio)
SELECT NULL, c.zona_id, c.id, 'fija', CASE WHEN c.predeterminada THEN 3 ELSE 2 END, 0, 'dia_feria', '2026-01-01'
FROM categorias_cobro c;

-- Asignación de cada puesto en el tiempo: zona y tarifa vigentes de "desde" a "hasta" (abierto si es NULL).
CREATE TABLE puestos_historial (
  id            BIGSERIAL PRIMARY KEY,
  puesto_id     BIGINT NOT NULL REFERENCES puestos(id) ON DELETE CASCADE,
  zona_id       INTEGER NOT NULL REFERENCES zonas(id),
  categoria_id  INTEGER REFERENCES categorias_cobro(id),
  desde         DATE NOT NULL,
  hasta         DATE,
  registrado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (hasta IS NULL OR hasta >= desde)
);
CREATE INDEX idx_puestos_historial_puesto ON puestos_historial(puesto_id, desde);

-- Puestos existentes: asignados desde su primera asistencia registrada o, si no tienen,
-- desde la fecha de registro del comerciante; con la tarifa predeterminada de su zona.
INSERT INTO puestos_historial (puesto_id, zona_id, categoria_id, desde)
SELECT p.id, p.zona_id,
       (SELECT cc.id FROM categorias_cobro cc WHERE cc.zona_id = p.zona_id AND cc.predeterminada),
       COALESCE((SELECT min(a.fecha) FROM asistencias_feriales a WHERE a.puesto_id = p.id), c.creado_en::date)
FROM puestos p JOIN comerciantes c ON c.id = p.comerciante_id;

COMMIT;
