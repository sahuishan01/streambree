import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ApiClient } from '../../api/rest';
import { useToast } from '../toast';
import { EmptyState, Modal, PageHead } from '../components/ui';
import { themeMode, type ThemeId } from '../components/theme';
import {
  ArchiveIcon, ArrowUpIcon, CloseIcon, DocIcon, DownloadIcon, FileIcon, FilmIcon, FolderIcon,
  FolderPlusIcon, GridIcon, ImageIcon, ListIcon, MagnetIcon, MusicIcon, SearchIcon, TrashIcon, UploadIcon,
} from '../components/icons';

interface FileEntry {
  name: string;
  is_dir: boolean;
  size: number;
  modified: string | null;
  extension: string;
}

type ViewMode = 'grid' | 'table';
type FileKind = 'folder' | 'audio' | 'video' | 'image' | 'doc' | 'archive' | 'other';
type Preview = { url: string; type: 'video' | 'audio' | 'image'; name: string };

const SERVER = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:8080';
const VIEW_KEY = 'sl_files_view';

const sizeFmt = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
const dateFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${sizeFmt.format(bytes / Math.pow(1024, i))} ${units[i]}`;
}

function formatDate(iso: string | null): string {
  return iso ? dateFmt.format(new Date(iso)) : '—';
}

function kindOf(item: FileEntry): FileKind {
  if (item.is_dir) return 'folder';
  const ext = item.extension;
  if (['mp3', 'wav', 'flac', 'ogg', 'opus', 'm4a', 'aac'].includes(ext)) return 'audio';
  if (['mp4', 'mkv', 'webm', 'mov', 'avi'].includes(ext)) return 'video';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'avif'].includes(ext)) return 'image';
  if (['pdf', 'txt', 'md', 'json', 'yaml', 'yml', 'rs', 'ts', 'js'].includes(ext)) return 'doc';
  if (['zip', 'tar', 'gz', '7z', 'rar', 'torrent'].includes(ext)) return 'archive';
  return 'other';
}

const KIND_ICON: Record<FileKind, ReactNode> = {
  folder: <FolderIcon />, audio: <MusicIcon />, video: <FilmIcon />, image: <ImageIcon />,
  doc: <DocIcon />, archive: <ArchiveIcon />, other: <FileIcon />,
};

function FileGlyph({ item }: { item: FileEntry }) {
  const kind = kindOf(item);
  return <span className="file-icon" data-kind={kind} aria-hidden="true">{KIND_ICON[kind]}</span>;
}

function readView(): ViewMode {
  try { return localStorage.getItem(VIEW_KEY) === 'grid' ? 'grid' : 'table'; } catch { return 'table'; }
}

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const token = localStorage.getItem('sl_token');
  return token ? { ...extra, Authorization: `Bearer ${token}` } : extra;
}

export default function SharedFiles() {
  const [currentPath, setCurrentPath] = useState('');
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [isOwner, setIsOwner] = useState(false);
  const [search, setSearch] = useState('');
  const [viewMode, setViewModeState] = useState<ViewMode>(readView);
  const [isUploading, setIsUploading] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const api = new ApiClient(SERVER);

  useEffect(() => {
    void checkOwner();
    void loadFiles(currentPath);
    setSearch('');
  }, [currentPath]);

  useEffect(() => {
    if (!preview) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPreview(null); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [preview]);

  function setViewMode(mode: ViewMode) {
    setViewModeState(mode);
    try { localStorage.setItem(VIEW_KEY, mode); } catch { /* preference only */ }
  }

  async function checkOwner() {
    try {
      const me = await api.me();
      setIsOwner(Boolean(me?.is_owner));
    } catch {
      setIsOwner(false);
    }
  }

  async function loadFiles(path = currentPath) {
    setLoading(true);
    setLoadError(false);
    try {
      const q = path ? `?path=${encodeURIComponent(path)}` : '';
      const res = await fetch(`${SERVER}/shared-files${q}`);
      if (!res.ok) throw new Error('Failed to load files');
      const data: FileEntry[] = await res.json();
      data.sort((a, b) => Number(b.is_dir) - Number(a.is_dir) || a.name.localeCompare(b.name));
      setFiles(data);
    } catch {
      setFiles([]);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }

  function navigateTo(folder: string) {
    setCurrentPath(currentPath ? `${currentPath}/${folder}` : folder);
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
    for (let i = 0; i < uploadFiles.length; i++) form.append('files', uploadFiles[i]);

    setIsUploading(true);
    try {
      const q = currentPath ? `?path=${encodeURIComponent(currentPath)}` : '';
      const res = await fetch(`${SERVER}/shared-files${q}`, { method: 'POST', headers: authHeaders(), body: form });
      if (!res.ok) {
        if (res.status === 403) throw new Error('Only the owner can upload files.');
        throw new Error('Upload failed.');
      }
      toast('success', uploadFiles.length === 1 ? `Uploaded “${uploadFiles[0].name}”` : `Uploaded ${uploadFiles.length} files`);
      void loadFiles(currentPath);
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function handleCreateFolder(e: React.FormEvent) {
    e.preventDefault();
    const name = newFolderName.trim();
    if (!name) return;
    try {
      const res = await fetch(`${SERVER}/shared-files/mkdir`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ path: currentPath || undefined, name }),
      });
      if (!res.ok) {
        if (res.status === 403) throw new Error('Only the owner can create folders.');
        if (res.status === 409) throw new Error(`A folder named “${name}” already exists here.`);
        throw new Error('Could not create the folder.');
      }
      toast('success', `Created folder “${name}”`);
      setNewFolderName('');
      setShowNewFolder(false);
      void loadFiles(currentPath);
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Could not create the folder.');
    }
  }

  async function handleDelete(item: FileEntry) {
    const what = item.is_dir ? `the folder “${item.name}” and everything in it` : `“${item.name}”`;
    if (!confirm(`Delete ${what}? This cannot be undone.`)) return;
    const targetPath = currentPath ? `${currentPath}/${item.name}` : item.name;
    try {
      const res = await fetch(`${SERVER}/shared-files?path=${encodeURIComponent(targetPath)}`, {
        method: 'DELETE', headers: authHeaders(),
      });
      if (!res.ok) {
        if (res.status === 403) throw new Error('Only the owner can delete files.');
        throw new Error('Delete failed.');
      }
      toast('success', `Deleted “${item.name}”`);
      void loadFiles(currentPath);
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Could not delete the item.');
    }
  }

  function getDownloadUrl(item: FileEntry): string {
    const rel = currentPath ? `${currentPath}/${item.name}` : item.name;
    return `/raw-shared/${encodeURIComponent(rel).replace(/%2F/g, '/')}`;
  }

  function openItem(item: FileEntry) {
    if (item.is_dir) { navigateTo(item.name); return; }
    const ext = item.extension;
    const url = getDownloadUrl(item);
    if (['mp4', 'webm', 'mov'].includes(ext)) setPreview({ url, type: 'video', name: item.name });
    else if (['mp3', 'wav', 'ogg', 'flac'].includes(ext)) setPreview({ url, type: 'audio', name: item.name });
    else if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext)) setPreview({ url, type: 'image', name: item.name });
    else window.open(url, '_blank', 'noopener');
  }

  const query = search.trim().toLowerCase();
  const filtered = query ? files.filter((f) => f.name.toLowerCase().includes(query)) : files;
  const folderLabel = breadcrumbs[breadcrumbs.length - 1] ?? 'Shared';

  function itemActions(item: FileEntry) {
    return (
      <>
        {!item.is_dir && (
          <a href={getDownloadUrl(item)} download className="btn btn-quiet btn-icon"
            aria-label={`Download ${item.name}`} title="Download">
            <DownloadIcon />
          </a>
        )}
        {isOwner && (
          <button type="button" className="btn btn-quiet btn-icon" onClick={() => handleDelete(item)}
            aria-label={`Delete ${item.name}`} title="Delete" style={{ color: 'var(--danger)' }}>
            <TrashIcon />
          </button>
        )}
      </>
    );
  }

  let content: ReactNode;
  if (loading) {
    content = <div className="loading"><div className="spinner" aria-hidden="true" /> Loading files…</div>;
  } else if (loadError) {
    content = (
      <div className="panel">
        <EmptyState title="Couldn’t load this folder" desc="The file server didn’t respond. Check your connection and try again."
          action={<button type="button" className="btn btn-secondary" onClick={() => loadFiles(currentPath)}>Try again</button>} />
      </div>
    );
  } else if (filtered.length === 0) {
    content = (
      <div className="panel">
        <EmptyState icon={query ? <SearchIcon /> : <FolderIcon />}
          title={query ? `Nothing matches “${search.trim()}”` : 'This folder is empty'}
          desc={query ? 'Try a shorter name, or clear the search.' : isOwner ? 'Upload files or create a folder to fill it.' : 'Nothing has been shared here yet.'}
          action={query
            ? <button type="button" className="btn btn-secondary" onClick={() => setSearch('')}>Clear search</button>
            : currentPath ? <button type="button" className="btn btn-secondary" onClick={navigateUp}>Back to parent folder</button> : undefined} />
      </div>
    );
  } else if (viewMode === 'grid') {
    content = (
      <ul className="file-grid" aria-label={`Contents of ${folderLabel}`}>
        {filtered.map((item) => (
          <li key={item.name} className="file-tile">
            <button type="button" className="file-open" onClick={() => openItem(item)}
              aria-label={item.is_dir ? `Open folder ${item.name}` : `Open ${item.name}`}>
              <FileGlyph item={item} />
              <span className="file-name" title={item.name}>{item.name}</span>
              <span className="file-meta">
                <span>{item.is_dir ? 'Folder' : formatSize(item.size)}</span>
                <span>{formatDate(item.modified)}</span>
              </span>
            </button>
            <div className="file-tile-actions">{itemActions(item)}</div>
          </li>
        ))}
      </ul>
    );
  } else {
    content = (
      <div className="panel panel-flush">
        <table className="table">
          <caption className="visually-hidden">Contents of {folderLabel}</caption>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col" style={{ width: 110 }}>Size</th>
              <th scope="col" className="hide-sm" style={{ width: 170 }}>Modified</th>
              <th scope="col" style={{ width: 96 }}><span className="visually-hidden">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((item) => (
              <tr key={item.name}>
                <td>
                  <button type="button" className="row-open" onClick={() => openItem(item)} title={item.name}>
                    <FileGlyph item={item} />
                    <span className="truncate" style={{ fontWeight: item.is_dir ? 600 : 400 }}>{item.name}</span>
                  </button>
                </td>
                <td className="num">{item.is_dir ? '—' : formatSize(item.size)}</td>
                <td className="num hide-sm">{formatDate(item.modified)}</td>
                <td className="actions">{itemActions(item)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="page">
      <PageHead
        title="Files"
        desc="Shared media and downloads on this server. Open audio, video and images right here."
        actions={isOwner && (
          <>
            <a href="https://torrent.algosculptor.com" target="_blank" rel="noreferrer" className="btn btn-quiet btn-sm">
              <MagnetIcon /> Torrent client
            </a>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowNewFolder(true)}>
              <FolderPlusIcon /> New folder
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => fileInputRef.current?.click()} disabled={isUploading}>
              <UploadIcon /> {isUploading ? 'Uploading…' : 'Upload'}
            </button>
            <input type="file" ref={fileInputRef} onChange={handleFileUpload} multiple hidden />
          </>
        )}
      />

      <div className="toolbar">
        <nav aria-label="Folder path" style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', minWidth: 0 }}>
          {currentPath && (
            <button type="button" className="btn btn-quiet btn-icon" onClick={navigateUp} aria-label="Up one folder" title="Up one folder">
              <ArrowUpIcon />
            </button>
          )}
          <ol className="crumbs">
            <li>
              <button type="button" className="crumb" onClick={() => setCurrentPath('')}
                aria-current={breadcrumbs.length === 0 ? 'page' : undefined}>Shared</button>
            </li>
            {breadcrumbs.map((crumb, idx) => {
              const full = breadcrumbs.slice(0, idx + 1).join('/');
              const isLast = idx === breadcrumbs.length - 1;
              return (
                <li key={full}>
                  <button type="button" className="crumb" onClick={() => setCurrentPath(full)}
                    aria-current={isLast ? 'page' : undefined} title={crumb}>{crumb}</button>
                </li>
              );
            })}
          </ol>
        </nav>

        <div className="toolbar-right">
          <div className="search">
            <SearchIcon />
            <label className="visually-hidden" htmlFor="file-search">Search this folder</label>
            <input id="file-search" type="search" className="input input-sm" placeholder="Search this folder"
              value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="seg" role="group" aria-label="View">
            <button type="button" aria-pressed={viewMode === 'table'} onClick={() => setViewMode('table')} aria-label="List view" title="List view">
              <ListIcon />
            </button>
            <button type="button" aria-pressed={viewMode === 'grid'} onClick={() => setViewMode('grid')} aria-label="Grid view" title="Grid view">
              <GridIcon />
            </button>
          </div>
        </div>
      </div>

      {content}

      {showNewFolder && (
        <Modal title="New folder" desc={`Created inside “${folderLabel}”.`} onClose={() => setShowNewFolder(false)}>
          <form onSubmit={handleCreateFolder} className="stack">
            <div className="field">
              <label className="label" htmlFor="folder-name">Folder name</label>
              <input id="folder-name" type="text" className="input" value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)} autoFocus required autoComplete="off" />
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-quiet" onClick={() => setShowNewFolder(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={!newFolderName.trim()}>Create folder</button>
            </div>
          </form>
        </Modal>
      )}

      {preview && (
        // The lightbox is always dark so media reads well; light themes borrow the default dark palette.
        <div className="preview" role="dialog" aria-modal="true"
          data-theme={themeMode((document.documentElement.dataset.theme ?? 'breeze') as ThemeId) === 'light' ? 'breeze' : undefined} aria-label={`Preview of ${preview.name}`}
          onClick={() => setPreview(null)}>
          <div className="preview-inner" onClick={(e) => e.stopPropagation()}>
            <div className="preview-head">
              <h2 className="truncate">{preview.name}</h2>
              <div className="cluster" style={{ flexWrap: 'nowrap' }}>
                <a href={preview.url} download className="btn btn-secondary btn-sm"><DownloadIcon /> Download</a>
                <button type="button" className="btn btn-quiet btn-sm" onClick={() => setPreview(null)} autoFocus>
                  <CloseIcon /> Close
                </button>
              </div>
            </div>
            <div className="preview-body">
              {preview.type === 'video' && <video src={preview.url} controls autoPlay />}
              {preview.type === 'audio' && (
                <div className="preview-audio">
                  <span className="file-icon" data-kind="audio" style={{ width: 64, height: 64 }} aria-hidden="true"><MusicIcon /></span>
                  <audio src={preview.url} controls autoPlay />
                </div>
              )}
              {preview.type === 'image' && <img src={preview.url} alt={preview.name} />}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
