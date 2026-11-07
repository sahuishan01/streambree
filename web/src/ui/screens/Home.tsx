import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BroadcastIcon, ScreenIcon } from '../components/icons';

const CODE_MIN = 4;

export default function Home() {
  const loggedIn = !!localStorage.getItem('sl_token');
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const codeReady = code.trim().length >= CODE_MIN;

  function join(e: React.FormEvent) {
    e.preventDefault();
    if (codeReady) navigate(`/join?code=${encodeURIComponent(code.trim())}`);
  }

  return (
    <div className="page">
      <div className="intro">
        <span className="eyebrow">Peer-to-peer · WebRTC</span>
        <h1>Stream between your devices.</h1>
        <p>
          Screen, camera or a local file goes straight from one device to another.
          The server only introduces them.
        </p>
      </div>

      <div className="launch">
        <section className="panel launch-card launch-card-accent" aria-labelledby="join-title">
          <div className="stack-sm">
            <h2 id="join-title">Join a stream</h2>
            <p>Got a room code from another device? Enter it to start watching.</p>
          </div>
          <form className="stack" onSubmit={join}>
            <div className="field">
              <label className="label" htmlFor="home-code">Room code</label>
              <input id="home-code" className="input input-code" value={code} maxLength={10}
                autoComplete="off" autoCapitalize="characters" spellCheck={false}
                placeholder="ABCDE FGHIJ"
                onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} />
            </div>
            <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={!codeReady}>
              Join
            </button>
          </form>
        </section>

        <div className="launch-side">
          <section className="panel launch-card" aria-labelledby="send-title">
            <div className="stack-sm">
              <h2 id="send-title" className="cluster"><ScreenIcon width={20} height={20} /> Start streaming</h2>
              <p>Share your screen, camera or a file to one other device using a room code.</p>
            </div>
            <div className="launch-foot">
              {loggedIn
                ? <Link to="/send" className="btn btn-secondary">Set up a stream</Link>
                : <Link to="/auth" className="btn btn-secondary">Sign in to stream</Link>}
            </div>
          </section>

          <section className="panel launch-card" aria-labelledby="bc-title">
            <div className="stack-sm">
              <h2 id="bc-title" className="cluster"><BroadcastIcon width={20} height={20} /> Broadcast to a channel</h2>
              <p>One sender, many viewers. Invite people to a channel and go live together.</p>
            </div>
            <div className="launch-foot">
              {loggedIn
                ? <Link to="/channels" className="btn btn-secondary">Open channels</Link>
                : <Link to="/auth" className="btn btn-secondary">Sign in for channels</Link>}
            </div>
          </section>
        </div>
      </div>

      <ul className="facts">
        <li><strong>Two modes</strong><span>Real-time for low delay, high quality for movies.</span></li>
        <li><strong>Works behind CGNAT</strong><span>Falls back to a TURN relay when a direct path is blocked.</span></li>
        <li><strong>Private by default</strong><span>Accounts are invite-only and channels have roles.</span></li>
      </ul>
    </div>
  );
}
