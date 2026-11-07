import { useEffect, useState, useRef } from 'react';
import { useToast } from '../toast';

interface FileEntry {
  name: string;
  is_dir: boolean;
  size: number;
  modified: string | null;
  extension: string;
}

const SERVER = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:8080';

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function getIcon(isDir: boolean, ext: string): { icon: string; bg: string; color: string } {
  if (isDir) return { icon: '📁', bg: 'rgba(234, 179, 8, 0.15)', color: '#eab308' };
  
  // Media / Audio
  if (['mp3', 'wav', 'flac', 'ogg', 'opus', 'm4a', 'aac'].includes(ext)) {
    return { icon: '🎵', bg: 'rgba(168, 85, 247, 0.15)', color: '#c084fc' };
  }
  // Video
  if (['mp4', 'mkv', 'webm', 'mov', 'avi'].includes(ext)) {
    return { icon: '🎬', bg: 'rgba(239, 68, 68, 0.15)', color: '#f87171' };
  }
  // Images
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'avif'].includes(ext)) {
    return { icon: '🖼️', bg: 'rgba(59, 130, 246, 0.15)', color: '#60a5fa' };
  }
  // Documents / Code
  if (['pdf', 'txt', 'md', 'json', 'yaml', 'yml', 'rs', 'ts', 'js'].includes(ext)) {
    return { icon: '📄', bg: 'rgba(34, 197, 94, 0.15)', color: '#4ade80' };
  }
  // Archives / Torrents
  if (['zip', 'tar', 'gz', '7z', 'rar', 'torrent'].includes(ext)) {
    return { icon: '📦', bg: 'rgba(249, 115, 22, 0.15)', color: '#fb923c' };
  }
  return { icon: '📎', bg: 'rgba(161, 161, 170, 0.15)', color: '#a1a1aa' };
}

