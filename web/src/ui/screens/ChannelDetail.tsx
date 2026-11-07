import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiClient, type Channel, type Member } from '../../api/rest';
import { useToast } from '../toast';
import { SkeletonPage } from '../Skeleton';
import { Notice, PageHead } from '../components/ui';
import { CopyIcon } from '../components/icons';

const SERVER = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:8080';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function ChannelDetail() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const api = new ApiClient(SERVER);
  const { toast } = useToast();
  const [channel, setChannel] = useState<Channel | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [live, setLive] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [invite, setInvite] = useState('');
  const [addEmail, setAddEmail] = useState('');
  const [addMsg, setAddMsg] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  async function refresh() {
    try {
      const [ch, mb, lv] = await Promise.all([
        api.getChannel(id), api.listMembers(id), api.streamStatus(id),
      ]);
      setChannel(ch); setMembers(mb); setLive(lv);
    } catch {
      setLoadError(true);
    }
  }
  useEffect(() => { void refresh(); }, [id]);

  useEffect(() => {
    const poll = setInterval(() => {
      api.streamStatus(id).then(setLive).catch(() => { /* keep last known state */ });
    }, 3000);
    return () => clearInterval(poll);
  }, [id]);

  const myRole = channel?.role ?? 'member';
  const canModerate = myRole === 'owner' || myRole === 'admin';
  const isOwner = myRole === 'owner';
  const emailInvalid = addEmail.length > 0 && !EMAIL_RE.test(addEmail);
  const inviteUrl = invite ? `${location.origin}/invite/${invite}` : '';

  async function run(action: () => Promise<unknown>, failure: string) {
    try { await action(); await refresh(); }
    catch { toast('error', failure); }
  }

  async function makeInvite() {
    try { setInvite(await api.createInvite(id)); }
    catch { toast('error', 'Could not create an invite link.'); }
  }

  async function copyInvite() {
    try { await navigator.clipboard.writeText(inviteUrl); toast('success', 'Invite link copied'); }
    catch { toast('error', 'Could not copy. Select the link and copy it manually.'); }
  }

  async function removeChannel() {
    if (!confirm(`Delete “${channel?.name}” for everyone? This cannot be undone.`)) return;
    try { await api.deleteChannel(id); nav('/channels'); }
    catch { toast('error', 'Could not delete the channel.'); }
  }

  function stopStream() {
    if (!confirm('Stop the current broadcast for all viewers?')) return;
    void run(() => api.stopStream(id), 'Could not stop the stream.');
  }

  function kick(m: Member) {
    if (!confirm(`Remove ${m.email} from this channel?`)) return;
    void run(() => api.removeMember(id, m.user_id), 'Could not remove the member.');
  }

  function makeOwner(m: Member) {
    if (!confirm(`Make ${m.email} the owner? You will become an admin and lose owner rights.`)) return;
    void run(() => api.transferOwner(id, m.user_id), 'Could not transfer ownership.');
  }

  async function addUser(e: React.FormEvent) {
    e.preventDefault();
    setAddMsg(null);
    if (!addEmail || emailInvalid) return;
    const res = await api.addUser(id, addEmail);
    if (res.ok) { setAddMsg({ tone: 'success', text: `${addEmail} was added.` }); setAddEmail(''); await refresh(); }
    else if (res.status === 404) setAddMsg({ tone: 'error', text: 'No account uses that email. Ask the server owner to create one.' });
    else if (res.status === 409) setAddMsg({ tone: 'error', text: 'That person is already a member.' });
    else setAddMsg({ tone: 'error', text: 'Could not add that person.' });
  }

  if (loadError && !channel) return (
    <div className="page page-form">
      <PageHead title="Channel unavailable" back={{ to: '/channels', label: 'Channels' }}
        desc="It may have been deleted, or you are no longer a member." />
    </div>
  );
  if (!channel) return <SkeletonPage className="page" />;

  return (
    <div className="page">
      <PageHead
        back={{ to: '/channels', label: 'Channels' }}
        title={channel.name}
        actions={live ? (
          <>
            {canModerate && <button type="button" className="btn btn-danger" onClick={stopStream}>Stop stream</button>}
            <Link to={`/watch/${channel.code}`} className="btn btn-live">Watch live</Link>
          </>
        ) : (
          <Link to={`/golive/${channel.code}`} className="btn btn-primary">Go live</Link>
        )}>
        <div className="cluster">
          {live ? <span className="status status-live">Live now</span> : <span className="status">Offline</span>}
          <span className={`badge badge-${myRole}`}>you: {myRole}</span>
        </div>
      </PageHead>

      <div className={canModerate ? 'split' : ''}>
        <section className="panel panel-flush" aria-labelledby="members-title">
          <div className="panel-head">
            <h2 className="panel-title" id="members-title">Members <span className="count">{members.length}</span></h2>
            {isOwner && <button type="button" className="btn btn-danger btn-sm" onClick={removeChannel}>Delete channel</button>}
          </div>
          <ul className="list">
            {members.map((m) => (
              <li key={m.user_id} className="list-row">
                <div className="avatar" aria-hidden="true">{(m.email[0] ?? '?').toUpperCase()}</div>
                <div className="list-main">
                  <span className="list-title truncate" style={{ fontSize: 'var(--fs-md)' }} title={m.email}>{m.email}</span>
                  <span className="list-meta">
                    <span className={`badge badge-${m.role}`}>{m.role}</span>
                    {!m.can_stream && <span className="badge badge-blocked">can’t stream</span>}
                  </span>
                </div>
                {canModerate && m.role !== 'owner' && (
                  <div className="list-actions">
                    <button type="button" className="btn btn-quiet btn-sm"
                      onClick={() => run(() => api.setStreaming(id, m.user_id, !m.can_stream), 'Could not change streaming access.')}>
                      {m.can_stream ? 'Block streaming' : 'Allow streaming'}
                    </button>
                    {isOwner && (
                      <button type="button" className="btn btn-quiet btn-sm"
                        onClick={() => run(() => api.changeRole(id, m.user_id, m.role === 'admin' ? 'member' : 'admin'), 'Could not change the role.')}>
                        {m.role === 'admin' ? 'Make member' : 'Make admin'}
                      </button>
                    )}
                    {isOwner && (
                      <button type="button" className="btn btn-quiet btn-sm" onClick={() => makeOwner(m)}>Make owner</button>
                    )}
                    <button type="button" className="btn btn-danger btn-sm" onClick={() => kick(m)}>Remove</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>

        {canModerate && (
          <aside className="split-aside" aria-label="Channel tools">
            <section className="panel stack" aria-labelledby="invite-title">
              <div className="panel-head-text">
                <h2 className="panel-title" id="invite-title">Invite link</h2>
                <p className="panel-desc">Anyone with an account who opens it can join.</p>
              </div>
              {inviteUrl ? (
                <div className="stack-sm">
                  <label className="visually-hidden" htmlFor="invite-url">Invite link</label>
                  <input id="invite-url" className="input input-sm mono" readOnly value={inviteUrl}
                    onFocus={(e) => e.currentTarget.select()} />
                  <div className="cluster">
                    <button type="button" className="btn btn-primary btn-sm" onClick={copyInvite}><CopyIcon /> Copy link</button>
                    <button type="button" className="btn btn-quiet btn-sm" onClick={makeInvite}>New link</button>
                  </div>
                </div>
              ) : (
                <div><button type="button" className="btn btn-secondary btn-sm" onClick={makeInvite}>Create invite link</button></div>
              )}
            </section>

            <form className="panel stack" onSubmit={addUser} aria-labelledby="add-title" noValidate>
              <div className="panel-head-text">
                <h2 className="panel-title" id="add-title">Add by email</h2>
                <p className="panel-desc">For people who already have an account.</p>
              </div>
              <div className="field">
                <label className="visually-hidden" htmlFor="add-email">Email address</label>
                <div className="inline-form">
                  <input id="add-email" className="input input-sm" type="email" value={addEmail}
                    autoComplete="off" placeholder="name@example.com"
                    aria-invalid={emailInvalid || undefined} aria-describedby={emailInvalid ? 'add-email-err' : undefined}
                    onChange={(e) => { setAddEmail(e.target.value); setAddMsg(null); }} />
                  <button type="submit" className="btn btn-primary btn-sm" style={{ minHeight: 34 }}
                    disabled={!addEmail || emailInvalid}>Add</button>
                </div>
                {emailInvalid && <p id="add-email-err" className="hint hint-error">Enter a full email address.</p>}
              </div>
              {addMsg && <Notice tone={addMsg.tone}>{addMsg.text}</Notice>}
            </form>
          </aside>
        )}
      </div>
    </div>
  );
}
