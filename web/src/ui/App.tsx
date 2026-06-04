import { Routes, Route } from 'react-router-dom';
import Home from './screens/Home';
import Sender from './screens/Sender';
import Receiver from './screens/Receiver';
import Auth from './screens/Auth';
import Channels from './screens/Channels';
import ChannelDetail from './screens/ChannelDetail';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/send" element={<Sender />} />
      <Route path="/join" element={<Receiver />} />
      <Route path="/auth" element={<Auth />} />
      <Route path="/channels" element={<Channels />} />
      <Route path="/channels/:id" element={<ChannelDetail />} />
    </Routes>
  );
}
