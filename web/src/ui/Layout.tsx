import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ApiClient } from '../api/rest';
import ForceResetModal from './screens/ForceResetModal';
import { CloseIcon, LogoMark, MenuIcon } from './components/icons';
import { ThemePicker } from './components/theme';

const SERVER = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:8080';

interface NavItem { to: string; label: string; match: (path: string) => boolean; authOnly?: boolean }

const NAV_ITEMS: NavItem[] = [
  { to: '/join', label: 'Join', match: (p) => p === '/join' || p.startsWith('/watch') },
  { to: '/send', label: 'Stream', match: (p) => p === '/send' || p.startsWith('/golive'), authOnly: true },
  { to: '/channels', label: 'Channels', match: (p) => p.startsWith('/channels'), authOnly: true },
  { to: '/shared-files', label: 'Files', match: (p) => p === '/shared-files' || p === '/shared' },
];

export default function Layout({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const nav = useNavigate();
  const loggedIn = !!localStorage.getItem('sl_token');
  const [menuOpen, setMenuOpen] = useState(false);
  const [mustReset, setMustReset] = useState(false);
  const api = new ApiClient(SERVER);

  useEffect(() => { setMenuOpen(false); }, [pathname]);

  useEffect(() => {
    if (!loggedIn) { setMustReset(false); return; }
    api.me()
      .then((me) => setMustReset(Boolean(me?.must_change_password)))
      .catch(() => { /* auth check is best-effort */ });
  }, [loggedIn, pathname]);

  function logout() {
    localStorage.removeItem('sl_token');
    setMustReset(false);
    nav('/auth');
  }

  const items = NAV_ITEMS.filter((i) => loggedIn || !i.authOnly);
  const accountActions = loggedIn ? (
    <>
      <Link to="/profile" className="btn btn-quiet btn-sm" aria-current={pathname === '/profile' ? 'page' : undefined}>
        Profile
      </Link>
      <button type="button" className="btn btn-secondary btn-sm" onClick={logout}>Sign out</button>
    </>
  ) : (
    <Link to="/auth" className="btn btn-primary btn-sm">Sign in</Link>
  );

  return (
    <div className="app">
      <a href="#main" className="skip-link">Skip to content</a>
      <header className="topbar">
        <div className="topbar-inner">
          <Link to="/" className="brand" aria-label="Streambree home">
            <LogoMark className="brand-mark" />
            Streambree
          </Link>

          <nav id="primary-nav" className={`nav${menuOpen ? ' is-open' : ''}`} aria-label="Primary">
            {items.map((item) => (
              <Link key={item.to} to={item.to} className="nav-link"
                aria-current={item.match(pathname) ? 'page' : undefined}>
                {item.label}
              </Link>
            ))}
            <div className="nav-account">{menuOpen && accountActions}</div>
          </nav>

          <div className="topbar-end">
            <ThemePicker />
            <div className="topbar-actions">{accountActions}</div>
            <button type="button" className="btn btn-quiet btn-icon menu-btn"
              aria-expanded={menuOpen} aria-controls="primary-nav"
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
              onClick={() => setMenuOpen((o) => !o)}>
              {menuOpen ? <CloseIcon width={20} height={20} /> : <MenuIcon width={20} height={20} />}
            </button>
          </div>
        </div>
      </header>

      {mustReset && <ForceResetModal api={api} onSuccess={() => setMustReset(false)} />}

      <main id="main" tabIndex={-1} style={{ outline: 'none', flex: 1, display: 'flex', flexDirection: 'column' }}>
        {children}
      </main>
    </div>
  );
}
