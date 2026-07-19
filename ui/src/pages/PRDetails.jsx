import { Icon } from '@iconify/react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useState, useEffect, useRef, useMemo } from 'react';
import { getRepo, getRepoPRs, analyzeHybrid, postReviewComments, getPRReview, getPRReviewStatus, getPRDiff, postPRComment } from '../api/client';
import Spinner from '../components/Spinner';
import { parseDiff, FileDiff } from '../components/DiffViewer';
import FileTree from '../components/FileTree';

function timeAgo(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString);
  const now = new Date();
  const seconds = Math.floor((now - date) / 1000);
  
  let interval = Math.floor(seconds / 86400);
  if (interval >= 1) return interval + " days ago";
  interval = Math.floor(seconds / 3600);
  if (interval >= 1) return interval + " hours ago";
  interval = Math.floor(seconds / 60);
  if (interval >= 1) return interval + " minutes ago";
  return "just now";
}

export default function PRDetails() {
  const location = useLocation();
  const navigate = useNavigate();
  const searchParams = new URLSearchParams(location.search);
  const repoId = searchParams.get('repoId');
  const prId = parseInt(searchParams.get('prId'), 10);

  const [repo, setRepo] = useState(null);
  const [pr, setPr] = useState(null);
  const [loading, setLoading] = useState(true);
  
  const [review, setReview] = useState(null);
  const [reviewing, setReviewing] = useState(false);
  
  const [posting, setPosting] = useState(false);
  const [postResult, setPostResult] = useState(null);

  // Accordion states
  const [expandedSection, setExpandedSection] = useState('static');

  // New tab and diff state
  const [tab, setTab] = useState('changes');
  const [diff, setDiff] = useState(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState(null);
  const [reviewComments, setReviewComments] = useState([]);
  
  const [activeFile, setActiveFile] = useState(null);
  const fileRefs = useRef({});
  const pollRef = useRef(null);

  function stopPolling() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  // Resume showing "Analyzing..." after a navigation away instead of
  // re-triggering a duplicate run — polls until the server-side review
  // (started by us or another tab) finishes and gets cached.
  function startPolling() {
    if (pollRef.current) return;
    pollRef.current = setInterval(async () => {
      try {
        const cached = await getPRReview(repoId, prId);
        if (cached) {
          stopPolling();
          setReview(cached);
          setReviewing(false);
          return;
        }
        const { status } = await getPRReviewStatus(repoId, prId);
        if (status === 'idle') {
          // Finished (or failed) with nothing cached — stop waiting.
          stopPolling();
          setReviewing(false);
        }
      } catch {
        // Network hiccup — keep trying on the next tick.
      }
    }, 4000);
  }

  useEffect(() => stopPolling, []);

  useEffect(() => {
    if (!repoId || !prId) return;

    async function loadData() {
      setLoading(true);
      try {
        const repoData = await getRepo(repoId);
        setRepo(repoData);

        // Fetch PRs to find ours
        let prsData = await getRepoPRs(repoId, "OPEN").catch(() => []);
        let targetPr = prsData.find(p => p.pr_id === prId);

        if (!targetPr) {
          prsData = await getRepoPRs(repoId, "MERGED").catch(() => []);
          targetPr = prsData.find(p => p.pr_id === prId);
        }

        if (!targetPr) {
          prsData = await getRepoPRs(repoId, "DECLINED").catch(() => []);
          targetPr = prsData.find(p => p.pr_id === prId);
        }

        setPr(targetPr);

        // Load cached review from backend (shared across all users)
        const cached = await getPRReview(repoId, prId).catch(() => null);
        if (cached) {
          setReview(cached);
        } else {
          // No cached result — check whether a review is already running
          // (e.g. we started one, then navigated away and came back).
          const { status } = await getPRReviewStatus(repoId, prId).catch(() => ({ status: 'idle' }));
          if (status === 'running') {
            setReviewing(true);
            setTab('review');
            startPolling();
          }
        }
      } catch (err) {
        console.error("Failed to load PR details:", err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [repoId, prId]);

  useEffect(() => {
    if (!repoId || !prId) return;
    setDiffLoading(true);
    getPRDiff(repoId, prId)
      .then(data => setDiff(data))
      .catch(e => setDiffError(e.message))
      .finally(() => setDiffLoading(false));
  }, [repoId, prId]);

  async function handleAnalyze() {
    if (!pr) return;
    setReviewing(true);
    setTab('review');
    try {
      // Server persists the result itself once the analysis finishes, so it's
      // cached even if we navigate away before this fetch resolves.
      const data = await analyzeHybrid(pr.pr_url);
      setReview(data);
      setReviewing(false);
    } catch (e) {
      if (e.status === 409) {
        // Already running (started by us or another tab) — wait for it
        // instead of erroring out or starting a duplicate.
        startPolling();
      } else {
        setReviewing(false);
        alert("Analysis failed: " + e.message);
      }
    }
  }

  async function handlePostReviewComments() {
    if (!review || !repo || !pr) return;
    setPosting(true);
    try {
      const result = await postReviewComments(repo.id, pr.pr_id, review);
      setPostResult(result);
    } catch (e) {
      alert(`Failed to post review comments: ${e.message}`);
    } finally {
      setPosting(false);
    }
  }

  async function handleAddComment(filepath, line, text) {
    try {
      await postPRComment(repo.id, pr.pr_id, text, filepath, line);
      setReviewComments(prev => [...prev, { filepath, line, text }]);
    } catch (e) {
      alert(`Failed to post comment: ${e.message}`);
    }
  }

  const parsedFiles = useMemo(() => diff?.diff ? parseDiff(diff.diff) : [], [diff]);
  const aiIssues = useMemo(() => review ? [
    ...(review.llm_detected_issues || []),
    ...(review.llm_security_concerns || []),
    ...(review.static_analysis_issues || []).map(i => ({ file: i.file, description: `[${i.rule || 'Lint'}] ${i.message}` })),
  ] : [], [review]);

  useEffect(() => {
    if (tab !== 'changes' || parsedFiles.length === 0) return;

    const observer = new IntersectionObserver((entries) => {
      let visiblePath = null;
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          visiblePath = entry.target.dataset.path;
        }
      });
      if (visiblePath) {
        setActiveFile(visiblePath);
      }
    }, {
      root: document.getElementById('diff-scroll-container'),
      rootMargin: '-20% 0px -80% 0px',
      threshold: 0
    });

    Object.values(fileRefs.current).forEach(el => {
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, [tab, parsedFiles]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-white h-full">
        <div className="text-center text-slate-500">
          <Spinner />
          <p className="mt-4 text-sm font-medium">Loading PR details...</p>
        </div>
      </div>
    );
  }

  if (!pr || !repo) {
    return (
      <div className="flex-1 flex items-center justify-center bg-white h-full">
        <div className="text-center text-slate-500">
          <p>PR not found or failed to load.</p>
          <button 
            onClick={() => navigate('/pr-list')}
            className="mt-4 px-4 py-2 bg-brand-50 text-brand-700 rounded-md text-sm font-medium"
          >
            Go back to list
          </button>
        </div>
      </div>
    );
  }

  const initials = pr.author.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
  
  const issueCount = review ? (
    (review.llm_detected_issues?.length || 0) +
    (review.llm_security_concerns?.length || 0) +
    (review.llm_performance_concerns?.length || 0) +
    (review.llm_code_smells?.length || 0) +
    (review.static_analysis_issues?.length || 0)
  ) : 0;

  const securityIssuesCount = review?.llm_security_concerns?.length || 0;
  const staticIssuesCount = review?.static_analysis_issues?.length || 0;

  const riskLevel = review?.risk_level || "UNKNOWN";
  const riskColor = riskLevel === "HIGH" ? "text-rose-600 bg-rose-50 border-rose-200" 
                  : riskLevel === "MEDIUM" ? "text-amber-600 bg-amber-50 border-amber-200"
                  : riskLevel === "LOW" ? "text-emerald-600 bg-emerald-50 border-emerald-200"
                  : "text-slate-600 bg-slate-50 border-slate-200";

  return (
    <div className="flex flex-col h-full bg-[#f8fafc]">
      {/* PR Header (Sticky) */}
      <header className="bg-white border-b border-slate-200 px-6 py-5 flex-shrink-0 z-20 shadow-sm">
        
        {/* Breadcrumb & Back */}
        <div className="text-[13px] text-slate-500 mb-3 flex items-center gap-2">
          <Link to={`/pr-list?repoId=${repo.id}`} className="hover:text-brand-600 flex items-center gap-1 transition-colors">
            <Icon icon="lucide:arrow-left" className="text-[14px]" />
            Back to Pull Requests
          </Link>
          <span className="text-slate-300">/</span>
          <span className="flex items-center gap-1.5">
            <Icon icon="lucide:github" className="text-slate-400" />
            {repo.workspace}
          </span>
          <span className="text-slate-300">/</span>
          <span className="font-medium text-slate-700">{repo.repo_slug}</span>
        </div>

        {/* Title & Meta Row */}
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-2xl font-bold text-slate-900 tracking-tight leading-tight">{pr.title}</h1>
              <span className="text-lg text-slate-400 font-medium">#{pr.pr_id}</span>
            </div>
            
            <div className="flex flex-wrap items-center gap-y-2 gap-x-4 text-[13px] text-slate-600">
              {/* Status Badge */}
              <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md font-bold uppercase tracking-wider text-[11px] border ${
                pr.state === 'OPEN' ? 'bg-[#0052CC]/10 text-[#0052CC] border-[#0052CC]/20'
                : pr.state === 'MERGED' ? 'bg-[#00875A]/10 text-[#00875A] border-[#00875A]/20'
                : 'bg-slate-100 text-slate-600 border-slate-200'
              }`}>
                {pr.state}
              </div>
              
              {/* Author & Time */}
              <div className="flex items-center gap-1.5">
                <div className="w-5 h-5 rounded-full bg-slate-200 flex items-center justify-center text-slate-700 font-bold text-[10px]">{initials}</div>
                <span className="font-medium text-slate-800">{pr.author}</span>
                <span className="text-slate-400">created {timeAgo(pr.created_at)}</span>
              </div>
            </div>
          </div>

          {/* Primary Actions & Overall Score */}
          <div className="flex items-center gap-3 shrink-0 flex-wrap justify-end">
            
            {review && (
              <div className={`flex items-center gap-2 border px-3 py-2 rounded-lg ${riskColor}`}>
                <div className="w-6 h-6 rounded-full bg-white/60 flex items-center justify-center">
                  <Icon icon={riskLevel === 'HIGH' ? "lucide:shield-alert" : "lucide:shield-check"} className="text-[14px] opacity-80" />
                </div>
                <div className="flex flex-col">
                  <span className="text-[10px] font-bold uppercase tracking-wider leading-none opacity-80">ML Risk</span>
                  <span className="text-[13px] font-bold leading-tight">{riskLevel}</span>
                </div>
              </div>
            )}

            {/* Post Comments Button */}
            {review && issueCount > 0 && (
              <button 
                onClick={handlePostReviewComments}
                disabled={posting}
                className="px-4 py-2 bg-amber-100 border border-amber-200 text-amber-800 rounded-lg text-[13px] font-bold hover:bg-amber-200 shadow-sm transition-all flex items-center gap-2 disabled:opacity-50"
              >
                <Icon icon={posting ? "lucide:loader-2" : "lucide:message-square-plus"} className={posting ? "animate-spin" : ""} />
                {posting ? 'Posting...' : `Push Comments to Bitbucket (${issueCount})`}
              </button>
            )}

            <div className="flex flex-col items-end gap-1">
              <button 
                onClick={handleAnalyze}
                disabled={reviewing}
                className="px-4 py-2 bg-white border border-slate-200 rounded-lg text-[13px] font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-900 shadow-sm transition-all flex items-center gap-2 disabled:opacity-50"
              >
                <Icon icon={reviewing ? "lucide:loader-2" : "lucide:refresh-cw"} className={reviewing ? "animate-spin text-brand-500" : "text-slate-400"} />
                {reviewing ? 'Analyzing...' : review ? 'Re-analyze' : 'Run AI Analysis'}
              </button>
              {review?._reviewed_at && (
                <span className="text-[11px] text-slate-400">
                  Last analysed {timeAgo(review._reviewed_at)}
                </span>
              )}
            </div>
          </div>
        </div>
        
        {/* Post Result Success Message */}
        {postResult && (
          <div className="mt-4 p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg text-sm flex items-center gap-2">
            <Icon icon="lucide:check-circle" className="text-emerald-600 text-lg" />
            Successfully posted {postResult.posted} comments to Bitbucket. ({postResult.skipped} skipped)
          </div>
        )}
      </header>

      {/* Tabs */}
      <div className="flex border-b border-slate-200 bg-white px-6 shrink-0 z-10 shadow-sm">
        <button
          onClick={() => setTab('changes')}
          className={`px-4 py-3 text-sm font-semibold border-b-2 transition-colors flex items-center gap-2 ${
            tab === 'changes'
              ? 'border-brand-500 text-brand-700'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          Files Changed
          {parsedFiles.length > 0 && (
            <span className="bg-slate-100 text-slate-500 rounded-full px-2 py-0.5 text-xs border border-slate-200 font-medium">
              {parsedFiles.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setTab('review')}
          className={`px-4 py-3 text-sm font-semibold border-b-2 transition-colors flex items-center gap-2 ${
            tab === 'review'
              ? 'border-brand-500 text-brand-700'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          Review Analysis
          {review && (
            <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${
              riskLevel === "HIGH" ? "bg-rose-100 text-rose-700 border border-rose-200" :
              riskLevel === "MEDIUM" ? "bg-amber-100 text-amber-700 border border-amber-200" :
              "bg-emerald-100 text-emerald-700 border border-emerald-200"
            }`}>
              {riskLevel}
            </span>
          )}
        </button>
      </div>

      {/* Scrollable Content Body */}
      <div className={`flex-1 overflow-hidden flex flex-col ${tab === 'changes' ? 'bg-white' : 'p-6 lg:p-8 overflow-y-auto'}`}>
        <div className={tab === 'changes' ? 'flex-1 flex overflow-hidden' : 'w-full space-y-6'}>

          {tab === 'changes' && (
            <>
              {/* Sidebar File Tree */}
              <div className="w-80 shrink-0 border-r border-slate-200 bg-slate-50 flex flex-col">
                <FileTree 
                  parsedFiles={parsedFiles}
                  activeFile={activeFile}
                  onSelectFile={(path) => {
                    setActiveFile(path);
                    if (fileRefs.current[path]) {
                      fileRefs.current[path].scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }
                  }}
                />
              </div>

              {/* Diff Viewer Area */}
              <div 
                id="diff-scroll-container"
                className="flex-1 overflow-y-auto p-6 bg-white relative"
              >
                <div className="max-w-[1000px] mx-auto space-y-6 pb-[50vh]">
                  {diffLoading && <div className="text-center py-8 text-slate-500"><Spinner /><p className="mt-2 text-sm font-medium">Loading changes...</p></div>}
                  {diffError && <div className="p-4 bg-rose-50 border border-rose-200 text-rose-700 rounded-lg text-sm">{diffError}</div>}
                  {!diffLoading && !diffError && parsedFiles.length === 0 && (
                    <div className="text-center py-8 text-slate-500">No diff available for this PR.</div>
                  )}
                  {!diffLoading && parsedFiles.map((file, i) => (
                    <div 
                      key={i} 
                      ref={el => fileRefs.current[file.path] = el}
                      data-path={file.path}
                    >
                      <FileDiff
                        file={file}
                        onAddComment={handleAddComment}
                        reviewComments={reviewComments}
                        aiIssues={aiIssues}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {tab === 'review' && (
            <>
              {!review && !reviewing && (
            <div className="bg-white border border-slate-200 rounded-xl p-12 text-center shadow-sm">
              <div className="w-16 h-16 bg-brand-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <Icon icon="lucide:sparkles" className="text-brand-500 text-3xl" />
              </div>
              <h2 className="text-xl font-bold text-slate-900 mb-2">Ready to review</h2>
              <p className="text-slate-500 mb-6 max-w-md mx-auto">Click the button below to perform a deep AI analysis on this Pull Request, including semantic checks, security scanning, and code health evaluation.</p>
              <button 
                onClick={handleAnalyze}
                className="px-6 py-3 bg-brand-600 hover:bg-brand-700 text-white rounded-xl font-bold shadow-sm transition-all"
              >
                Run AI Analysis
              </button>
            </div>
          )}

          {reviewing && (
            <div className="bg-white border border-slate-200 rounded-xl p-12 text-center shadow-sm">
              <div className="mx-auto mb-4 w-max">
                <Spinner />
              </div>
              <h2 className="text-lg font-bold text-slate-900 mb-1">Analyzing Pull Request...</h2>
              <p className="text-slate-500">This might take a few moments depending on the size of the diff.</p>
            </div>
          )}

          {review && !reviewing && (
            <>
              {/* Top Summary Stats */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                {/* Stat: ML Risk */}
                <div className={`border rounded-xl p-4 shadow-sm ${riskLevel === 'HIGH' ? 'bg-rose-50 border-rose-200' : riskLevel === 'MEDIUM' ? 'bg-amber-50 border-amber-200' : 'bg-emerald-50 border-emerald-200'}`}>
                  <div className="flex items-center gap-2 mb-2">
                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${riskLevel === 'HIGH' ? 'bg-rose-100' : riskLevel === 'MEDIUM' ? 'bg-amber-100' : 'bg-emerald-100'}`}>
                      <Icon icon={riskLevel === 'HIGH' ? "lucide:shield-alert" : "lucide:shield-check"} className={`text-[14px] ${riskLevel === 'HIGH' ? 'text-rose-600' : riskLevel === 'MEDIUM' ? 'text-amber-600' : 'text-emerald-600'}`} />
                    </div>
                    <span className="text-[12px] font-semibold text-slate-500 uppercase tracking-wider">ML Risk</span>
                  </div>
                  <div className="flex items-baseline gap-1.5">
                    <span className={`text-2xl font-bold ${riskLevel === 'HIGH' ? 'text-rose-700' : riskLevel === 'MEDIUM' ? 'text-amber-700' : 'text-emerald-700'}`}>{riskLevel}</span>
                    <span className={`text-[13px] font-medium ${riskLevel === 'HIGH' ? 'text-rose-600' : riskLevel === 'MEDIUM' ? 'text-amber-600' : 'text-emerald-600'}`}>
                      {review.ml_reasons?.length ? `${review.ml_reasons.length} flags` : 'Score based'}
                    </span>
                  </div>
                </div>

                {/* Stat: Security */}
                <div className={`border rounded-xl p-4 shadow-sm ${securityIssuesCount > 0 ? 'bg-rose-50 border-rose-200' : 'bg-white border-slate-200'}`}>
                  <div className="flex items-center gap-2 mb-2">
                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${securityIssuesCount > 0 ? 'bg-rose-100' : 'bg-emerald-50'}`}>
                      <Icon icon={securityIssuesCount > 0 ? "lucide:shield-alert" : "lucide:shield-check"} className={`text-[14px] ${securityIssuesCount > 0 ? 'text-rose-600' : 'text-emerald-600'}`} />
                    </div>
                    <span className="text-[12px] font-semibold text-slate-500 uppercase tracking-wider">Security</span>
                  </div>
                  <div className="flex items-baseline gap-1.5">
                    <span className={`text-2xl font-bold ${securityIssuesCount > 0 ? 'text-rose-700' : 'text-slate-900'}`}>{securityIssuesCount}</span>
                    <span className={`text-[13px] font-medium ${securityIssuesCount === 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {securityIssuesCount === 0 ? 'No issues' : 'Issues found'}
                    </span>
                  </div>
                </div>

                {/* Stat: Static Analysis */}
                <div className={`border rounded-xl p-4 shadow-sm ${staticIssuesCount > 0 ? 'bg-amber-50 border-amber-200' : 'bg-white border-slate-200'}`}>
                  <div className="flex items-center gap-2 mb-2">
                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${staticIssuesCount > 0 ? 'bg-amber-100' : 'bg-slate-100'}`}>
                      <Icon icon="lucide:code-2" className={`text-[14px] ${staticIssuesCount > 0 ? 'text-amber-600' : 'text-slate-500'}`} />
                    </div>
                    <span className="text-[12px] font-semibold text-slate-500 uppercase tracking-wider">Static Analysis</span>
                  </div>
                  <div className="flex items-baseline gap-1.5">
                    <span className={`text-2xl font-bold ${staticIssuesCount > 0 ? 'text-amber-700' : 'text-slate-900'}`}>{staticIssuesCount}</span>
                    <span className={`text-[13px] font-medium ${staticIssuesCount === 0 ? 'text-emerald-600' : 'text-amber-600'}`}>
                      {staticIssuesCount === 0 ? 'No warnings' : 'Warnings'}
                    </span>
                  </div>
                </div>

                {/* Stat: AI Suggestions */}
                <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-7 h-7 rounded-lg bg-indigo-50 flex items-center justify-center">
                      <Icon icon="lucide:sparkles" className="text-[14px] text-indigo-500" />
                    </div>
                    <span className="text-[12px] font-semibold text-slate-500 uppercase tracking-wider">AI Suggestions</span>
                  </div>
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-2xl font-bold text-slate-900">{issueCount}</span>
                    <span className="text-[13px] text-slate-500">total findings</span>
                  </div>
                </div>
              </div>

              {/* Detailed Findings — Accordion Sections */}
              <div className="space-y-3">
                <h3 className="text-[11px] font-bold text-slate-400 tracking-widest uppercase ml-1 mt-2">
                  Findings
                </h3>

                {/* ML Risk Reasons */}
                {review.ml_reasons?.length > 0 && (
                  <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                    <div
                      onClick={() => setExpandedSection(expandedSection === 'ml_risk' ? null : 'ml_risk')}
                      className={`px-5 py-4 flex items-center justify-between cursor-pointer transition-colors select-none ${expandedSection === 'ml_risk' ? 'bg-slate-50 border-b border-slate-100' : 'hover:bg-slate-50'}`}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${riskLevel === 'HIGH' ? 'bg-rose-100' : 'bg-amber-100'}`}>
                          <Icon icon="lucide:brain-circuit" className={`${riskLevel === 'HIGH' ? 'text-rose-600' : 'text-amber-600'} text-[16px]`} />
                        </div>
                        <div>
                          <h3 className="text-[14px] font-semibold text-slate-900">ML Risk Indicators</h3>
                          <p className="text-[12px] text-slate-500">Heuristics triggered by this PR (commits, diff size, etc.)</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className={`text-[12px] font-bold px-2.5 py-0.5 rounded-full ${riskLevel === 'HIGH' ? 'text-rose-700 bg-rose-100' : 'text-amber-700 bg-amber-100'}`}>
                          {review.ml_reasons.length} Flags
                        </span>
                        <Icon icon={expandedSection === 'ml_risk' ? "lucide:chevron-up" : "lucide:chevron-down"} className="text-slate-400" />
                      </div>
                    </div>
                    {expandedSection === 'ml_risk' && (
                      <div className="divide-y divide-slate-100">
                        {review.ml_reasons.map((reason, idx) => (
                          <div key={idx} className={`px-5 py-3.5 hover:bg-slate-50 transition-colors`}>
                            <div className="flex items-start gap-3">
                              <Icon icon="lucide:info" className="text-slate-400 mt-0.5 text-[14px] shrink-0" />
                              <div className="min-w-0">
                                <p className="text-[13px] font-medium text-slate-900 leading-snug">{reason}</p>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Security */}
                <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                  <div
                    onClick={() => setExpandedSection(expandedSection === 'security' ? null : 'security')}
                    className={`px-5 py-4 flex items-center justify-between cursor-pointer transition-colors select-none ${expandedSection === 'security' ? 'bg-slate-50 border-b border-slate-100' : 'hover:bg-slate-50'}`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${securityIssuesCount > 0 ? 'bg-rose-100' : 'bg-emerald-50'}`}>
                        <Icon icon="lucide:shield" className={`${securityIssuesCount > 0 ? 'text-rose-600' : 'text-emerald-600'} text-[16px]`} />
                      </div>
                      <div>
                        <h3 className="text-[14px] font-semibold text-slate-900">Security Scanning</h3>
                        <p className="text-[12px] text-slate-500">SAST and secret detection</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`text-[12px] font-bold px-2.5 py-0.5 rounded-full ${securityIssuesCount > 0 ? 'text-rose-700 bg-rose-100' : 'text-emerald-700 bg-emerald-100'}`}>
                        {securityIssuesCount} Vulnerabilities
                      </span>
                      <Icon icon={expandedSection === 'security' ? "lucide:chevron-up" : "lucide:chevron-down"} className="text-slate-400" />
                    </div>
                  </div>
                  {expandedSection === 'security' && (
                    <div>
                      {securityIssuesCount === 0 ? (
                        <div className="px-5 py-6 text-sm text-slate-400 text-center flex flex-col items-center gap-2">
                          <Icon icon="lucide:shield-check" className="text-emerald-400 text-2xl" />
                          No security vulnerabilities found.
                        </div>
                      ) : (
                        <div className="divide-y divide-slate-100">
                          {review.llm_security_concerns.map((issue, idx) => (
                            <div key={idx} className="px-5 py-3.5 hover:bg-rose-50/40 transition-colors">
                              <div className="flex items-start gap-3">
                                <Icon icon="lucide:shield-alert" className="text-rose-500 mt-0.5 text-[15px] shrink-0" />
                                <div className="min-w-0">
                                  <p className="text-[13px] font-medium text-slate-900 leading-snug">{issue.description || issue.message}</p>
                                  {(issue.file || issue.line) && (
                                    <p className="text-[11px] font-mono text-slate-400 mt-1">{issue.file}{issue.line ? `:${issue.line}` : ''}</p>
                                  )}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Static Analysis */}
                <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                  <div
                    onClick={() => setExpandedSection(expandedSection === 'static' ? null : 'static')}
                    className={`px-5 py-4 flex items-center justify-between cursor-pointer transition-colors select-none ${expandedSection === 'static' ? 'bg-slate-50 border-b border-slate-100' : 'hover:bg-slate-50'}`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${staticIssuesCount > 0 ? 'bg-amber-100' : 'bg-slate-100'}`}>
                        <Icon icon="lucide:code-2" className={`${staticIssuesCount > 0 ? 'text-amber-600' : 'text-slate-500'} text-[16px]`} />
                      </div>
                      <div>
                        <h3 className="text-[14px] font-semibold text-slate-900">Static Analysis</h3>
                        <p className="text-[12px] text-slate-500">Linting, code smells, complexity</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`text-[12px] font-bold px-2.5 py-0.5 rounded-full ${staticIssuesCount > 0 ? 'text-amber-700 bg-amber-100' : 'text-slate-500 bg-slate-100'}`}>
                        {staticIssuesCount} Warnings
                      </span>
                      <Icon icon={expandedSection === 'static' ? "lucide:chevron-up" : "lucide:chevron-down"} className="text-slate-400" />
                    </div>
                  </div>
                  {expandedSection === 'static' && (
                    <div>
                      {staticIssuesCount === 0 ? (
                        <div className="px-5 py-6 text-sm text-slate-400 text-center flex flex-col items-center gap-2">
                          <Icon icon="lucide:check-circle" className="text-emerald-400 text-2xl" />
                          No static analysis warnings found.
                        </div>
                      ) : (
                        <div className="divide-y divide-slate-100">
                          {review.static_analysis_issues.map((issue, idx) => (
                            <div key={idx} className="px-5 py-3.5 hover:bg-amber-50/40 transition-colors">
                              <div className="flex items-start gap-3">
                                <Icon icon="lucide:alert-triangle" className="text-amber-500 mt-0.5 text-[14px] shrink-0" />
                                <div className="min-w-0">
                                  <p className="text-[13px] font-medium text-slate-900 leading-snug">
                                    {issue.rule && <span className="text-[11px] font-mono text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded mr-2">{issue.rule}</span>}
                                    {issue.message || issue.description}
                                  </p>
                                  {issue.file && (
                                    <p className="text-[11px] font-mono text-slate-400 mt-1">{issue.file}{issue.line ? `:${issue.line}` : ''}</p>
                                  )}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Performance Concerns */}
                {review.llm_performance_concerns?.length > 0 && (
                  <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                    <div
                      onClick={() => setExpandedSection(expandedSection === 'perf' ? null : 'perf')}
                      className={`px-5 py-4 flex items-center justify-between cursor-pointer transition-colors select-none ${expandedSection === 'perf' ? 'bg-slate-50 border-b border-slate-100' : 'hover:bg-slate-50'}`}
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-orange-50 flex items-center justify-center">
                          <Icon icon="lucide:activity" className="text-orange-500 text-[16px]" />
                        </div>
                        <div>
                          <h3 className="text-[14px] font-semibold text-slate-900">Performance</h3>
                          <p className="text-[12px] text-slate-500">Potential bottlenecks and slow paths</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-[12px] font-bold text-orange-700 bg-orange-100 px-2.5 py-0.5 rounded-full">
                          {review.llm_performance_concerns.length}
                        </span>
                        <Icon icon={expandedSection === 'perf' ? "lucide:chevron-up" : "lucide:chevron-down"} className="text-slate-400" />
                      </div>
                    </div>
                    {expandedSection === 'perf' && (
                      <div className="divide-y divide-slate-100">
                        {review.llm_performance_concerns.map((item, idx) => (
                          <div key={idx} className="px-5 py-3.5 hover:bg-orange-50/40 transition-colors">
                            <div className="flex items-start gap-3">
                              <Icon icon="lucide:zap" className="text-orange-400 mt-0.5 text-[14px] shrink-0" />
                              <div className="min-w-0">
                                <p className="text-[13px] font-medium text-slate-900 leading-snug">{item.description || item.message}</p>
                                {item.file && <p className="text-[11px] font-mono text-slate-400 mt-1">{item.file}{item.line ? `:${item.line}` : ''}</p>}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Suggestions / Improvements */}
                {review.llm_improvements?.length > 0 && (
                  <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                    <div
                      onClick={() => setExpandedSection(expandedSection === 'improvements' ? null : 'improvements')}
                      className={`px-5 py-4 flex items-center justify-between cursor-pointer transition-colors select-none ${expandedSection === 'improvements' ? 'bg-slate-50 border-b border-slate-100' : 'hover:bg-slate-50'}`}
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center">
                          <Icon icon="lucide:lightbulb" className="text-indigo-500 text-[16px]" />
                        </div>
                        <div>
                          <h3 className="text-[14px] font-semibold text-slate-900">Suggestions</h3>
                          <p className="text-[12px] text-slate-500">Improvements and best practices</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-[12px] font-bold text-indigo-700 bg-indigo-100 px-2.5 py-0.5 rounded-full">
                          {review.llm_improvements.length}
                        </span>
                        <Icon icon={expandedSection === 'improvements' ? "lucide:chevron-up" : "lucide:chevron-down"} className="text-slate-400" />
                      </div>
                    </div>
                    {expandedSection === 'improvements' && (
                      <div className="divide-y divide-slate-100">
                        {review.llm_improvements.map((item, idx) => (
                          <div key={idx} className="px-5 py-3.5 hover:bg-indigo-50/40 transition-colors">
                            <div className="flex items-start gap-3">
                              <Icon icon="lucide:lightbulb" className="text-indigo-400 mt-0.5 text-[14px] shrink-0" />
                              <div className="min-w-0">
                                <p className="text-[13px] font-medium text-slate-900 leading-snug">{item.description || item.message}</p>
                                {item.file && <p className="text-[11px] font-mono text-slate-400 mt-1">{item.file}{item.line ? `:${item.line}` : ''}</p>}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* General Code Comments */}
                {review.llm_detected_issues?.length > 0 && (
                  <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                    <div
                      onClick={() => setExpandedSection(expandedSection === 'general' ? null : 'general')}
                      className={`px-5 py-4 flex items-center justify-between cursor-pointer transition-colors select-none ${expandedSection === 'general' ? 'bg-slate-50 border-b border-slate-100' : 'hover:bg-slate-50'}`}
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
                          <Icon icon="lucide:message-square" className="text-blue-600 text-[16px]" />
                        </div>
                        <div>
                          <h3 className="text-[14px] font-semibold text-slate-900">Code Comments</h3>
                          <p className="text-[12px] text-slate-500">Logic bugs, architecture flaws</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-[12px] font-bold text-blue-700 bg-blue-100 px-2.5 py-0.5 rounded-full">
                          {review.llm_detected_issues.length}
                        </span>
                        <Icon icon={expandedSection === 'general' ? "lucide:chevron-up" : "lucide:chevron-down"} className="text-slate-400" />
                      </div>
                    </div>
                    {expandedSection === 'general' && (
                      <div className="divide-y divide-slate-100">
                        {review.llm_detected_issues.map((issue, idx) => (
                          <div key={idx} className="px-5 py-3.5 hover:bg-blue-50/40 transition-colors">
                            <div className="flex items-start gap-3">
                              <Icon icon="lucide:message-square" className="text-blue-400 mt-0.5 text-[14px] shrink-0" />
                              <div className="min-w-0">
                                <p className="text-[13px] font-medium text-slate-900 leading-snug">{issue.message || issue.description}</p>
                                {issue.file && <p className="text-[11px] font-mono text-slate-400 mt-1">{issue.file}{issue.line ? `:${issue.line}` : ''}</p>}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
          </>
          )}

          {/* Bottom padding spacer */}
          <div className="h-12"></div>

        </div>
      </div>
    </div>
  );
}
