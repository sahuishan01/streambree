import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiClient, type Channel, type Member } from '../../api/rest';

const SERVER = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:8080';

export default function ChannelDetail() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const api = new ApiClient(SERVER);
  const [channel, setChannel] = useState<Channel | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [live, setLive] = useState(false);
  const [invite, setInvite] = useState('');

  async function refresh() {
    setChannel(await api.getChannel(id));
    setMembers(await api.listMembers(id));
    setLive(await api.streamStatus(id));
  }
  useEffect(() => { void refresh(); }, [id]);

  const myRole = channel?.role ?? 'member';
  const canModerate = myRole === 'owner' || myRole === 'admin';
  const isOwner = myRole === 'owner';

  async function makeInvite() { setInvite(await api.createInvite(id)); }
  async function remove() { await api.deleteChannel(id); nav('/channels'); }

  if (!channel) return <main><p>Loading…</p></main>;
  return (
    <main>
      <h2>{channel.name}</h2>
      <p>your role: {myRole}</p>

      {live
        ? <p>● Live now — <Link to={`/watch/${channel.code}`}>Watch</Link>
            {canModerate && <button onClick={() => api.stopStream(id).then(refresh)}>Stop stream</button>}</p>
        : <p><Link to={`/golive/${channel.code}`}>Go live</Link></p>}

      {canModerate && <p><button onClick={makeInvite}>Create invite link</button>
        {invite && <code>{`${location.origin}/invite/${invite}`}</code>}</p>}

      {isOwner && <p><button onClick={remove}>Delete channel</button></p>}

      <h3>Members ({members.length})</h3>
      <ul>
        {members.map((m) => (
          <li key={m.user_id}>
            {m.email} — {m.role}{!m.can_stream && ' (blocked)'}
            {canModerate && m.role !== 'owner' && (
              <>
                <button onClick={() => api.removeMember(id, m.user_id).then(refresh)}>kick</button>
                <button onClick={() => api.setStreaming(id, m.user_id, m.can_stream === false).then(refresh)}>
                  {m.can_stream === false ? 'unblock' : 'block'} streaming
                </button>
                {isOwner && (
                  <>
                    <button onClick={() => api.changeRole(id, m.user_id, m.role === 'admin' ? 'member' : 'admin').then(refresh)}>
                      {m.role === 'admin' ? 'demote' : 'promote'}
                    </button>
                    <button onClick={() => api.transferOwner(id, m.user_id).then(refresh)}>make owner</button>
                  </>
                )}
              </>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}
