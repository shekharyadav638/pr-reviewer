import { Icon } from '@iconify/react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { getRepo, getRepoPRs } from '../api/client';

// Helper to format "X hours ago"
function timeAgo(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString);
  const now = new Date();
  const seconds = Math.floor((now - date) / 1000);
  
  let interval = Math.floor(seconds / 31536000);
  if (interval > 1) return interval + " years ago";
  interval = Math.floor(seconds / 2592000);
  if (interval > 1) return interval + " months ago";
  interval = Math.floor(seconds / 86400);
  if (interval > 1) return interval + " days ago";
  if (interval === 1) return "yesterday";
  interval = Math.floor(seconds / 3600);
  if (interval > 1) return interval + " hours ago";
  interval = Math.floor(seconds / 60);
  if (interval > 1) return interval + " minutes ago";
  return Math.floor(seconds) + " seconds ago";
}

// Generate a somewhat consistent color based on a string
function stringToColor(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const colors = [
    'bg-red-500', 'bg-orange-500', 'bg-amber-500', 
    'bg-emerald-500', 'bg-teal-500', 'bg-cyan-500', 
    'bg-blue-500', 'bg-indigo-500', 'bg-violet-500', 
    'bg-purple-500', 'bg-fuchsia-500', 'bg-pink-500'
  ];
  return colors[Math.abs(hash) % colors.length];
}

