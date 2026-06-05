import { Routes, Route } from 'react-router-dom';
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

export default function App() {
  return (
    <Layout>
      <Routes>
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
      </Routes>
    </Layout>
  );
}
