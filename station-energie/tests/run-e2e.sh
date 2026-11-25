#!/bin/bash
# Starts a local Postgres with setup.sql, the fake Supabase server, then the browser test.
set -e
DIR=$(cd "$(dirname "$0")" && pwd)
PGDATA=/var/tmp/station-pgtest
BIN=/usr/lib/postgresql/16/bin
rm -rf "$PGDATA"; mkdir -p "$PGDATA"; chown postgres "$PGDATA"
su postgres -c "$BIN/initdb -D $PGDATA -A trust >/dev/null"
su postgres -c "$BIN/pg_ctl -D $PGDATA -o '-p 5433 -k /tmp' -l $PGDATA/log start >/dev/null"
psql -h /tmp -p 5433 -U postgres -q -c "create role anon nologin; create role authenticated nologin; grant usage on schema public to anon, authenticated;"
psql -h /tmp -p 5433 -U postgres -q -v ON_ERROR_STOP=1 -f "$DIR/../supabase/setup.sql" 2>&1 | grep -v NOTICE | grep -v wal_level | grep -v HINT || true
node "$DIR/fake-supabase.js" & SRV=$!
trap 'kill $SRV; su postgres -c "$BIN/pg_ctl -D $PGDATA stop -m fast >/dev/null"' EXIT
sleep 1
node "$DIR/e2e.js"
