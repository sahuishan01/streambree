import { Routes, Route, useLocation } from 'react-router-dom';
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

function Page({ children }: { children: React.ReactNode }) {
  return <div className="page-enter">{children}</div>;
}

export default function App() {
  const location = useLocation();

  return (
    <ToastProvider>
      <Layout>
        <Routes location={location} key={location.pathname}>
          <Route path="/"               element={<Page><Home /></Page>} />
          <Route path="/send"           element={<Page><Sender /></Page>} />
          <Route path="/join"           element={<Page><Receiver /></Page>} />
          <Route path="/auth"           element={<Page><Auth /></Page>} />
          <Route path="/channels"       element={<Page><Channels /></Page>} />
          <Route path="/channels/:id"   element={<Page><ChannelDetail /></Page>} />
          <Route path="/golive/:code"   element={<Page><GoLive /></Page>} />
          <Route path="/watch/:code"    element={<Page><Watch /></Page>} />
          <Route path="/invite/:code"   element={<Page><InviteAccept /></Page>} />
          <Route path="/users"          element={<Page><Users /></Page>} />
          <Route path="/profile"        element={<Page><Profile /></Page>} />
        </Routes>
      </Layout>
    </ToastProvider>
  );
}
