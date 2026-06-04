import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ApiClient } from '../../api/rest';

const SERVER = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:8080';

export default function InviteAccept() {
  const { code = '' } = useParams();
  const nav = useNavigate();
  const api = new ApiClient(SERVER);
  const [name, setName] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const preview = await api.previewInvite(code);
        if (preview) setName(preview.name);
        else setError('This invite is no longer valid.');
      } catch {
        setError('This invite is no longer valid.');
      }
    })();
  }, [code]);

  async function join() {
    const res = await api.acceptInvite(code);
    if (res) nav(`/channels/${res.channel_id}`);
    else setError('This invite is no longer valid.');
  }

  return (
    <main>
      <h2>Join channel</h2>
      {error && <p role="alert">{error}</p>}
      {name && <><p>Join <strong>{name}</strong>?</p><button onClick={join}>Join</button></>}
    </main>
  );
}
