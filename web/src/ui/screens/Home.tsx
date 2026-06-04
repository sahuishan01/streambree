import { Link, useNavigate } from 'react-router-dom';

export default function Home() {
  const navigate = useNavigate();
  const loggedIn = !!localStorage.getItem('sl_token');

  function logout() {
    localStorage.removeItem('sl_token');
    navigate('/auth');
  }

  return (
    <main>
      <h1>stream_lover</h1>
      <nav>
        <Link to="/send">Start streaming</Link>
        <Link to="/join">Join a stream</Link>
        <Link to="/channels">Channels</Link>
      </nav>
      {loggedIn
        ? <p>Logged in · <button onClick={logout}>Log out</button></p>
        : <p><Link to="/auth">Log in</Link></p>}
    </main>
  );
}
