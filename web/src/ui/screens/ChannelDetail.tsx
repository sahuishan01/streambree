import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiClient, type Channel, type Member } from '../../api/rest';

function StreamingTimer() {
  const [elapsed, setElapsed] = useState('0:00');
  useEffect(() => {
    const t0 = Date.now();
    const id = setInterval(() => {
      const s = Math.floor((Date.now() - t0) / 1000);
      setElapsed(`${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`);
    }, 1000);
    return () => clearInterval(id);
  }, []);
  return <span className="timer">{elapsed}</span>;
}

const SERVER = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:8080';

export default function ChannelDetail() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const api = new ApiClient(SERVER);
  const [channel, setChannel] = useState<Channel | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [live, setLive] = useState(false);
  const [invite, setInvite] = useState('');
  const [addEmail, setAddEmail] = useState('');
  const [addMsg, setAddMsg] = useState('');

  async function refresh() {
    const [ch, mb, lv] = await Promise.all([
      api.getChannel(id), api.listMembers(id), api.streamStatus(id),
    ]);
    setChannel(ch); setMembers(mb); setLive(lv);
  }
  useEffect(() => { void refresh(); }, [id]);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    pollRef.current = setInterval(async () => {
      const lv = await api.streamStatus(id);
      setLive(lv);
    }, 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [id]);

  const myRole = channel?.role ?? 'member';
  const canModerate = myRole === 'owner' || myRole === 'admin';
  const isOwner = myRole === 'owner';
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const emailValid = addEmail.length === 0 || emailRegex.test(addEmail);

  async function makeInvite() { setInvite(await api.createInvite(id)); }
  async function remove() { if (!confirm(`Delete "${channel?.name}"?`)) return; await api.deleteChannel(id); nav('/channels'); }

  async function addUser() {
    setAddMsg('');
    if (!addEmail) return;
    const res = await api.addUser(id, addEmail);
    if (res.ok) { setAddEmail(''); setAddMsg(`${addEmail} added.`); await refresh(); }
    else if (res.status === 404) setAddMsg('No account with that email.');
    else if (res.status === 409) setAddMsg('Already a member.');
    else setAddMsg('Failed to add user.');
  }

  if (!channel) return (
    <div className="page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '40vh' }}>
      <div style={{ color: 'var(--text-2)' }}>Loading…</div>
    </div>
  );

  return (
    <div className="page">
      <div className="row-spread page-header">
        <div>
          <div className="row" style={{ marginBottom: '0.375rem' }}>
            <Link to="/channels" style={{ color: 'var(--text-2)', fontSize: '0.875rem' }}>← Channels</Link>
          </div>
          <div className="row">
            <h2>{channel.name}</h2>
            {live && <span className="chip chip-live"><span className="live-dot" />Live</span>}
            {live && (
              <span className="chip">
                <StreamingTimer />
              </span>
            )}
          </div>
          <div className="row" style={{ marginTop: '0.375rem' }}>
            <span className={`badge badge-${myRole}`}>{myRole}</span>
          </div>
        </div>
        <div className="row">
          {live
            ? <>
                <Link to={`/watch/${channel.code}`} className="btn btn-live">Watch live</Link>
                {canModerate && <button className="btn btn-danger btn-sm" onClick={() => api.stopStream(id).then(refresh)}>Stop</button>}
              </>
            : <Link to={`/golive/${channel.code}`} className="btn btn-primary">Go live</Link>}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: canModerate ? '1fr 1fr' : '1fr', gap: '1rem', marginBottom: '1.5rem' }}>
        {canModerate && (
          <div className="card">
            <div className="card-title">Invite link</div>
            <div className="row">
              <button className="btn btn-ghost btn-sm" onClick={makeInvite}>Generate</button>
            </div>
            {invite && <div className="code-block" style={{ marginTop: '0.75rem' }}>{`${location.origin}/invite/${invite}`}</div>}
          </div>
        )}
        {canModerate && (
          <div className="card">
            <div className="card-title">Add member by email</div>
            <div className="form-row">
              <input className={`input${addEmail.length > 0 && !emailValid ? ' input-error' : ''}`}
                value={addEmail} onChange={(e) => setAddEmail(e.target.value)}
                placeholder="user@example.com" type="email"
                onKeyDown={(e) => e.key === 'Enter' && emailValid && addUser()} />
              <button className="btn btn-primary btn-sm" onClick={addUser} disabled={!emailValid}>Add</button>
            </div>
            {addEmail.length > 0 && !emailValid && <div className="field-hint error">Enter a valid email address</div>}
            {addMsg && <div className={`alert ${addMsg.includes('added') ? 'alert-success' : 'alert-error'}`} style={{ marginTop: '0.625rem' }} role="alert">{addMsg}</div>}
          </div>
        )}
      </div>

      <div className="card">
        <div className="row-spread" style={{ marginBottom: '1rem' }}>
          <div className="card-title" style={{ margin: 0 }}>Members ({members.length})</div>
          {isOwner && <button className="btn btn-danger btn-sm" onClick={remove}>Delete channel</button>}
        </div>
        <div className="member-list">
          {members.map((m) => (
            <div key={m.user_id} className="member-row">
              <div className="member-avatar">{(m.email[0] ?? '?').toUpperCase()}</div>
              <div className="member-info">
                <div className="member-name">{m.email}</div>
                <div className="member-sub">
                  <span className={`badge badge-${m.role}`}>{m.role}</span>
                  {!m.can_stream && <span className="badge badge-blocked" style={{ marginLeft: '0.375rem' }}>blocked</span>}
                </div>
              </div>
              {canModerate && m.role !== 'owner' && (
                <div className="member-actions">
                  <button className="btn btn-ghost btn-sm"
                    onClick={() => api.setStreaming(id, m.user_id, !m.can_stream).then(refresh)}>
                    {m.can_stream ? 'Block' : 'Unblock'}
                  </button>
                  <button className="btn btn-danger btn-sm" onClick={() => api.removeMember(id, m.user_id).then(refresh)}>
                    Kick
                  </button>
                  {isOwner && (
                    <>
                      <button className="btn btn-ghost btn-sm"
                        onClick={() => api.changeRole(id, m.user_id, m.role === 'admin' ? 'member' : 'admin').then(refresh)}>
                        {m.role === 'admin' ? 'Demote' : 'Promote'}
                      </button>
                      <button className="btn btn-ghost btn-sm" onClick={() => api.transferOwner(id, m.user_id).then(refresh)}>
                        Make owner
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
