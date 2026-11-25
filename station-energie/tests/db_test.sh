#!/bin/bash
# Tests setup.sql against a local Postgres that imitates Supabase's roles.
set -e
PGDATA=${PGDATA:-/var/tmp/station-pgtest}
BIN=/usr/lib/postgresql/16/bin
DIR=$(cd "$(dirname "$0")" && pwd)
rm -rf "$PGDATA"; mkdir -p "$PGDATA"; chown postgres "$PGDATA"
su postgres -c "$BIN/initdb -D $PGDATA -A trust >/dev/null"
su postgres -c "$BIN/pg_ctl -D $PGDATA -o '-p 5433 -k /tmp' -l $PGDATA/log start >/dev/null"
trap 'su postgres -c "$BIN/pg_ctl -D $PGDATA stop -m fast >/dev/null"' EXIT
P="psql -h /tmp -p 5433 -U postgres -v ON_ERROR_STOP=1 -q"
$P -c "create role anon nologin; create role authenticated nologin; grant usage on schema public to anon, authenticated;"
$P -f "$DIR/../supabase/setup.sql"
echo "--- setup ran; running it a second time (must also work)"
$P -f "$DIR/../supabase/setup.sql"
$P -f "$DIR/db_test.sql"
echo "--- race: 6 parallel claims of group 3"
for i in 1 2 3 4 5 6; do
  $P -tA -c "set role anon; select claim_group(3, gen_random_uuid())->>'ok';" &
done | sort | uniq -c
wait
echo "ALL DB TESTS PASSED"
