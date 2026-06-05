import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiClient, type Channel } from '../../api/rest';

const SERVER = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:8080';

export default function Channels() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [name, setName] = useState('');
  const [isOwner, setIsOwner] = useState(false);
  const nav = useNavigate();
  const api = new ApiClient(SERVER);

  useEffect(() => {
    if (!api.token) { nav('/auth'); return; }
    void init();
  }, []);

  async function init() {
    const me = await api.me();
    if (!me) { nav('/auth'); return; }
    setIsOwner(me.is_owner);
    await refresh();
  }

  async function refresh() {
    setChannels(await api.listChannels());
  }

  async function create() {
    if (!name.trim()) return;
    await api.createChannel(name.trim());
    setName('');
    await refresh();
  }

  return (
    <div className="page">
      <div className="row-spread page-header">
        <div>
          <h2>Channels</h2>
          <p className="page-subtitle">Your broadcast rooms</p>
        </div>
        {isOwner && <Link to="/users" className="btn btn-ghost btn-sm">Manage users</Link>}
      </div>

      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div className="card-title">Create channel</div>
        <div className="form-row">
          <div className="field" style={{ flex: 1 }}>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)}
              placeholder="Channel name" onKeyDown={(e) => e.key === 'Enter' && create()} />
          </div>
          <button className="btn btn-primary" onClick={create} disabled={!name.trim()}>Create</button>
        </div>
      </div>

      {channels.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-2)' }}>
          <div style={{ fontSize: '2rem', marginBottom: '0.75rem' }}>📡</div>
          <div style={{ fontWeight: 600, marginBottom: '0.375rem' }}>No channels yet</div>
          <div style={{ fontSize: '0.875rem' }}>Create one above to get started</div>
        </div>
      ) : (
        <div className="channel-grid">
          {channels.map((c) => (
            <Link to={`/channels/${c.id}`} key={c.id} className="channel-card">
              <div className="channel-card-name">{c.name}</div>
              <div className="channel-card-meta">
                <span className={`badge badge-${c.role ?? 'member'}`}>{c.role}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
