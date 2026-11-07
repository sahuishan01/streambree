import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ApiClient } from '../api/rest';
import ForceResetModal from './screens/ForceResetModal';

const SERVER = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:8080';

export default function Layout({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const nav = useNavigate();
  const loggedIn = !!localStorage.getItem('sl_token');
  const [menuOpen, setMenuOpen] = useState(false);
  const [mustReset, setMustReset] = useState(false);
  const api = new ApiClient(SERVER);

  useEffect(() => {
    if (loggedIn) {
      void checkMustReset();
    } else {
      setMustReset(false);
    }
  }, [loggedIn, pathname]);

  async function checkMustReset() {
    try {
      const me = await api.me();
      if (me?.must_change_password) {
        setMustReset(true);
      } else {
        setMustReset(false);
      }
    } catch {
      // ignore auth check error
    }
  }

  function logout() {
    localStorage.removeItem('sl_token');
    setMustReset(false);
    nav('/auth');
  }

  function closeMenu() { setMenuOpen(false); }

  return (
    <div className="app">
      <nav className="nav">
        <div className="nav-inner">
          <Link to="/" className="nav-brand" onClick={closeMenu}>
            Streambree<span className="nav-brand-dot" />
          </Link>
          <div className={`nav-links${menuOpen ? ' open' : ''}`}>
            {loggedIn && (
              <Link to="/channels" onClick={closeMenu}
                className={`nav-link${pathname.startsWith('/channels') ? ' active' : ''}`}>
                Channels
              </Link>
            )}
            {loggedIn && (
              <Link to="/send" onClick={closeMenu}
                className={`nav-link${pathname === '/send' ? ' active' : ''}`}>
                Send
              </Link>
            )}
            {loggedIn && (
              <Link to="/join" onClick={closeMenu}
                className={`nav-link${pathname === '/join' ? ' active' : ''}`}>
                Join
              </Link>
            )}
            <Link to="/shared-files" onClick={closeMenu}
              className={`nav-link${pathname === '/shared-files' ? ' active' : ''}`}>
              Shared Files
            </Link>
          </div>
          <button className="nav-hamburger" onClick={() => setMenuOpen((o) => !o)} aria-label={menuOpen ? 'Close menu' : 'Open menu'}>
            {menuOpen ? '✕' : '☰'}
          </button>
          <div className="nav-right">
            {loggedIn ? (
              <>
                <Link to="/profile" className={`btn btn-ghost btn-sm${pathname === '/profile' ? ' active' : ''}`}>
                  Profile
                </Link>
                <button className="btn btn-ghost btn-sm" onClick={logout}>Sign out</button>
              </>
            ) : (
              <Link to="/auth" className="btn btn-primary btn-sm">Sign in</Link>
            )}
          </div>
        </div>
      </nav>
      {mustReset && (
        <ForceResetModal
          api={api}
          onSuccess={() => {
            setMustReset(false);
          }}
        />
      )}
      {children}
    </div>
  );
}
