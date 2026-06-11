FROM rust:1-bookworm AS build
WORKDIR /src

# ---- 1. Fetch dependencies (cached unless Cargo.lock/toml change) ----
COPY Cargo.toml Cargo.lock ./
COPY crates/turn/Cargo.toml    crates/turn/
COPY crates/auth/Cargo.toml    crates/auth/
COPY crates/store/Cargo.toml   crates/store/
COPY crates/signaling/Cargo.toml crates/signaling/
COPY crates/api/Cargo.toml     crates/api/
COPY bin/Cargo.toml            bin/
RUN mkdir -p crates/turn/src crates/auth/src crates/store/src \
             crates/signaling/src crates/api/src bin/src \
  && echo "pub fn dummy() {}" > crates/turn/src/lib.rs \
  && echo "pub fn dummy() {}" > crates/auth/src/lib.rs \
  && echo "pub fn dummy() {}" > crates/store/src/lib.rs \
  && echo "pub fn dummy() {}" > crates/signaling/src/lib.rs \
  && echo "pub fn dummy() {}" > crates/api/src/lib.rs \
  && echo "fn main() {}" > bin/src/main.rs \
  && cargo fetch 2>&1

# ---- 2. Build dependencies via dummy sources ----
# This layer is cached; only re-runs when Cargo.toml/lock files change.
RUN cargo build --release -p stream_lover_server 2>&1

# ---- 3. Overwrite with real source and force rebuild ----
COPY . .
RUN touch crates/*/src/* bin/src/* 2>/dev/null; \
    cargo build --release -p stream_lover_server 2>&1

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates libssl3 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /src/target/release/stream_lover_server /usr/local/bin/stream_lover_server
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/stream_lover_server"]
