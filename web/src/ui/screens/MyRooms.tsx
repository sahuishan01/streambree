import { useEffect, useState } from 'react';
import { ApiClient, type Room } from '../../api/rest';

const SERVER = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:8080';

export default function MyRooms() {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [name, setName] = useState('');
  const api = new ApiClient(SERVER);

  async function refresh() {
    if (!api.token) return;
    setRooms(await api.listRooms());
  }
  useEffect(() => { void refresh(); }, []);

  async function create() {
    if (!name) return;
    await api.createNamedRoom(name);
    setName('');
    await refresh();
  }

  return (
    <main>
      <h2>My rooms</h2>
      <input aria-label="room name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Room name" />
      <button onClick={create}>Create</button>
      <ul>
        {rooms.map((r) => (
          <li key={r.id}>
            {r.name} — <code>{r.code}</code>
            <button onClick={async () => { await api.deleteRoom(r.id); await refresh(); }}>delete</button>
          </li>
        ))}
      </ul>
    </main>
  );
}
