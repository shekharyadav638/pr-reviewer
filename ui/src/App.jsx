import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Onboarding from './pages/Onboarding';
import RepositoryBrowser from './pages/RepositoryBrowser';
import BuildIndex from './pages/BuildIndex';
import PRList from './pages/PRList';
import PRDetails from './pages/PRDetails';
import WebhookSetup from './pages/WebhookSetup';
import SourceBrowser from './pages/SourceBrowser';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Onboarding />} />
          <Route path="repos" element={<RepositoryBrowser />} />
          <Route path="build-index" element={<BuildIndex />} />
          <Route path="pr-list" element={<PRList />} />
          <Route path="pr-details" element={<PRDetails />} />
          <Route path="webhooks" element={<WebhookSetup />} />
          <Route path="source" element={<SourceBrowser />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
