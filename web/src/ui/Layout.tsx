import { type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

export default function Layout({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const nav = useNavigate();
  const loggedIn = !!localStorage.getItem('sl_token');

  function logout() {
    localStorage.removeItem('sl_token');
    nav('/auth');
  }

  return (
    <div className="app">
      <nav className="nav">
        <div className="nav-inner">
          <Link to="/" className="nav-brand">
            Streambree<span className="nav-brand-dot" />
          </Link>
          <div className="nav-links">
            {loggedIn && (
              <Link to="/channels" className={`nav-link${pathname.startsWith('/channel') ? ' active' : ''}`}>
                Channels
              </Link>
            )}
          </div>
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
      {children}
    </div>
  );
}
