FROM node:20-bookworm-slim

WORKDIR /app

# Python runs the Garmin upload step: the maintained `garminconnect` library
# handles Garmin's Cloudflare WAF, MFA, and DI-token auth, and has no Node
# equivalent. Install it in a venv to avoid Debian's PEP-668
# externally-managed-environment restriction.
COPY python/requirements.txt ./python/requirements.txt
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-venv \
  && rm -rf /var/lib/apt/lists/* \
  && python3 -m venv /opt/garmin-venv \
  && /opt/garmin-venv/bin/pip install --no-cache-dir --upgrade pip \
  && /opt/garmin-venv/bin/pip install --no-cache-dir -r ./python/requirements.txt

# Dependencies first, for layer caching. `npm ci` installs exactly what's in the
# lockfile — the whole point of committing it. tsx (a devDependency) runs the
# TypeScript directly, so the full dependency set is needed at runtime.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
COPY python ./python
# The bundled movement map lives here. Without it, exercises upload as "Unknown".
COPY config ./config

ENV NODE_ENV=production
ENV DATA_DIR=/data
ENV PORT=8080

# Persistent state (sync log, movement cache, Garmin tokens) lives in /data.
# Mount a host directory or volume there — see docker-compose.yml.
#
# Runs as node (uid/gid 1000), not root. Only /data needs to be owned by that
# user: /app is read-only at runtime and world-readable already. (Don't be
# tempted to `chown -R` /app as well — recursing over node_modules adds minutes
# to every build for no benefit.)
#
# The mounted /data must be writable by uid 1000. `docker compose up` creates
# ./data with the right ownership; if you mount an existing directory, chown it:
#   sudo chown -R 1000:1000 ./data
# ts-tonal-client caches its movement catalog in a `.cache` directory resolved
# relative to the working directory — i.e. /app/.cache. Create it up front and
# give it to the runtime user, or every Tonal call dies with
# "EACCES: permission denied, mkdir '.cache'".
RUN mkdir -p /data /app/.cache && chown node:node /data /app/.cache

# tsx compiles on the fly and caches; keep that somewhere writable too.
ENV XDG_CACHE_HOME=/tmp/.cache

USER node

EXPOSE 8080
CMD ["npm", "start"]
