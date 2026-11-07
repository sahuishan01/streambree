import { Routes, Route, Link, useLocation } from 'react-router-dom';
import { ToastProvider } from './toast';
import Layout from './Layout';
import Home from './screens/Home';
import Sender from './screens/Sender';
import Receiver from './screens/Receiver';
import Auth from './screens/Auth';
import Channels from './screens/Channels';
import ChannelDetail from './screens/ChannelDetail';
import GoLive from './screens/GoLive';
import Watch from './screens/Watch';
import InviteAccept from './screens/InviteAccept';
import Users from './screens/Users';
import Profile from './screens/Profile';
import SharedFiles from './screens/SharedFiles';
import { EmptyState } from './components/ui';

function NotFound() {
  return (
    <div className="page page-narrow">
      <EmptyState title="Page not found" desc="That link doesn't lead anywhere in Streambree."
        action={<Link to="/" className="btn btn-secondary">Go home</Link>} />
    </div>
  );
}

export default function App() {
  const location = useLocation();

  return (
    <ToastProvider>
      <Layout>
        <Routes location={location} key={location.pathname}>
          <Route path="/"               element={<Home />} />
          <Route path="/send"           element={<Sender />} />
          <Route path="/join"           element={<Receiver />} />
          <Route path="/auth"           element={<Auth />} />
          <Route path="/channels"       element={<Channels />} />
          <Route path="/channels/:id"   element={<ChannelDetail />} />
          <Route path="/golive/:code"   element={<GoLive />} />
          <Route path="/watch/:code"    element={<Watch />} />
          <Route path="/invite/:code"   element={<InviteAccept />} />
          <Route path="/users"          element={<Users />} />
          <Route path="/profile"        element={<Profile />} />
          <Route path="/shared-files"   element={<SharedFiles />} />
          <Route path="/shared"         element={<SharedFiles />} />
          <Route path="*"               element={<NotFound />} />
        </Routes>
      </Layout>
    </ToastProvider>
  );
}
