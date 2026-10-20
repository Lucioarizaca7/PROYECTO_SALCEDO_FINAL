#!/bin/sh
# Respaldo diario de PostgreSQL (servicio "backup" de docker-compose.prod.yml).
#
# Cada día a las 02:00 de Lima (07:00 UTC; Perú no cambia de hora) hace pg_dump en formato custom (-Fc)
# a /respaldos, borra los de más de BACKUP_RETENCION_DIAS (30 por omisión) y, si BACKUP_S3_BUCKET está
# definido, sube la copia a un almacenamiento S3 compatible (DigitalOcean Spaces, Linode, Backblaze…).
#
#   docker compose … run --rm backup ahora     respalda una vez y termina (para probar).
set -eu

RETENCION="${BACKUP_RETENCION_DIAS:-30}"
DESTINO=/respaldos
HORA_UTC="${BACKUP_HORA_UTC:-07}"
mkdir -p "$DESTINO"

if [ -n "${BACKUP_S3_BUCKET:-}" ] && ! command -v aws >/dev/null 2>&1; then
  echo "Instalando aws-cli para subir los respaldos a ${BACKUP_S3_BUCKET}…"
  apk add --no-cache aws-cli >/dev/null
fi

respaldar() {
  archivo="$DESTINO/sisrec-$(date -u +%Y%m%d-%H%M%S).dump"
  echo "$(date -u '+%F %T') UTC  respaldando en $archivo"
  PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -h "${PGHOST:-postgres}" -U sisrec -d sisrec -Fc -f "$archivo.parcial"
  mv "$archivo.parcial" "$archivo"
  echo "  listo: $(du -h "$archivo" | cut -f1)"

  if [ -n "${BACKUP_S3_BUCKET:-}" ]; then
    AWS_ACCESS_KEY_ID="$BACKUP_S3_ACCESS_KEY" AWS_SECRET_ACCESS_KEY="$BACKUP_S3_SECRET_KEY" \
      aws s3 cp "$archivo" "s3://${BACKUP_S3_BUCKET}/sisrec/$(basename "$archivo")" \
      ${BACKUP_S3_ENDPOINT:+--endpoint-url "$BACKUP_S3_ENDPOINT"} --only-show-errors
    echo "  subido a s3://${BACKUP_S3_BUCKET}/sisrec/"
    # La retención del bucket se configura en el propio bucket (regla de ciclo de vida de 30 días).
  fi

  find "$DESTINO" -name 'sisrec-*.dump' -mtime +"$RETENCION" -print -delete
}

if [ "${1:-}" = "ahora" ]; then
  respaldar
  exit 0
fi

echo "Respaldo diario programado a las ${HORA_UTC}:00 UTC (retención: ${RETENCION} días)."
while true; do
  ahora=$(date -u +%s)
  objetivo=$(date -u -d "$(date -u +%Y-%m-%d) ${HORA_UTC}:00:00" +%s 2>/dev/null || echo 0)
  [ "$objetivo" -le "$ahora" ] && objetivo=$((objetivo + 86400))
  sleep $((objetivo - ahora))
  respaldar || echo "ERROR: el respaldo falló; se reintenta mañana" >&2
done
