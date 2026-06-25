import Sidebar from './Sidebar';
import { Outlet } from 'react-router-dom';

export default function Layout() {
  return (
    <div className="flex h-screen w-full bg-slate-50 text-slate-900 font-sans antialiased overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col relative overflow-hidden bg-slate-50 min-w-0">
        <Outlet />
      </div>
    </div>
  );
}