export default function PRList() {
  const location = useLocation();
  const navigate = useNavigate();
  const searchParams = new URLSearchParams(location.search);
  const repoId = searchParams.get('repoId');

  const [repo, setRepo] = useState(null);
  const [prs, setPrs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('OPEN');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (!repoId) {
      setLoading(false);
      return;
    }

    async function loadData() {
      setLoading(true);
      try {
        const [repoData, prsData] = await Promise.all([
          getRepo(repoId),
          getRepoPRs(repoId, tab)
        ]);
        setRepo(repoData);
        setPrs(prsData);
      } catch (err) {
        console.error("Failed to load repo data", err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [repoId, tab]);

  const filteredPrs = prs.filter(pr => 
    pr.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
    pr.author.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <header className="px-6 py-5 border-b border-slate-200 shrink-0">
        <div className="w-full">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
                Pull Requests
              </h1>
              {/* Semantic Index Status Badge */}
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-100 text-emerald-700 text-xs font-semibold tracking-wide">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_4px_rgba(16,185,129,0.4)] relative">
                  <div className="absolute inset-0 rounded-full bg-emerald-500 animate-ping opacity-75"></div>
                </div>
                Semantic index ready
              </span>
            </div>
            
            {/* Repo Breadcrumb */}
            <div className="flex items-center text-[13px] mt-1">
              <Icon icon="mdi:github" className="text-slate-400 mr-1.5 text-[16px]" />
              <span className="text-slate-500 font-medium">{repo ? repo.workspace : 'Workspace'}</span> 
              <span className="text-slate-300 mx-1.5">/</span> 
              <span className="text-slate-900 font-semibold">{repo ? repo.repo_slug : 'Repository'}</span>
            </div>
          </div>
        </div>
      </header>

      {/* Filters & Search Bar */}
      <div className="px-6 py-2 border-b border-slate-200 shrink-0">
        <div className="w-full flex items-center justify-between">
          
          <div className="flex items-center gap-4">
            {/* Segmented Control Tabs */}
            <div className="flex p-1 bg-slate-100 rounded-lg">
              {['OPEN', 'MERGED', 'DECLINED'].map((t) => (
                <button 
                  key={t}
                  onClick={() => setTab(t)}
                  className={`px-4 py-1.5 text-[13px] rounded-md transition-colors focus:outline-none ${
                    tab === t 
                      ? 'font-semibold bg-white text-slate-900 shadow-sm' 
                      : 'font-medium text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
            
            {/* Search Input */}
            <div className="relative w-80">
              <Icon icon="lucide:search" className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-[15px]" />
              <input 
                type="text" 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search pull requests..." 
                className="w-full pl-9 pr-4 py-1.5 bg-white border border-slate-200 rounded-lg text-[13px] text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all"
              />
            </div>
          </div>

          {/* Results Count */}
          <div className="text-[13px] text-slate-500 font-medium">
            {filteredPrs.length} results
          </div>

        </div>
      </div>

      {/* Table Header */}
      <div className="grid grid-cols-12 gap-4 px-6 py-2.5 border-b border-slate-200 text-[12px] font-semibold text-slate-500 bg-white shrink-0">
        <div className="col-span-10">Summary</div>
        <div className="col-span-2">Created</div>
      </div>

      {/* PR List Content Area (Table Body) */}
      <div className="flex-1 overflow-y-auto relative">
        {loading ? (
          <div className="py-12 text-center text-slate-500 text-sm">Loading pull requests...</div>
        ) : !repoId ? (
          <div className="py-12 text-center text-slate-500 text-sm">Please select a repository from the sidebar.</div>
        ) : filteredPrs.length === 0 ? (
          <div className="py-12 text-center text-slate-500 text-sm">No pull requests found.</div>
        ) : (
          <div className="w-full flex flex-col">
            {filteredPrs.map((pr) => {
              const initials = pr.author.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
              const bgColor = stringToColor(pr.author);
              
              return (
                <div 
                  key={pr.pr_id} 
                  onClick={() => navigate(`/pr-details?repoId=${repoId}&prId=${pr.pr_id}`)}
                  className="grid grid-cols-12 gap-4 px-6 py-4 border-b border-slate-100 hover:bg-slate-50 transition-colors group cursor-pointer items-start"
                >
                  <div className="col-span-10 flex gap-3 min-w-0">
                    {/* Avatar */}
                    <div className={`w-8 h-8 rounded-full ${bgColor} text-white flex items-center justify-center font-bold text-xs uppercase shrink-0`}>
                      {initials}
                    </div>
                    
                    {/* PR Details */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide ${
                          pr.state === 'OPEN' 
                            ? 'bg-[#0052CC] text-white'
                            : pr.state === 'MERGED'
                              ? 'bg-[#00875A] text-white'
                              : 'bg-slate-500 text-white'
                        }`}>
                          {pr.state}
                        </span>
                        <h3 className="text-[14px] font-medium text-slate-900 group-hover:underline truncate" title={pr.title}>
                          {pr.title}
                        </h3>
                      </div>
                      
                      {/* Meta Info */}
                      <div className="text-[12px] text-slate-500 flex items-center gap-1 flex-wrap">
                        <span>{pr.author}</span>
                        <span>-</span>
                        <span>#{pr.pr_id}, updated {timeAgo(pr.updated_at)}</span>
                        
                        {/* Branches */}
                        <div className="flex items-center gap-1 ml-1 overflow-hidden">
                          <span className="px-1.5 py-0.5 bg-slate-100 border border-slate-200 rounded text-slate-600 font-mono text-[10px] truncate max-w-[120px]" title={pr.source_branch || 'feature/branch'}>
                            {pr.source_branch || 'feature/branch'}
                          </span>
                          <Icon icon="lucide:arrow-right" className="text-[10px] text-slate-400 shrink-0" />
                          <span className="px-1.5 py-0.5 bg-slate-100 border border-slate-200 rounded text-slate-600 font-mono text-[10px] truncate max-w-[120px]" title={pr.target_branch || repo?.default_branch || 'main'}>
                            {pr.target_branch || repo?.default_branch || 'main'}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                  
                  {/* Created & Actions */}
                  <div className="col-span-2 text-[13px] text-slate-700 flex items-start justify-between pt-0.5">
                    <span>{timeAgo(pr.created_at)}</span>
                    {pr.state === 'OPEN' && (
                      <button 
                        onClick={(e) => { e.stopPropagation(); navigate(`/pr-details?repoId=${repoId}&prId=${pr.pr_id}`); }}
                        className="px-3 py-1 bg-white border border-slate-300 text-slate-600 rounded text-[12px] font-medium hover:bg-slate-50 transition-colors opacity-0 group-hover:opacity-100"
                      >
                        Review
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
