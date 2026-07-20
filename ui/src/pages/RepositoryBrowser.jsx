import { Icon } from '@iconify/react';
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { listBitbucketRepos, refreshBitbucketRepos, addRepo, indexRepo, listRepos } from '../api/client';
import Toast from '../components/Toast';

export default function RepositoryBrowser() {
  const [repos, setRepos] = useState([]);
  const [connectedRepos, setConnectedRepos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedUrls, setSelectedUrls] = useState(new Set());
  const [connecting, setConnecting] = useState(false);
  const [toast, setToast] = useState(null);
  
  const navigate = useNavigate();

  const fetchRepos = async () => {
    try {
      const [bbRepos, connected] = await Promise.all([
        listBitbucketRepos(),
        listRepos()
      ]);
      setRepos(bbRepos);
      setConnectedRepos(connected.map(r => r.git_url || `https://bitbucket.org/${r.workspace}/${r.repo_slug}`));
    } catch (err) {
      console.error("Failed to load bitbucket repos:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRepos();
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const newRepos = await refreshBitbucketRepos();
      setRepos(newRepos);
    } catch (err) {
      console.error("Refresh failed:", err);
    } finally {
      setRefreshing(false);
    }
  };

  const toggleRepo = (url) => {
    const newSet = new Set(selectedUrls);
    if (newSet.has(url)) {
      newSet.delete(url);
    } else {
      newSet.add(url);
    }
    setSelectedUrls(newSet);
  };

  const clearSelection = () => {
    setSelectedUrls(new Set());
  };

  const handleConnect = async () => {
    if (selectedUrls.size === 0) return;
    setConnecting(true);
    try {
      const connectedIds = [];
      for (const url of selectedUrls) {
        // Add the repo
        const newRepo = await addRepo(url);
        // Start indexing it
        await indexRepo(newRepo.id);
        connectedIds.push(newRepo.id);
      }
      
      // Navigate to the build index page for the first selected repo, or back to repo list if multiple
      if (connectedIds.length === 1) {
        navigate(`/build-index?repoId=${connectedIds[0]}`);
      } else {
        // Or navigate somewhere else if multiple?
        navigate(`/pr-list?repoId=${connectedIds[0]}`);
      }
    } catch (err) {
      console.error("Failed to connect repos:", err);
      setToast({ message: "Failed to connect: " + err.message, type: 'error' });
    } finally {
      setConnecting(false);
    }
  };

  const filteredRepos = repos.filter(repo => {
    const term = search.toLowerCase();
    return repo.full_name.toLowerCase().includes(term) || (repo.description && repo.description.toLowerCase().includes(term));
  });

  return (
    <>
      <Toast message={toast?.message} type={toast?.type} onDismiss={() => setToast(null)} />

      {/* Decorative Background Element */}
      <div className="absolute top-0 inset-x-0 h-64 bg-gradient-to-b from-slate-100 to-transparent pointer-events-none z-0"></div>

      {/* Page Header */}
      <header className="flex-shrink-0 bg-white/80 backdrop-blur-md border-b border-slate-200 px-8 py-6 z-20 relative">
        <div className="w-full flex items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-slate-500 mb-1">
              <span className="hover:text-slate-900 transition-colors">
                <Icon icon="mdi:bitbucket" className="text-[18px] text-[#0052CC]" />
              </span>
              <Icon icon="lucide:chevron-right" className="text-[14px]" />
              <span className="text-[13px] font-medium">Bitbucket Cloud</span>
            </div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
              Browse Repositories
            </h1>
            <p className="text-[14px] text-slate-500 mt-1">
              Select repositories to connect and enable AI-powered code reviews.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button 
              onClick={handleRefresh}
              disabled={refreshing}
              className="text-[13px] font-medium text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 hover:text-slate-900 px-4 py-2 rounded-lg transition-colors flex items-center gap-2 disabled:opacity-50"
            >
              <Icon icon="lucide:refresh-cw" className={`text-[14px] ${refreshing ? 'animate-spin' : ''}`} />
              {refreshing ? 'Syncing...' : 'Sync from Bitbucket'}
            </button>
          </div>
        </div>
      </header>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto px-8 py-6 z-10 relative">
        <div className="w-full">
          
          {/* Toolbar (Search & Filters) */}
          <div className="flex flex-col sm:flex-row gap-4 mb-6">
            <div className="flex-1 relative">
              <Icon icon="lucide:search" className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-[16px]" />
              <input 
                type="text" 
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 rounded-xl text-[14px] outline-none transition-all shadow-sm" 
                placeholder="Search repositories by name or description..." 
              />
            </div>
          </div>

          {/* Repository List */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 pb-8">
            {loading ? (
              <div className="py-12 text-center text-slate-500 text-sm">Loading repositories...</div>
            ) : filteredRepos.length === 0 ? (
              <div className="py-12 text-center text-slate-500 text-sm">No repositories found.</div>
            ) : (
              filteredRepos.map((repo) => {
                const gitUrl = `https://bitbucket.org/${repo.workspace}/${repo.slug}`;
                const isSelected = selectedUrls.has(gitUrl);
                const isConnected = connectedRepos.some(cr => cr.includes(`${repo.workspace}/${repo.slug}`));
                
                return (
                  <label 
                    key={repo.full_name}
                    className={`group flex items-start gap-4 border rounded-xl p-5 shadow-[0_2px_4px_rgba(37,99,235,0.05)] transition-all ${
                      isSelected 
                        ? 'bg-brand-50/30 border-brand-500 ring-1 ring-brand-500' 
                        : isConnected 
                          ? 'bg-slate-50 border-slate-200 opacity-60' 
                          : 'bg-white border-slate-200 hover:border-brand-300 hover:shadow-md cursor-pointer'
                    }`}
                  >
                    <div className="pt-0.5">
                      <input 
                        type="checkbox" 
                        checked={isSelected || isConnected}
                        disabled={isConnected}
                        onChange={() => toggleRepo(gitUrl)}
                        className={`w-4 h-4 rounded transition-all cursor-pointer ${
                          isConnected ? 'text-slate-400 bg-slate-200 border-slate-300' : 'border-slate-300 text-brand-600 focus:ring-brand-500 accent-brand-600'
                        }`} 
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-4 mb-1">
                        <div className="flex items-center gap-2.5">
                          <Icon icon="lucide:folder-git-2" className={`${isSelected || isConnected ? 'text-brand-500' : 'text-slate-400 group-hover:text-brand-400'} text-[18px] transition-colors`} />
                          <h3 className="text-[15px] font-semibold text-slate-900 truncate">{repo.slug}</h3>
                          <span className="px-2 py-0.5 rounded-md bg-white border border-slate-200 text-[10px] font-medium text-slate-600 uppercase tracking-wider">
                            {repo.is_private ? 'Private' : 'Public'}
                          </span>
                        </div>
                        <div className="flex items-center gap-3">
                          {isConnected && (
                            <span className="text-[12px] font-medium text-emerald-600 bg-emerald-50 px-2 py-1 rounded-md flex items-center gap-1">
                              <Icon icon="lucide:check-circle-2" className="text-[14px]" />
                              Connected
                            </span>
                          )}
                          <a href={gitUrl} target="_blank" rel="noreferrer" className="text-slate-400 hover:text-[#0052CC] transition-colors p-1" title="View on Bitbucket" onClick={e => e.stopPropagation()}>
                            <Icon icon="mdi:bitbucket" className="text-[18px]" />
                          </a>
                        </div>
                      </div>
                      <div className="text-[13px] text-slate-500 mb-2 flex items-center gap-1.5">
                        <div className="w-4 h-4 rounded bg-slate-200 flex items-center justify-center text-[9px] font-bold text-slate-600 uppercase">
                          {repo.workspace.substring(0, 2)}
                        </div>
                        {repo.full_name}
                      </div>
                      <p className="text-[13px] text-slate-600 line-clamp-1 mb-3.5">
                        {repo.description || 'No description provided.'}
                      </p>
                      <div className="flex items-center gap-6 text-[12px] text-slate-500">
                        {repo.language && (
                          <div className="flex items-center gap-1.5 font-medium">
                            <div className="w-2.5 h-2.5 rounded-full bg-slate-400"></div>
                            {repo.language}
                          </div>
                        )}
                        <div className="flex items-center gap-1.5">
                          <Icon icon="lucide:clock" className="text-[14px]" />
                          Updated {new Date(repo.updated_on).toLocaleDateString()}
                        </div>
                      </div>
                    </div>
                  </label>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Sticky Bottom Action Bar (visible when items selected) */}
      {selectedUrls.size > 0 && (
        <div className="flex-shrink-0 bg-white border-t border-slate-200 py-4 px-8 z-30 shadow-[0_-10px_15px_-3px_rgba(0,0,0,0.03)] animate-[fade-in_0.2s_ease-out]">
          <div className="w-full flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="flex items-center justify-center w-6 h-6 rounded-full bg-brand-100 text-brand-600 text-[13px] font-bold">
                {selectedUrls.size}
              </span>
              <span className="text-[14px] font-medium text-slate-700">
                repositories selected
              </span>
            </div>
            <div className="flex items-center gap-4">
              <button 
                onClick={clearSelection}
                disabled={connecting}
                className="text-[14px] font-medium text-slate-500 hover:text-slate-800 transition-colors px-2 disabled:opacity-50"
              >
                Clear selection
              </button>
              <button 
                onClick={handleConnect}
                disabled={connecting}
                className="inline-flex items-center gap-2 bg-brand-600 hover:bg-brand-700 text-white px-6 py-2.5 rounded-lg text-[14px] font-medium shadow-sm shadow-brand-500/30 transition-all hover:shadow-brand-500/40 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 disabled:opacity-50"
              >
                {connecting ? 'Connecting...' : 'Connect & Build Index'}
                <Icon icon="lucide:arrow-right" className="text-[16px]" />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
