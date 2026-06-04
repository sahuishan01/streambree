import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiClient, type Channel } from '../../api/rest';

const SERVER = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:8080';

export default function Channels() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [name, setName] = useState('');
  const api = new ApiClient(SERVER);

  async function refresh() {
    if (!api.token) return;
    setChannels(await api.listChannels());
  }
  useEffect(() => { void refresh(); }, []);

  async function create() {
    if (!name) return;
    await api.createChannel(name);
    setName('');
    await refresh();
  }

  return (
    <main>
      <h2>Channels</h2>
      <input aria-label="channel name" value={name} onChange={(e) => setName(e.target.value)} placeholder="New channel name" />
      <button onClick={create}>Create</button>
      <ul>
        {channels.map((c) => (
          <li key={c.id}>
            <Link to={`/channels/${c.id}`}>{c.name}</Link> — <small>{c.role}</small>
          </li>
        ))}
      </ul>
    </main>
  );
}
