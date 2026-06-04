import { Link } from 'react-router-dom';

export default function Home() {
  return (
    <main>
      <h1>stream_lover</h1>
      <nav>
        <Link to="/send">Start streaming</Link>
        <Link to="/join">Join a stream</Link>
        <Link to="/channels">Channels</Link>
      </nav>
      <p><Link to="/auth">Log in / Sign up</Link></p>
    </main>
  );
}
