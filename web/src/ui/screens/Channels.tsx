import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiClient, type Channel } from '../../api/rest';
import { SkeletonCard } from '../Skeleton';

const SERVER = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:8080';

export default function Channels() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(true);
  const nav = useNavigate();
  const api = new ApiClient(SERVER);

  useEffect(() => {
    if (!api.token) { nav('/auth'); return; }
    void init();
  }, []);

  async function init() {
    const me = await api.me();
    if (!me) { nav('/auth'); return; }
    await refresh();
    setLoading(false);
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

      {loading ? (
        <div className="channel-grid">
          {[1, 2, 3].map((i) => <SkeletonCard key={i} />)}
        </div>
      ) : channels.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">📡</div>
          <div className="empty-state-title">No channels yet</div>
          <div className="empty-state-desc">Create one above to get started</div>
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
