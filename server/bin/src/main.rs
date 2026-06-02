//! stream_lover server entrypoint: load config, wire crates, serve.
use anyhow::Context;
use api::{router, AppState};
use signaling::Hub;
use std::sync::Arc;
use store::Store;

fn env_or(key: &str, default: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| default.to_string())
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt::init();

    let database_url = env_or("DATABASE_URL", "sqlite:stream_lover.db?mode=rwc");
    let bind = env_or("BIND_ADDR", "0.0.0.0:8080");
    let jwt_secret = std::env::var("JWT_SECRET").context("JWT_SECRET must be set")?;
    let turn_secret = std::env::var("TURN_SECRET").context("TURN_SECRET must be set")?;
    let turn_url = env_or("TURN_URL", "turns:localhost:5349");
    let stun_url = env_or("STUN_URL", "stun:localhost:3478");
    let turn_ttl: u64 = env_or("TURN_TTL", "600").parse().unwrap_or(600);

    let store = Store::connect(&database_url).await?;
    store.migrate().await?;

    let state = AppState {
        store,
        hub: Hub::new(),
        jwt_secret: Arc::new(jwt_secret.into_bytes()),
        turn_secret: Arc::new(turn_secret),
        turn_url: Arc::new(turn_url),
        stun_url: Arc::new(stun_url),
        turn_ttl,
    };

    let app = router(state).layer(tower_http::trace::TraceLayer::new_for_http());

    let listener = tokio::net::TcpListener::bind(&bind).await?;
    tracing::info!("stream_lover server listening on {bind}");
    axum::serve(listener, app).await?;
    Ok(())
}
