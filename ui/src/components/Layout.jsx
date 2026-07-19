import { useEffect } from 'react';
import Sidebar from './Sidebar';
import { Outlet, useLocation } from 'react-router-dom';

const PAGE_TITLES = [
  { match: '/repos', title: 'Browse Repositories' },
  { match: '/build-index', title: 'Build Index' },
  { match: '/pr-list', title: 'Pull Requests' },
  { match: '/pr-details', title: 'PR Details' },
  { match: '/webhooks', title: 'Webhook Setup' },
  { match: '/source', title: 'Source Browser' },
];

function pageTitleFor(pathname) {
  const hit = PAGE_TITLES.find(p => pathname.startsWith(p.match));
  return hit ? `${hit.title} — PR Guardian` : 'PR Guardian';
}

export default function Layout() {
  const location = useLocation();

  useEffect(() => {
    document.title = pageTitleFor(location.pathname);
  }, [location.pathname]);

  return (
    <div className="flex h-screen w-full bg-slate-50 text-slate-900 font-sans antialiased overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col relative overflow-hidden bg-slate-50 min-w-0">
        <Outlet />
      </div>
    </div>
  );
}
