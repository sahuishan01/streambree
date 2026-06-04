import { Routes, Route } from 'react-router-dom';
import Home from './screens/Home';
import Sender from './screens/Sender';
import Receiver from './screens/Receiver';
import Auth from './screens/Auth';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/send" element={<Sender />} />
      <Route path="/join" element={<Receiver />} />
      <Route path="/auth" element={<Auth />} />
    </Routes>
  );
}