export default function SharedFiles() {
  const [currentPath, setCurrentPath] = useState('');
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid');
  const [isUploading, setIsUploading] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [showNewFolderModal, setShowNewFolderModal] = useState(false);
  const [previewMedia, setPreviewMedia] = useState<{ url: string; type: 'video' | 'audio' | 'image' | 'text'; name: string } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  async function loadFiles(path = currentPath) {
    setLoading(true);
    try {
      const q = path ? `?path=${encodeURIComponent(path)}` : '';
      const res = await fetch(`${SERVER}/shared-files${q}`);
      if (!res.ok) throw new Error('Failed to load files');
      const data: FileEntry[] = await res.json();
      setFiles(data);
    } catch {
      toast('error', 'Could not load files from server');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadFiles(currentPath);
  }, [currentPath]);

  function navigateTo(folder: string) {
    const next = currentPath ? `${currentPath}/${folder}` : folder;
    setCurrentPath(next);
  }

  function navigateUp() {
    if (!currentPath) return;
    const parts = currentPath.split('/');
    parts.pop();
    setCurrentPath(parts.join('/'));
  }

  const breadcrumbs = currentPath.split('/').filter(Boolean);

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const uploadFiles = e.target.files;
    if (!uploadFiles || uploadFiles.length === 0) return;

    const form = new FormData();
    for (let i = 0; i < uploadFiles.length; i++) {
      form.append('files', uploadFiles[i]);
    }

    setIsUploading(true);
    try {
      const q = currentPath ? `?path=${encodeURIComponent(currentPath)}` : '';
      const res = await fetch(`${SERVER}/shared-files${q}`, {
        method: 'POST',
        body: form,
      });
      if (!res.ok) throw new Error('Upload failed');
      toast('success', `Uploaded ${uploadFiles.length} file(s)`);
      void loadFiles(currentPath);
    } catch {
      toast('error', 'File upload failed');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function handleCreateFolder(e: React.FormEvent) {
    e.preventDefault();
    if (!newFolderName.trim()) return;

    try {
      const res = await fetch(`${SERVER}/shared-files/mkdir`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: currentPath || undefined, name: newFolderName.trim() }),
      });
      if (!res.ok) {
        if (res.status === 409) throw new Error('Folder already exists');
        throw new Error('Create folder failed');
      }
      toast('success', `Created folder "${newFolderName.trim()}"`);
      setNewFolderName('');
      setShowNewFolderModal(false);
      void loadFiles(currentPath);
    } catch (err: any) {
      toast('error', err.message || 'Failed to create folder');
    }
  }

  async function handleDelete(name: string) {
    if (!confirm(`Are you sure you want to delete "${name}"?`)) return;
    const targetPath = currentPath ? `${currentPath}/${name}` : name;
    try {
      const res = await fetch(`${SERVER}/shared-files?path=${encodeURIComponent(targetPath)}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Delete failed');
      toast('success', `Deleted "${name}"`);
      void loadFiles(currentPath);
    } catch {
      toast('error', 'Could not delete item');
    }
  }

  function getDownloadUrl(item: FileEntry): string {
    const rel = currentPath ? `${currentPath}/${item.name}` : item.name;
    return `/shared/${encodeURIComponent(rel).replace(/%2F/g, '/')}`;
  }

  function handleItemClick(item: FileEntry) {
    if (item.is_dir) {
      navigateTo(item.name);
      return;
    }

    const ext = item.extension;
    const url = getDownloadUrl(item);

    if (['mp4', 'webm', 'mov'].includes(ext)) {
      setPreviewMedia({ url, type: 'video', name: item.name });
    } else if (['mp3', 'wav', 'ogg', 'flac'].includes(ext)) {
      setPreviewMedia({ url, type: 'audio', name: item.name });
    } else if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext)) {
      setPreviewMedia({ url, type: 'image', name: item.name });
    } else {
      window.open(url, '_blank');
    }
  }

  const filtered = files.filter((f) => f.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="page" style={{ maxWidth: 1100 }}>
      {/* Header bar */}
      <div className="row-spread page-header" style={{ alignItems: 'flex-start' }}>
        <div>
          <h2>Shared Storage</h2>
          <p className="page-subtitle">Access, stream, and manage torrent downloads & shared media</p>
        </div>

        <div style={{ display: 'flex', gap: '0.625rem', alignItems: 'center' }}>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setShowNewFolderModal(true)}
            title="Create new folder"
          >
            📁 New Folder
          </button>
          
          <button
            className="btn btn-primary btn-sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
          >
            {isUploading ? 'Uploading...' : '⬆ Upload Files'}
          </button>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileUpload}
            multiple
            style={{ display: 'none' }}
          />

          <a
            href="https://torrent.algosculptor.com"
            target="_blank"
            rel="noreferrer"
            className="btn btn-ghost btn-sm"
            title="Open qBittorrent web interface"
          >
            🧲 Torrent Client
          </a>
        </div>
      </div>

      {/* Navigation Toolbar */}
      <div className="card" style={{ padding: '0.75rem 1rem', marginBottom: '1.25rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' }}>
          {/* Breadcrumbs */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', fontSize: '0.875rem' }}>
            <button
              className="btn btn-ghost btn-sm"
              style={{ padding: '0.25rem 0.5rem', fontWeight: 600 }}
              onClick={() => setCurrentPath('')}
            >
              Root
            </button>
            {breadcrumbs.map((crumb, idx) => {
              const full = breadcrumbs.slice(0, idx + 1).join('/');
              return (
                <span key={full} style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                  <span style={{ color: 'var(--text-3)' }}>/</span>
                  <button
                    className="btn btn-ghost btn-sm"
                    style={{ padding: '0.25rem 0.5rem' }}
                    onClick={() => setCurrentPath(full)}
                  >
                    {crumb}
                  </button>
                </span>
              );
            })}
          </div>

          {/* Search & View Switcher */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <input
              type="text"
              className="input"
              style={{ padding: '0.35rem 0.75rem', fontSize: '0.8125rem', width: 180 }}
              placeholder="Search in folder..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div style={{ display: 'flex', background: 'var(--surface-2)', borderRadius: 'var(--r-sm)', padding: 2 }}>
              <button
                className={`btn btn-ghost btn-sm ${viewMode === 'grid' ? 'active' : ''}`}
                style={{ padding: '0.25rem 0.5rem' }}
                onClick={() => setViewMode('grid')}
                title="Grid view"
              >
                ⊞
              </button>
              <button
                className={`btn btn-ghost btn-sm ${viewMode === 'table' ? 'active' : ''}`}
                style={{ padding: '0.25rem 0.5rem' }}
                onClick={() => setViewMode('table')}
                title="List view"
              >
                ≡
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Main File Content Area */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '4rem 1rem', color: 'var(--text-3)' }}>
          Loading shared files...
        </div>
      ) : filtered.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '3.5rem 1rem' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>📂</div>
          <h3 style={{ marginBottom: '0.25rem' }}>No files found</h3>
          <p style={{ color: 'var(--text-2)', fontSize: '0.875rem', marginBottom: '1.25rem' }}>
            {search ? 'No files match your query.' : 'This folder is empty. Upload files or start a torrent download.'}
          </p>
          {currentPath && (
            <button className="btn btn-ghost btn-sm" onClick={navigateUp}>
              ← Back to parent folder
            </button>
          )}
        </div>
      ) : viewMode === 'grid' ? (
        /* Grid View */
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))',
          gap: '1rem'
        }}>
          {currentPath && (
            <div
              className="card"
              style={{
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                padding: '0.875rem',
                borderStyle: 'dashed',
              }}
              onClick={navigateUp}
            >
              <div style={{ fontSize: '1.5rem' }}>⬆</div>
              <div>
                <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>..</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-3)' }}>Parent folder</div>
              </div>
            </div>
          )}

          {filtered.map((item) => {
            const meta = getIcon(item.is_dir, item.extension);
            return (
              <div
                key={item.name}
                className="card"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  padding: '1rem',
                  cursor: 'pointer',
                  position: 'relative',
                  transition: 'transform 0.15s, border-color 0.15s',
                }}
                onClick={() => handleItemClick(item)}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                  <div style={{
                    width: 44,
                    height: 44,
                    borderRadius: 'var(--r)',
                    background: meta.bg,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '1.35rem'
                  }}>
                    {meta.icon}
                  </div>

                  <div style={{ display: 'flex', gap: '0.25rem' }} onClick={(e) => e.stopPropagation()}>
                    <a
                      href={getDownloadUrl(item)}
                      download={!item.is_dir}
                      className="btn btn-ghost btn-sm"
                      style={{ padding: '0.25rem 0.4rem', color: 'var(--text-3)' }}
                      title="Download"
                    >
                      ⬇
                    </a>
                    <button
                      className="btn btn-ghost btn-sm"
                      style={{ padding: '0.25rem 0.4rem', color: 'var(--error)' }}
                      onClick={() => handleDelete(item.name)}
                      title="Delete"
                    >
                      ✕
                    </button>
                  </div>
                </div>

                <div style={{
                  fontWeight: 600,
                  fontSize: '0.875rem',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  marginBottom: '0.25rem'
                }} title={item.name}>
                  {item.name}
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-3)', marginTop: 'auto' }}>
                  <span>{item.is_dir ? 'Folder' : formatSize(item.size)}</span>
                  <span>{formatDate(item.modified)}</span>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* Table View */
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.875rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-2)', background: 'var(--surface-2)' }}>
                <th style={{ padding: '0.75rem 1rem' }}>Name</th>
                <th style={{ padding: '0.75rem 1rem', width: 120 }}>Size</th>
                <th style={{ padding: '0.75rem 1rem', width: 160 }}>Last Modified</th>
                <th style={{ padding: '0.75rem 1rem', width: 100, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {currentPath && (
                <tr
                  style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
                  onClick={navigateUp}
                >
                  <td style={{ padding: '0.75rem 1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600 }}>
                    <span>⬆</span> .. (Parent directory)
                  </td>
                  <td style={{ padding: '0.75rem 1rem', color: 'var(--text-3)' }}>—</td>
                  <td style={{ padding: '0.75rem 1rem', color: 'var(--text-3)' }}>—</td>
                  <td style={{ padding: '0.75rem 1rem' }}></td>
                </tr>
              )}

              {filtered.map((item) => {
                const meta = getIcon(item.is_dir, item.extension);
                return (
                  <tr
                    key={item.name}
                    style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
                    onClick={() => handleItemClick(item)}
                  >
                    <td style={{ padding: '0.75rem 1rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
                        <span style={{ fontSize: '1.125rem' }}>{meta.icon}</span>
                        <span style={{ fontWeight: item.is_dir ? 600 : 400 }}>{item.name}</span>
                      </div>
                    </td>
                    <td style={{ padding: '0.75rem 1rem', color: 'var(--text-3)' }}>
                      {item.is_dir ? '—' : formatSize(item.size)}
                    </td>
                    <td style={{ padding: '0.75rem 1rem', color: 'var(--text-3)' }}>
                      {formatDate(item.modified)}
                    </td>
                    <td style={{ padding: '0.75rem 1rem', textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                      <div style={{ display: 'inline-flex', gap: '0.375rem' }}>
                        <a
                          href={getDownloadUrl(item)}
                          download={!item.is_dir}
                          className="btn btn-ghost btn-sm"
                          style={{ padding: '0.2rem 0.5rem' }}
                          title="Download"
                        >
                          ⬇
                        </a>
                        <button
                          className="btn btn-ghost btn-sm"
                          style={{ padding: '0.2rem 0.5rem', color: 'var(--error)' }}
                          onClick={() => handleDelete(item.name)}
                          title="Delete"
                        >
                          ✕
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* New Folder Modal */}
      {showNewFolderModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center',
          justifyContent: 'center', zIndex: 1000, padding: '1rem'
        }}>
          <div className="card" style={{ maxWidth: 400, width: '100%' }}>
            <div className="card-title" style={{ marginBottom: '0.5rem' }}>Create New Folder</div>
            <form onSubmit={handleCreateFolder}>
              <div className="field">
                <input
                  type="text"
                  className="input"
                  placeholder="Folder name"
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  autoFocus
                  required
                />
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setShowNewFolderModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={!newFolderName.trim()}
                >
                  Create
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Media Preview Modal */}
      {previewMedia && (
        <div
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.92)', display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', zIndex: 2000, padding: '1.5rem'
          }}
          onClick={() => setPreviewMedia(null)}
        >
          <div
            style={{ maxWidth: 900, width: '100%', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', color: '#fff' }}>
              <h3 style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{previewMedia.name}</h3>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <a href={previewMedia.url} download className="btn btn-primary btn-sm">Download</a>
                <button className="btn btn-ghost btn-sm" onClick={() => setPreviewMedia(null)}>✕ Close</button>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', background: '#000', borderRadius: 'var(--r)', overflow: 'hidden' }}>
              {previewMedia.type === 'video' && (
                <video src={previewMedia.url} controls autoPlay style={{ maxWidth: '100%', maxHeight: '75vh' }} />
              )}
              {previewMedia.type === 'audio' && (
                <div style={{ padding: '3rem', width: '100%', textAlign: 'center' }}>
                  <div style={{ fontSize: '4rem', marginBottom: '1.5rem' }}>🎵</div>
                  <audio src={previewMedia.url} controls autoPlay style={{ width: '100%' }} />
                </div>
              )}
              {previewMedia.type === 'image' && (
                <img src={previewMedia.url} alt={previewMedia.name} style={{ maxWidth: '100%', maxHeight: '75vh', objectFit: 'contain' }} />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
