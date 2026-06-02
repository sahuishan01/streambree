FROM rust:1-bookworm AS build
WORKDIR /src
COPY . .
RUN cargo build --release -p stream_lover_server

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates libssl3 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /src/target/release/stream_lover_server /usr/local/bin/stream_lover_server
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/stream_lover_server"]
