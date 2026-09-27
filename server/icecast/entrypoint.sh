#!/bin/sh
# Generates icecast.xml from the environment, then starts Icecast in the
# foreground as the current (non-root) user, logging to the container output.
set -eu

: "${ICECAST_SOURCE_PASSWORD:?ICECAST_SOURCE_PASSWORD must be set}"
: "${ICECAST_ADMIN_PASSWORD:?ICECAST_ADMIN_PASSWORD must be set}"

# Escapes a value for use inside XML text.
xml() {
  printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'
}

conf=/tmp/icecast.xml
cat > "$conf" <<XML
<icecast>
  <location>$(xml "${ICECAST_LOCATION:-Earth}")</location>
  <admin>$(xml "${ICECAST_ADMIN_EMAIL:-admin@localhost}")</admin>
  <hostname>$(xml "${ICECAST_HOSTNAME:-localhost}")</hostname>

  <limits>
    <clients>${ICECAST_MAX_LISTENERS:-500}</clients>
    <sources>2</sources>
    <queue-size>524288</queue-size>
    <client-timeout>30</client-timeout>
    <header-timeout>15</header-timeout>
    <source-timeout>10</source-timeout>
    <burst-on-connect>1</burst-on-connect>
    <burst-size>65536</burst-size>
  </limits>

  <authentication>
    <source-password>$(xml "$ICECAST_SOURCE_PASSWORD")</source-password>
    <admin-user>admin</admin-user>
    <admin-password>$(xml "$ICECAST_ADMIN_PASSWORD")</admin-password>
  </authentication>

  <listen-socket>
    <port>8000</port>
  </listen-socket>

  <fileserve>1</fileserve>

  <paths>
    <basedir>/usr/share/icecast</basedir>
    <webroot>/usr/share/icecast/web</webroot>
    <adminroot>/usr/share/icecast/admin</adminroot>
    <logdir>/dev</logdir>
    <pidfile>/tmp/icecast.pid</pidfile>
  </paths>

  <logging>
    <accesslog>stdout</accesslog>
    <errorlog>stderr</errorlog>
    <loglevel>${ICECAST_LOG_LEVEL:-3}</loglevel>
  </logging>
</icecast>
XML

exec icecast -c "$conf"
