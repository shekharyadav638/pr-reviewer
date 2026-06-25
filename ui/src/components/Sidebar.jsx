import { Icon } from '@iconify/react';
import { NavLink, Link, useNavigate, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { listRepos } from '../api/client';

export default function Sidebar() {
  const [repos, setRepos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedRepo, setExpandedRepo] = useState(null);
  
  const navigate = useNavigate();
  const location = useLocation();

  // Simple query param parsing to highlight active repo
  const searchParams = new URLSearchParams(location.search);
  const activeRepoId = searchParams.get('repoId');

  useEffect(() => {
    if (activeRepoId && expandedRepo !== activeRepoId) {
      setExpandedRepo(activeRepoId);
    }
  }, [activeRepoId]);

  useEffect(() => {
    async function fetchRepos() {
      try {
        const data = await listRepos();
        setRepos(data);
      } catch (err) {
        console.error("Failed to load connected repos:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchRepos();
  }, [location.pathname]); // refetch when navigating

  const toggleRepo = (e, repoId) => {
    e.stopPropagation();
    setExpandedRepo(expandedRepo === String(repoId) ? null : String(repoId));
  };

  return (
    <aside className="w-[320px] bg-white border-r border-slate-200 flex flex-col flex-shrink-0 z-10 h-screen">
      {/* Header / Branding */}
      <div className="h-16 flex items-center px-5 border-b border-slate-100">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-[8px] bg-gradient-to-br from-indigo-500 to-brand-500 flex items-center justify-center shadow-[0_2px_4px_rgba(37,99,235,0.2)]">
            <Icon icon="lucide:shield" className="text-white text-[18px]" />
          </div>
          <div className="flex flex-col justify-center">
            <span className="text-[14px] font-semibold tracking-tight text-slate-900 leading-none mb-1">
              PR Guardian
            </span>
            <span className="text-[11px] text-slate-500 leading-none">AI code review</span>
          </div>
        </div>
      </div>

      {/* Sidebar Scrollable Content */}
      <div className="flex-1 overflow-y-auto px-3 py-4 flex flex-col gap-6">
        {/* Global Action */}
        <div className="px-2">
          <NavLink
            to="/repos"
            className={({ isActive }) =>
              `flex items-center gap-2.5 px-3 py-2 text-[13px] font-medium rounded-md transition-colors border ` +
              (isActive
                ? 'bg-brand-50 border-brand-100 text-brand-700'
                : 'text-slate-700 bg-slate-50 border-slate-200 hover:bg-slate-100 hover:text-slate-900')
            }
          >
            <Icon icon="mdi:bitbucket" className="text-[#0052CC] text-lg" />
            Browse Bitbucket
          </NavLink>
        </div>

        {/* Repositories List */}
        <div>
          <div className="flex items-center justify-between px-3 mb-2">
            <h3 className="text-[11px] font-semibold text-slate-400 tracking-wider uppercase">
              My Repos
            </h3>
            <button
              onClick={() => navigate('/repos')}
              className="w-5 h-5 flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded transition-colors"
            >
              <Icon icon="lucide:plus" className="text-[14px]" />
            </button>
          </div>

          <div className="space-y-0.5">
            {loading ? (
              <div className="px-3 py-2 text-[12px] text-slate-400">Loading...</div>
            ) : repos.length === 0 ? (
              <div className="px-3 py-2 text-[12px] text-slate-400">No repositories connected.</div>
            ) : (
              repos.map((repo) => {
                const isExpanded = expandedRepo === String(repo.id);
                
                return (
                  <div key={repo.id} className="mb-1">
                    <div
                      onClick={(e) => toggleRepo(e, repo.id)}
                      className={`px-3 py-2 rounded-md group cursor-pointer transition-colors border ${
                        isExpanded
                          ? 'bg-slate-50 border-slate-200'
                          : 'border-transparent hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex items-start gap-2.5">
                          <Icon 
                            icon={isExpanded ? "lucide:chevron-down" : "lucide:chevron-right"} 
                            className="text-slate-400 text-[14px] mt-0.5"
                          />
                          <div>
                            <div
                              className={`text-[13px] font-medium leading-tight ${
                                isExpanded ? 'text-slate-900' : 'text-slate-700 group-hover:text-slate-900'
                              }`}
                            >
                              {repo.repo_slug}
                            </div>
                            <div className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-1">
                              {repo.workspace}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                    
                    {/* Sub-menu options */}
                    {isExpanded && (
                      <div className="ml-7 mt-1 space-y-0.5 pl-1 border-l-2 border-slate-100">
                        <NavLink
                          to={`/pr-list?repoId=${repo.id}`}
                          className={({ isActive }) => 
                            `flex items-center gap-2 px-3 py-1.5 text-[12px] font-medium rounded-md transition-colors ${
                              location.pathname === '/pr-list' && activeRepoId === String(repo.id)
                                ? 'bg-brand-50 text-brand-700' 
                                : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                            }`
                          }
                        >
                          <Icon icon="lucide:git-pull-request" className="text-[14px]" />
                          Pull Requests
                        </NavLink>
                        
                        <NavLink
                          to={`/source?repoId=${repo.id}`}
                          className={({ isActive }) => 
                            `flex items-center gap-2 px-3 py-1.5 text-[12px] font-medium rounded-md transition-colors ${
                              location.pathname === '/source' && activeRepoId === String(repo.id)
                                ? 'bg-brand-50 text-brand-700' 
                                : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                            }`
                          }
                        >
                          <Icon icon="lucide:code-2" className="text-[14px]" />
                          Source Code
                        </NavLink>
                        
                        <NavLink
                          to={`/build-index?repoId=${repo.id}`}
                          className={({ isActive }) => 
                            `flex items-center gap-2 px-3 py-1.5 text-[12px] font-medium rounded-md transition-colors ${
                              location.pathname === '/build-index' && activeRepoId === String(repo.id)
                                ? 'bg-brand-50 text-brand-700' 
                                : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                            }`
                          }
                        >
                          <Icon icon="lucide:database" className="text-[14px]" />
                          Re-index
                        </NavLink>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Bottom Promo Box */}
      <div className="p-4 mt-auto border-t border-slate-100 bg-slate-50/50">
        <div className="bg-white border border-slate-200 rounded-lg p-3.5 shadow-sm">
          <div className="flex items-center gap-1.5 text-amber-500 mb-1.5">
            <Icon icon="lucide:zap" className="text-[14px] fill-current" />
            <span className="text-[12px] font-semibold text-slate-800">Auto-review with webhooks</span>
          </div>
          <p className="text-[11px] text-slate-500 leading-relaxed mb-2">
            Connect Bitbucket webhooks to auto-review every new PR.
          </p>
          <Link
            to="/webhooks"
            className="text-[11px] font-medium text-brand-600 hover:text-brand-700 flex items-center gap-1 w-max"
          >
            Set up webhook
            <Icon icon="lucide:arrow-right" className="text-[10px]" />
          </Link>
        </div>
      </div>
    </aside>
  );
}
