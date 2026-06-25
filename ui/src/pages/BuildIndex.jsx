import { Icon } from '@iconify/react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { getRepo, indexRepo } from '../api/client';

export default function BuildIndex() {
  const location = useLocation();
  const navigate = useNavigate();
  const searchParams = new URLSearchParams(location.search);
  const repoId = searchParams.get('repoId');

  const [repo, setRepo] = useState(null);
  const [indexing, setIndexing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState(0); // 0=ready, 1=cloning, 2=parsing, 3=embedding, 4=done
  const [error, setError] = useState(null);

  useEffect(() => {
    if (repoId) {
      getRepo(repoId).then(setRepo).catch(console.error);
    }
  }, [repoId]);

  const startIndexing = async () => {
    if (!repoId) return;
    setIndexing(true);
    setProgress(5);
    setStage(1);
    setError(null);

    try {
      // The API returns immediately while indexing runs in the background
      await indexRepo(repoId);
    } catch (e) {
      setIndexing(false);
      setError(e.message);
      return;
    }

    // Simulate progress over ~25-30 seconds to match the backend background process
    let currentProgress = 5;
    let currentStage = 1;
    
    const progressInterval = setInterval(() => {
      currentProgress += (Math.random() * 2 + 0.5); // Increment 0.5 - 2.5% per half-second
      
      if (currentProgress >= 30 && currentStage < 2) currentStage = 2;
      if (currentProgress >= 70 && currentStage < 3) currentStage = 3;
      
      if (currentProgress >= 100) {
        currentProgress = 100;
        clearInterval(progressInterval);
        setStage(4);
        setProgress(100);
        setTimeout(() => {
          navigate(`/pr-list?repoId=${repoId}`);
        }, 1500);
      } else {
        setStage(currentStage);
        setProgress(currentProgress);
      }
    }, 500);
  };

  return (
    <>
      {/* Decorative Background Pattern */}
      <div className="absolute inset-0 pointer-events-none z-0 opacity-[0.3] bg-[radial-gradient(#cbd5e1_1px,transparent_1px)] [background-size:24px_24px]"></div>
      <div className="absolute inset-0 pointer-events-none z-0 bg-gradient-to-b from-transparent via-slate-50/80 to-slate-50"></div>

      {/* Top Header Bar */}
      <header className="h-16 border-b border-slate-200 bg-white/80 backdrop-blur-sm flex items-center justify-between px-6 shrink-0 relative z-20">
        <div className="flex items-center gap-2.5 text-[14px]">
          <Icon icon="mdi:bitbucket" className="text-[#0052CC] text-[18px]" />
          <span className="text-slate-500 font-medium">{repo ? repo.workspace : 'Workspace'}</span>
          <span className="text-slate-300">/</span>
          <span className="font-semibold text-slate-900">{repo ? repo.repo_slug : 'Repository'}</span>
          
          {indexing && (
            <div className="ml-4 px-2 py-1 rounded-md bg-blue-50 text-blue-700 border border-blue-100 flex items-center gap-1.5 shadow-sm shadow-blue-100">
              <Icon icon="lucide:loader-2" className="animate-spin text-[12px]" />
              <span className="text-[11px] font-semibold uppercase tracking-wider">Indexing</span>
            </div>
          )}
        </div>
      </header>

      {/* Scrollable Content Area */}
      <div className="flex-1 overflow-y-auto p-6 md:p-12 flex flex-col items-center justify-center relative z-10">
        
        {/* Main Indexing Card */}
        <div className="w-full max-w-[640px] bg-white rounded-2xl shadow-[0_8px_30px_-4px_rgba(0,0,0,0.05)] border border-slate-200 overflow-hidden">
          
          <div className="p-8 md:p-10">
            
            <div className="flex flex-col items-center text-center mb-10">
              <div className="relative mb-5">
                <div className="w-16 h-16 bg-gradient-to-br from-brand-50 to-brand-100 rounded-2xl flex items-center justify-center border border-brand-200 shadow-inner relative z-10">
                  <Icon icon="lucide:database-zap" className="text-brand-600 text-3xl" />
                </div>
                {indexing && <div className="absolute inset-0 rounded-2xl bg-brand-400 animate-ping opacity-20 z-0"></div>}
              </div>
              
              <h2 className="text-[22px] font-bold text-slate-900 tracking-tight mb-2">
                {stage === 4 ? "Semantic index complete!" : "Building semantic index"}
              </h2>
              <p className="text-[14px] text-slate-500 max-w-[400px] leading-relaxed">
                We are mapping your codebase to enable AI-powered reviews, deep semantic search, and accurate risk scoring.
              </p>
              {error && <p className="text-red-500 text-sm mt-4">Error: {error}</p>}
            </div>

            {(!indexing && stage === 0) ? (
              <div className="flex justify-center mb-6">
                <button 
                  onClick={startIndexing}
                  className="px-6 py-3 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-xl shadow-md transition-all"
                >
                  Start Indexing
                </button>
              </div>
            ) : (
              <>
                <div className="bg-slate-50 rounded-xl p-5 border border-slate-200 mb-10">
                  <div className="flex justify-between items-end mb-3.5">
                    <div>
                      <div className="text-[13px] font-semibold text-slate-900 mb-0.5">Overall Progress</div>
                      <div className="text-[12px] text-slate-500 font-medium flex items-center gap-1.5">
                        {stage < 4 && <Icon icon="lucide:timer" className="text-slate-400 animate-pulse" />}
                        {stage === 4 ? "Done" : "Indexing in progress..."}
                      </div>
                    </div>
                    <div className="text-[28px] leading-none font-bold text-brand-600 tracking-tight">
                      {Math.floor(progress)}%
                    </div>
                  </div>
                  
                  <div className="h-2.5 w-full bg-slate-200 rounded-full overflow-hidden shadow-inner">
                    <div 
                      className="h-full bg-brand-500 rounded-full relative overflow-hidden transition-all duration-300 ease-out"
                      style={{ width: `${progress}%` }}
                    >
                      {stage < 4 && <div className="absolute inset-0 w-full h-full bg-gradient-to-r from-transparent via-white/40 to-transparent -translate-x-full animate-[shimmer_1.5s_infinite]"></div>}
                    </div>
                  </div>
                </div>

                {/* Detailed Stages List */}
                <div className="space-y-6 relative pl-2">
                  <div className="absolute left-[19px] top-4 bottom-4 w-[2px] bg-slate-100 z-0"></div>

                  {/* Stage 1 */}
                  <div className={`relative z-10 flex gap-4 ${stage >= 1 ? 'opacity-100' : 'opacity-40'}`}>
                    <div className={`w-6 h-6 shrink-0 rounded-full flex items-center justify-center ${stage > 1 ? 'bg-emerald-500 text-white' : stage === 1 ? 'bg-white border-[2.5px] border-brand-500' : 'bg-slate-200'}`}>
                      {stage > 1 ? <Icon icon="lucide:check" className="text-[14px]" /> : stage === 1 && <div className="w-2 h-2 bg-brand-500 rounded-full animate-pulse"></div>}
                    </div>
                    <div className="pb-1">
                      <div className={`text-[14px] font-semibold leading-tight ${stage === 1 ? 'text-brand-700' : 'text-slate-900'}`}>Clone repository & dependencies</div>
                      <div className="text-[13px] text-slate-500 mt-1">Fetching latest code structure.</div>
                    </div>
                  </div>

                  {/* Stage 2 */}
                  <div className={`relative z-10 flex gap-4 ${stage >= 2 ? 'opacity-100' : 'opacity-40'}`}>
                    <div className={`w-6 h-6 shrink-0 rounded-full flex items-center justify-center ${stage > 2 ? 'bg-emerald-500 text-white' : stage === 2 ? 'bg-white border-[2.5px] border-brand-500' : 'bg-slate-200'}`}>
                      {stage > 2 ? <Icon icon="lucide:check" className="text-[14px]" /> : stage === 2 && <div className="w-2 h-2 bg-brand-500 rounded-full animate-pulse"></div>}
                    </div>
                    <div className="pb-1 w-full">
                      <div className={`text-[14px] font-semibold leading-tight ${stage === 2 ? 'text-brand-700' : 'text-slate-900'}`}>Static analysis & AST parsing</div>
                      <div className="text-[13px] text-slate-500 mt-1">Extracting syntax trees, functions, and import graphs.</div>
                    </div>
                  </div>

                  {/* Stage 3 */}
                  <div className={`relative z-10 flex gap-4 ${stage >= 3 ? 'opacity-100' : 'opacity-40'}`}>
                    <div className={`w-6 h-6 shrink-0 rounded-full flex items-center justify-center ${stage > 3 ? 'bg-emerald-500 text-white' : stage === 3 ? 'bg-white border-[2.5px] border-brand-500' : 'bg-slate-200'}`}>
                      {stage > 3 ? <Icon icon="lucide:check" className="text-[14px]" /> : stage === 3 && <div className="w-2 h-2 bg-brand-500 rounded-full animate-pulse"></div>}
                    </div>
                    <div className="pb-1">
                      <div className={`text-[14px] font-semibold leading-tight ${stage === 3 ? 'text-brand-700' : 'text-slate-900'}`}>Generate semantic embeddings</div>
                      <div className="text-[13px] text-slate-500 mt-1">Vectorizing code segments for AI-powered similarity search.</div>
                    </div>
                  </div>
                </div>
              </>
            )}

          </div>

          {/* Footer / Next Action */}
          <div className="bg-slate-50 border-t border-slate-200 p-6 flex flex-col items-center justify-center">
            <div className="flex items-center gap-3 w-full sm:w-auto">
              <Link to={`/pr-list?repoId=${repoId || ''}`} className="w-full sm:w-auto inline-flex justify-center items-center gap-2 bg-white text-brand-600 border border-slate-200 px-6 py-2.5 rounded-lg text-[14px] font-medium hover:bg-slate-50 transition-all">
                View Pull Requests
                <Icon icon="lucide:arrow-right" className="text-[16px]" />
              </Link>
            </div>
          </div>

        </div>
        
      </div>
    </>
  );
}
