import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiClient, type Channel } from '../../api/rest';
import { SkeletonCard } from '../Skeleton';
import { useToast } from '../toast';
import { EmptyState, PageHead } from '../components/ui';
import { BroadcastIcon, ChevronRightIcon } from '../components/icons';

const SERVER = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:8080';

export default function Channels() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const nav = useNavigate();
  const api = new ApiClient(SERVER);
  const { toast } = useToast();

  useEffect(() => {
    if (!api.token) { nav('/auth'); return; }
    void init();
  }, []);

  async function init() {
    try {
      const me = await api.me();
      if (!me) { nav('/auth'); return; }
      await refresh();
    } catch {
      toast('error', 'Could not load channels. Check your connection.');
    } finally {
      setLoading(false);
    }
  }

  async function refresh() {
    setChannels(await api.listChannels());
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setCreating(true);
    try {
      await api.createChannel(trimmed);
      setName('');
      toast('success', `Channel “${trimmed}” is ready`);
      await refresh();
    } catch {
      toast('error', 'Could not create the channel.');
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="page page-form">
      <PageHead title="Channels" desc="Rooms for broadcasting to a group. Open one to go live or invite people." />

      <form className="panel" onSubmit={create} style={{ marginBottom: 'var(--sp-5)' }}>
        <div className="field">
          <label className="label" htmlFor="channel-name">Channel name</label>
          <div className="inline-form">
            <input id="channel-name" className="input" value={name} maxLength={80}
              onChange={(e) => setName(e.target.value)} placeholder="Movie night" autoComplete="off" />
            <button type="submit" className="btn btn-primary" disabled={!name.trim() || creating}>
              {creating ? 'Creating…' : 'Create channel'}
            </button>
          </div>
        </div>
      </form>

      {loading ? (
        <div className="stack-sm" aria-busy="true" aria-label="Loading channels">
          {[1, 2, 3].map((i) => <SkeletonCard key={i} />)}
        </div>
      ) : channels.length === 0 ? (
        <div className="panel">
          <EmptyState icon={<BroadcastIcon />} title="No channels yet"
            desc="Name your first channel above. You can invite people to it afterwards." />
        </div>
      ) : (
        <section className="panel panel-flush" aria-labelledby="your-channels">
          <div className="panel-head">
            <h2 className="panel-title" id="your-channels">Your channels <span className="count">{channels.length}</span></h2>
          </div>
          <ul className="list">
            {channels.map((c) => (
              <li key={c.id}>
                <Link to={`/channels/${c.id}`} className="list-row list-link">
                  <div className="avatar" aria-hidden="true">{(c.name[0] ?? '#').toUpperCase()}</div>
                  <div className="list-main">
                    <span className="list-title truncate">{c.name}</span>
                    <span className="list-meta"><span className={`badge badge-${c.role ?? 'member'}`}>{c.role ?? 'member'}</span></span>
                  </div>
                  <ChevronRightIcon className="chevron" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
