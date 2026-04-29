# syntax=docker/dockerfile:1
#
# DumpVault image. Two stages:
#   1. Bun base — install deps and produce a static binary via `bun build --compile`.
#   2. Debian slim runtime — ship the binary with `pg_dump` and `mysqldump` on PATH.
#
# Built for linux/amd64 and linux/arm64 by .github/workflows/docker.yml.
# Each architecture builds natively via buildx, so the Bun-compiled binary
# matches the runtime arch without explicit --target flags.

FROM oven/bun:1.3 AS builder
WORKDIR /src
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun build src/cli.ts --compile --outfile=/dumpvault

FROM debian:bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       ca-certificates \
       postgresql-client \
       default-mysql-client \
  && rm -rf /var/lib/apt/lists/*

COPY --from=builder /dumpvault /usr/local/bin/dumpvault

RUN groupadd --system --gid 1000 dumpvault \
  && useradd --system --uid 1000 --gid dumpvault \
       --create-home --home-dir /var/lib/dumpvault dumpvault

USER dumpvault
WORKDIR /var/lib/dumpvault

# Default config path inside the container — mount your dumpvault.yaml here.
ENV DUMPVAULT_CONFIG=/etc/dumpvault/dumpvault.yaml

ENTRYPOINT ["/usr/local/bin/dumpvault"]
CMD ["--help"]
