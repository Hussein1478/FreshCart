#!/usr/bin/env bash
# Data Backup: nightly PostgreSQL dump, keeps 14 days.  Cron example: 0 2 * * * /path/to/scripts/backup.sh
set -euo pipefail
DIR="${BACKUP_DIR:-./backups}"; mkdir -p "$DIR"
PGPASSWORD="${DB_PASSWORD}" pg_dump -h "${DB_HOST:-localhost}" -U "${DB_USER:-grocer}" "${DB_NAME:-grocerydb}" | gzip > "$DIR/grocerydb_$(date +%F_%H%M).sql.gz"
find "$DIR" -name 'grocerydb_*.sql.gz' -mtime +14 -delete
echo "Backup complete in $DIR"
