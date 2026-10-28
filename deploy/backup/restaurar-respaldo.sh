#!/bin/sh
# Restauración de prueba: carga un respaldo en una base temporal (sisrec_restauracion), muestra cuántas
# filas tienen las tablas clave y la borra. No toca la base de producción. Hacerla al menos una vez al mes.
#
#   docker compose --env-file .env.production -f docker-compose.prod.yml run --rm backup \
#     sh /scripts/restaurar-respaldo.sh                    (el respaldo más reciente)
#   … sh /scripts/restaurar-respaldo.sh /respaldos/sisrec-20261207-070000.dump
set -eu

archivo="${1:-$(ls -1t /respaldos/sisrec-*.dump 2>/dev/null | head -n 1)}"
[ -n "$archivo" ] && [ -f "$archivo" ] || { echo "No hay respaldo para restaurar en /respaldos" >&2; exit 1; }

export PGPASSWORD="$POSTGRES_PASSWORD"
PSQL="psql -h ${PGHOST:-postgres} -U sisrec -v ON_ERROR_STOP=1"
TEMPORAL=sisrec_restauracion

echo "Restaurando $archivo en la base temporal $TEMPORAL…"
$PSQL -d postgres -c "DROP DATABASE IF EXISTS $TEMPORAL" >/dev/null
$PSQL -d postgres -c "CREATE DATABASE $TEMPORAL" >/dev/null
pg_restore -h "${PGHOST:-postgres}" -U sisrec -d "$TEMPORAL" --no-owner "$archivo"

echo "Filas en la copia restaurada:"
$PSQL -d "$TEMPORAL" -c "
  SELECT 'comerciantes' AS tabla, COUNT(*) FROM comerciantes
  UNION ALL SELECT 'puestos', COUNT(*) FROM puestos
  UNION ALL SELECT 'transacciones', COUNT(*) FROM transacciones
  UNION ALL SELECT 'comprobantes', COUNT(*) FROM comprobantes
  UNION ALL SELECT 'auditoria_logs', COUNT(*) FROM auditoria_logs
  UNION ALL SELECT 'último cobro: ' || COALESCE(to_char(MAX(fecha_cobro_cliente) AT TIME ZONE 'America/Lima', 'YYYY-MM-DD HH24:MI'), '—'), NULL FROM transacciones"

$PSQL -d postgres -c "DROP DATABASE $TEMPORAL" >/dev/null
echo "Restauración de prueba correcta; la base temporal se borró."
