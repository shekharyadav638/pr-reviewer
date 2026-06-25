import { Icon } from '@iconify/react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { getRepo, getRepoPRs, analyzeHybrid, postReviewComments } from '../api/client';
import Spinner from '../components/Spinner';

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
      } catch (err) {
        console.error("Failed to load PR details:", err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [repoId, prId]);

  async function handleAnalyze() {
    if (!pr) return;
    setReviewing(true);
    try {
      const data = await analyzeHybrid(pr.pr_url);
      setReview(data);
    } catch (e) {
      alert("Analysis failed: " + e.message);
    } finally {
      setReviewing(false);
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

            <button 
              onClick={handleAnalyze}
              disabled={reviewing}
              className="px-4 py-2 bg-white border border-slate-200 rounded-lg text-[13px] font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-900 shadow-sm transition-all flex items-center gap-2 disabled:opacity-50"
            >
              <Icon icon={reviewing ? "lucide:loader-2" : "lucide:refresh-cw"} className={reviewing ? "animate-spin text-brand-500" : "text-slate-400"} />
              {reviewing ? 'Analyzing...' : review ? 'Re-analyze' : 'Run AI Analysis'}
            </button>
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

      {/* Scrollable Content Body */}
      <div className="flex-1 overflow-y-auto p-6 lg:p-8">
        <div className="max-w-5xl mx-auto space-y-6">

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
              {/* Top Summary Grid */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Stat: Security */}
                <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                  <div className="flex items-center gap-2 text-slate-500 mb-2">
                    <Icon icon="lucide:alert-triangle" className="text-[15px]" />
                    <span className="text-[12px] font-medium uppercase tracking-wider">Security</span>
                  </div>
                  <div className="flex items-end gap-2">
                    <span className="text-2xl font-bold text-slate-900">{securityIssuesCount}</span>
                    <span className={`text-[13px] mb-1 font-medium flex items-center gap-1 ${securityIssuesCount === 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {securityIssuesCount === 0 ? <><Icon icon="lucide:check-circle" className="text-[12px]" /> Clean</> : 'Issues found'}
                    </span>
                  </div>
                </div>

                {/* Stat: Static Analysis */}
                <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                  <div className="flex items-center gap-2 text-slate-500 mb-2">
                    <Icon icon="lucide:code-2" className="text-[15px]" />
                    <span className="text-[12px] font-medium uppercase tracking-wider">Static Analysis</span>
                  </div>
                  <div className="flex items-end gap-2">
                    <span className="text-2xl font-bold text-slate-900">{staticIssuesCount}</span>
                    <span className={`text-[13px] mb-1 font-medium ${staticIssuesCount === 0 ? 'text-emerald-600' : 'text-amber-600'}`}>
                      {staticIssuesCount === 0 ? 'No warnings' : 'Warnings'}
                    </span>
                  </div>
                </div>

                {/* Stat: AI Issues */}
                <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                  <div className="flex items-center gap-2 text-slate-500 mb-2">
                    <Icon icon="lucide:message-square" className="text-[15px]" />
                    <span className="text-[12px] font-medium uppercase tracking-wider">AI Suggestions</span>
                  </div>
                  <div className="flex items-end gap-2">
                    <span className="text-2xl font-bold text-slate-900">{issueCount}</span>
                    <span className="text-[13px] text-slate-500 mb-1">Total comments to post</span>
                  </div>
                </div>
              </div>

              {/* Main AI Review Section */}
              <div className="bg-white border border-brand-200 rounded-xl shadow-sm overflow-hidden">
                {/* Header */}
                <div className="bg-gradient-to-r from-brand-50 to-white px-5 py-4 border-b border-brand-100 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-brand-500 flex items-center justify-center shadow-sm">
                      <Icon icon="lucide:sparkles" className="text-white text-[16px]" />
                    </div>
                    <div>
                      <h2 className="text-[15px] font-semibold text-slate-900">GPT-4 Executive Summary</h2>
                      <p className="text-[12px] text-slate-500">Comprehensive narrative review of the changes</p>
                    </div>
                  </div>
                </div>
                {/* Content */}
                <div className="p-5 lg:p-6">
                  <div className="prose prose-slate prose-sm max-w-none">
                    <p className="text-[14px] leading-relaxed text-slate-700 whitespace-pre-wrap">
                      {review.llm_summary || "No summary provided by the model."}
                    </p>
                    
                    {/* Render specific highlights if present */}
                    {(review.llm_performance_concerns?.length > 0 || review.llm_improvements?.length > 0) && (
                      <>
                        <h4 className="text-[13px] font-bold text-slate-900 mt-6 mb-3 uppercase tracking-wider">Key Findings</h4>
                        <ul className="space-y-2 text-[14px] text-slate-700 list-none pl-0">
                          {review.llm_performance_concerns?.map((item, i) => (
                            <li key={i} className="flex items-start gap-2 bg-amber-50 p-3 rounded-lg border border-amber-100">
                              <Icon icon="lucide:activity" className="text-amber-500 mt-0.5 shrink-0" />
                              <span><strong>Performance:</strong> {item.description || item.message}</span>
                            </li>
                          ))}
                          {review.llm_improvements?.map((item, i) => (
                            <li key={i} className="flex items-start gap-2 bg-blue-50 p-3 rounded-lg border border-blue-100">
                              <Icon icon="lucide:lightbulb" className="text-blue-500 mt-0.5 shrink-0" />
                              <span><strong>Suggestion:</strong> {item.description || item.message}</span>
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* The 7-Layer Detailed Analysis (Accordions) */}
              <div className="space-y-3">
                <h3 className="text-[13px] font-bold text-slate-400 tracking-wider uppercase ml-1 mb-4 mt-8">
                  Detailed Findings
                </h3>

                {/* Layer: Security Scanning */}
                <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                  <div 
                    onClick={() => setExpandedSection(expandedSection === 'security' ? null : 'security')}
                    className={`px-5 py-4 flex items-center justify-between cursor-pointer transition-colors ${expandedSection === 'security' ? 'bg-slate-50 border-b border-slate-100' : 'hover:bg-slate-50'}`}
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
                      <span className={`text-[12px] font-bold px-2 py-0.5 rounded ${securityIssuesCount > 0 ? 'text-rose-700 bg-rose-100/50' : 'text-emerald-700 bg-emerald-100/50'}`}>
                        {securityIssuesCount} Vulnerabilities
                      </span>
                      <Icon icon={expandedSection === 'security' ? "lucide:chevron-up" : "lucide:chevron-down"} className="text-slate-400" />
                    </div>
                  </div>
                  {/* Content */}
                  {expandedSection === 'security' && (
                    <div className="p-0">
                      {securityIssuesCount === 0 ? (
                        <div className="px-5 py-4 text-sm text-slate-500 text-center italic">No security vulnerabilities found.</div>
                      ) : (
                        review.llm_security_concerns.map((issue, idx) => (
                          <div key={idx} className="border-b border-slate-100 px-5 py-3 last:border-b-0 hover:bg-slate-50 transition-colors">
                            <div className="flex items-start gap-3">
                              <Icon icon="lucide:shield-alert" className="text-rose-500 mt-0.5 text-[16px]" />
                              <div>
                                <p className="text-[13px] font-medium text-slate-900 mb-1">{issue.description || issue.message}</p>
                                <p className="text-[12px] font-mono text-slate-500">{issue.file}{issue.line ? `:${issue.line}` : ''}</p>
                              </div>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>

                {/* Layer: Static Analysis */}
                <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                  <div 
                    onClick={() => setExpandedSection(expandedSection === 'static' ? null : 'static')}
                    className={`px-5 py-4 flex items-center justify-between cursor-pointer transition-colors ${expandedSection === 'static' ? 'bg-slate-50 border-b border-slate-100' : 'hover:bg-slate-50'}`}
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
                      <span className={`text-[12px] font-bold px-2 py-0.5 rounded ${staticIssuesCount > 0 ? 'text-amber-700 bg-amber-100/50' : 'text-slate-600 bg-slate-100'}`}>
                        {staticIssuesCount} Warnings
                      </span>
                      <Icon icon={expandedSection === 'static' ? "lucide:chevron-up" : "lucide:chevron-down"} className="text-slate-400" />
                    </div>
                  </div>
                  {/* Content */}
                  {expandedSection === 'static' && (
                    <div className="p-0">
                      {staticIssuesCount === 0 ? (
                        <div className="px-5 py-4 text-sm text-slate-500 text-center italic">No static analysis warnings found.</div>
                      ) : (
                        review.static_analysis_issues.map((issue, idx) => (
                          <div key={idx} className="border-b border-slate-100 px-5 py-3 last:border-b-0 hover:bg-slate-50 transition-colors">
                            <div className="flex items-start gap-3">
                              <Icon icon="lucide:alert-triangle" className="text-amber-500 mt-0.5 text-[14px]" />
                              <div>
                                <p className="text-[13px] font-medium text-slate-900 mb-0.5">[{issue.rule || 'Lint'}] {issue.message || issue.description}</p>
                                <p className="text-[12px] font-mono text-slate-500">{issue.file}{issue.line ? `:${issue.line}` : ''}</p>
                              </div>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>

                {/* Layer: General AI Issues */}
                {review.llm_detected_issues?.length > 0 && (
                  <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                    <div 
                      onClick={() => setExpandedSection(expandedSection === 'general' ? null : 'general')}
                      className={`px-5 py-4 flex items-center justify-between cursor-pointer transition-colors ${expandedSection === 'general' ? 'bg-slate-50 border-b border-slate-100' : 'hover:bg-slate-50'}`}
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
                          <Icon icon="lucide:message-square" className="text-blue-600 text-[16px]" />
                        </div>
                        <div>
                          <h3 className="text-[14px] font-semibold text-slate-900">General Code Comments</h3>
                          <p className="text-[12px] text-slate-500">Logic bugs, architecture flaws</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-[12px] font-bold text-blue-700 bg-blue-100/50 px-2 py-0.5 rounded">
                          {review.llm_detected_issues.length} Comments
                        </span>
                        <Icon icon={expandedSection === 'general' ? "lucide:chevron-up" : "lucide:chevron-down"} className="text-slate-400" />
                      </div>
                    </div>
                    {/* Content */}
                    {expandedSection === 'general' && (
                      <div className="p-0">
                        {review.llm_detected_issues.map((issue, idx) => (
                          <div key={idx} className="border-b border-slate-100 px-5 py-3 last:border-b-0 hover:bg-slate-50 transition-colors">
                            <div className="flex items-start gap-3">
                              <Icon icon="lucide:message-square" className="text-blue-500 mt-0.5 text-[14px]" />
                              <div>
                                <p className="text-[13px] font-medium text-slate-900 mb-0.5">{issue.message || issue.description}</p>
                                <p className="text-[12px] font-mono text-slate-500">{issue.file}{issue.line ? `:${issue.line}` : ''}</p>
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

          {/* Bottom padding spacer */}
          <div className="h-12"></div>

        </div>
      </div>
    </div>
  );
}
