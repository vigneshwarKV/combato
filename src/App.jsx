import { Routes, Route } from 'react-router-dom';
import HomePage from './pages/HomePage.jsx';
import RoomPage from './pages/RoomPage.jsx';
import DevPage from './pages/DevPage.jsx';
import BotMatchPage from './pages/BotMatchPage.jsx';
import CharSelectPage from './pages/CharSelectPage.jsx';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/setup" element={<CharSelectPage />} />
      <Route path="/room/:code" element={<RoomPage />} />
      <Route path="/bot" element={<BotMatchPage />} />
      <Route path="/dev" element={<DevPage />} />
    </Routes>
  );
}
