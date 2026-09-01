#!/bin/sh
# Unraid/Portainer-friendly entrypoint: own /config as PUID:PGID, then drop root.
set -eu

: "${PUID:=99}"
: "${PGID:=100}"
: "${CONFIG_DIR:=/config}"
: "${UMASK:=022}"

umask "${UMASK}"
mkdir -p "${CONFIG_DIR}"

# Only chown when ownership is actually wrong - a recursive chown over a large
# appdata share on every boot is slow and pointless.
current="$(stat -c '%u:%g' "${CONFIG_DIR}")"
if [ "${current}" != "${PUID}:${PGID}" ]; then
  echo "[arrranger] chown ${CONFIG_DIR} ${current} -> ${PUID}:${PGID}"
  chown -R "${PUID}:${PGID}" "${CONFIG_DIR}"
fi

# Storage roots are reported, never chowned. A recursive chown across a media array is
# slow, destructive, and none of ArrRanger's business: the container simply has to run as
# a user that already has access, exactly like the *Arr containers do.
if [ -n "${FS_ROOTS:-}" ]; then
  echo "${FS_ROOTS}" | tr ':' '\n' | while IFS= read -r root; do
    [ -n "${root}" ] || continue

    if [ ! -d "${root}" ]; then
      echo "[arrranger] storage root ${root} is NOT MOUNTED - check the volume binding"
      continue
    fi

    owner="$(stat -c '%u:%g' "${root}")"
    mode="$(stat -c '%a' "${root}")"

    if su-exec "${PUID}:${PGID}" test -w "${root}"; then
      echo "[arrranger] storage root ${root} owner=${owner} mode=${mode} writable as ${PUID}:${PGID}"
    else
      echo "[arrranger] storage root ${root} owner=${owner} mode=${mode} NOT WRITABLE as ${PUID}:${PGID}"
      echo "[arrranger]   fix: match PUID/PGID to the owner above, or give that group write access"
    fi
  done
fi

# su-exec accepts numeric ids directly, so arbitrary PUID/PGID pairs work without
# creating a passwd entry for them.
echo "[arrranger] starting as ${PUID}:${PGID} (TZ=${TZ:-Etc/UTC})"
exec su-exec "${PUID}:${PGID}" "$@"
