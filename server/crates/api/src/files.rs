use axum::extract::{Multipart, Query, State};
use axum::http::StatusCode;
use axum::Json;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tokio::fs;
use tokio::io::AsyncWriteExt;
use crate::AppState;

const SHARED_DIR: &str = "/srv/streambree/shared";

#[derive(Serialize)]
pub struct FileEntry {
    pub name: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified: Option<String>,
    pub extension: String,
}

#[derive(Deserialize)]
pub struct ListQuery {
    pub path: Option<String>,
}

#[derive(Deserialize)]
pub struct MkdirBody {
    pub path: Option<String>,
    pub name: String,
}

fn sanitize_path(base: &str, sub: Option<&str>) -> Result<PathBuf, StatusCode> {
    let base_path = PathBuf::from(base);
    let sub = sub.unwrap_or("").trim_matches('/');
    
    // Prevent traversal
    if sub.contains("..") {
        return Err(StatusCode::BAD_REQUEST);
    }
    
    let resolved = base_path.join(sub);
    if !resolved.starts_with(&base_path) {
        return Err(StatusCode::FORBIDDEN);
    }
    Ok(resolved)
}

pub async fn list_files(
    State(_state): State<AppState>,
    Query(query): Query<ListQuery>,
) -> Result<Json<Vec<FileEntry>>, StatusCode> {
    let dir = sanitize_path(SHARED_DIR, query.path.as_deref())?;
    if !dir.exists() {
        return Err(StatusCode::NOT_FOUND);
    }

    let mut entries = Vec::new();
    let mut reader = fs::read_dir(&dir).await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    while let Ok(Some(entry)) = reader.next_entry().await {
        let meta = entry.metadata().await.ok();
        let file_type = entry.file_type().await.ok();
        let is_dir = file_type.map(|t| t.is_dir()).unwrap_or(false);
        let name = entry.file_name().to_string_lossy().to_string();
        
        // Hide hidden files
        if name.starts_with('.') {
            continue;
        }

        let size = meta.as_ref().map(|m| m.len()).unwrap_or(0);
        let modified = meta.and_then(|m| m.modified().ok()).map(|time| {
            let dt: chrono::DateTime<chrono::Utc> = time.into();
            dt.to_rfc3339()
        });
        let extension = Path::new(&name)
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_lowercase();

        entries.push(FileEntry {
            name,
            is_dir,
            size,
            modified,
            extension,
        });
    }

    // Sort folders first, then alphabetically
    entries.sort_by(|a, b| {
        match (a.is_dir, b.is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        }
    });

    Ok(Json(entries))
}

pub async fn upload_file(
    State(_state): State<AppState>,
    Query(query): Query<ListQuery>,
    mut multipart: Multipart,
) -> Result<StatusCode, StatusCode> {
    let target_dir = sanitize_path(SHARED_DIR, query.path.as_deref())?;
    if !target_dir.exists() {
        fs::create_dir_all(&target_dir).await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    }

    while let Ok(Some(mut field)) = multipart.next_field().await {
        let filename = match field.file_name() {
            Some(name) => {
                let name = Path::new(name).file_name().and_then(|n| n.to_str()).unwrap_or("file");
                name.to_string()
            }
            None => continue,
        };

        if filename.is_empty() || filename.starts_with('.') {
            continue;
        }

        let file_path = target_dir.join(&filename);
        let mut file = fs::File::create(&file_path).await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

        while let Ok(Some(chunk)) = field.chunk().await {
            file.write_all(&chunk).await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        }
    }

    Ok(StatusCode::CREATED)
}

pub async fn create_folder(
    State(_state): State<AppState>,
    Json(body): Json<MkdirBody>,
) -> Result<StatusCode, StatusCode> {
    let name = body.name.trim();
    if name.is_empty() || name.contains('/') || name.contains('\\') || name.contains("..") {
        return Err(StatusCode::BAD_REQUEST);
    }

    let target_dir = sanitize_path(SHARED_DIR, body.path.as_deref())?;
    let new_folder = target_dir.join(name);
    
    if new_folder.exists() {
        return Err(StatusCode::CONFLICT);
    }

    fs::create_dir_all(&new_folder).await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(StatusCode::CREATED)
}

pub async fn delete_item(
    State(_state): State<AppState>,
    Query(query): Query<ListQuery>,
) -> Result<StatusCode, StatusCode> {
    let target = sanitize_path(SHARED_DIR, query.path.as_deref())?;
    if !target.exists() {
        return Err(StatusCode::NOT_FOUND);
    }
    
    // Never allow deleting the root shared directory
    if target == PathBuf::from(SHARED_DIR) {
        return Err(StatusCode::FORBIDDEN);
    }

    if target.is_dir() {
        fs::remove_dir_all(&target).await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    } else {
        fs::remove_file(&target).await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    }

    Ok(StatusCode::NO_CONTENT)
}
