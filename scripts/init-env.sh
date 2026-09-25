#!/usr/bin/env sh
# Generate a .env with freshly random secrets.
#
# NIDO_MASTER_KEY and JWT_SECRET have no defaults, on purpose: docker-compose
# uses ${VAR:?...} so a missing or blank value fails before the API starts
# rather than silently encrypting data with a key that is public in this repo.
# The flip side is that `cp .env.example .env` leaves both blank and compose
# still refuses to start -- this script fills them in for you.
#
# Refuses to overwrite an existing .env: NIDO_MASTER_KEY cannot be rotated
# once family databases exist, and clobbering it silently makes that data
# unreadable.

set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
env_file="$root/.env"
example="$root/.env.example"

if [ ! -f "$example" ]; then
    echo "init-env: cannot find $example" >&2
    exit 1
fi

if [ -e "$env_file" ]; then
    echo "init-env: $env_file already exists; refusing to overwrite." >&2
    echo "          If you are rotating JWT_SECRET only, edit that one line." >&2
    echo "          Rotating NIDO_MASTER_KEY makes existing data unreadable." >&2
    exit 1
fi

if ! command -v openssl >/dev/null 2>&1; then
    echo "init-env: openssl is required to generate secrets." >&2
    exit 1
fi

# 32 bytes -> 64 hex chars, which is what the API expects.
master=$(openssl rand -hex 32)
jwt=$(openssl rand -hex 32)

# umask before writing: .env holds the key that decrypts every family database.
umask 077
sed -e "s|^NIDO_MASTER_KEY=.*$|NIDO_MASTER_KEY=$master|" \
    -e "s|^JWT_SECRET=.*$|JWT_SECRET=$jwt|" \
    "$example" >"$env_file"

echo "init-env: wrote $env_file with fresh NIDO_MASTER_KEY and JWT_SECRET."
echo
echo "NIDO_MASTER_KEY encrypts every family's database and there is no"
echo "recovery path without it. Back it up off this machine before you"
echo "store anything real:"
echo
echo "    grep '^NIDO_MASTER_KEY=' $env_file"
