#!/bin/sh
set -e
# Respawn nasapi if it ever crashes, so a transient failure degrades to a
# brief window of 502s on home-drive writes (reads are unaffected — they
# never depend on nasapi) rather than a lasting outage. The loop runs in a
# subshell with errexit turned OFF: under `set -e` a non-zero exit from
# nasapi (e.g. SIGTERM → 143) would abort the loop itself instead of
# restarting the process.
(
  set +e
  while true; do
    /usr/local/bin/nasapi
    echo "nasapi exited with status $?, restarting in 1s" >&2
    sleep 1
  done
) &
exec nginx -g 'daemon off;'
