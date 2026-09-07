#!/bin/sh
set -e
/usr/local/bin/nasapi &
exec nginx -g 'daemon off;'
