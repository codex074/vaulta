#!/bin/sh
set -e
# Respawn nasapi if it ever crashes, so a transient failure degrades to a
# brief window of 502s on home-drive writes (reads are unaffected — they
# never depend on nasapi) rather than a lasting outage.
while true; do /usr/local/bin/nasapi; sleep 1; done &
exec nginx -g 'daemon off;'
