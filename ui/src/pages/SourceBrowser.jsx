import { Icon } from '@iconify/react';
import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { Link, useLocation } from "react-router-dom";
import { listBranches, browseSource, readSourceFile, syncRepo, getRepo, getSourceHeadCommit } from "../api/client";

function BranchDropdown({ branches, value, onChange }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return branches.filter(b => !term || b.toLowerCase().includes(term));
  }, [branches, query]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 hover:bg-slate-100 rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-slate-700 transition-colors"
      >
        <Icon icon="lucide:git-branch" className="text-slate-400 text-[14px]" />
        {value || "Select branch"}
        <Icon icon="lucide:chevron-down" className="text-slate-400 text-[12px]" />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1.5 w-64 bg-white border border-slate-200 rounded-lg shadow-lg z-30 overflow-hidden">
          <div className="p-2 border-b border-slate-100">
            <div className="relative">
              <Icon icon="lucide:search" className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-[12px]" />
              <input
                autoFocus
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Find a branch"
                className="w-full pl-7 pr-2 py-1.5 bg-slate-50 border border-slate-200 focus:border-brand-400 rounded-md text-[13px] outline-none"
              />
            </div>
          </div>
          <div className="max-h-64 overflow-y-auto py-1">
            {filtered.length === 0 && (
              <div className="px-3 py-2 text-[13px] text-slate-400">No matching branches</div>
            )}
            {filtered.map(b => (
              <button
                key={b}
                onClick={() => { onChange(b); setOpen(false); setQuery(""); }}
                className={`w-full flex items-center gap-2 px-3 py-1.5 text-[13px] text-left hover:bg-slate-50 transition-colors ${
                  b === value ? 'text-brand-700 font-medium bg-brand-50/60' : 'text-slate-700'
                }`}
              >
                <Icon icon="lucide:check" className={`text-[12px] shrink-0 ${b === value ? 'opacity-100' : 'opacity-0'}`} />
                <span className="truncate">{b}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const CODE_EXTENSIONS = new Set(["py", "js", "jsx", "ts", "tsx", "go", "java", "sh", "rb", "php"]);

function FileIcon({ type, name }) {
  if (type === "dir") return <Icon icon="lucide:folder" className="text-brand-500 text-[16px] shrink-0" />;
  const ext = (name || "").split(".").pop().toLowerCase();
  const icon = ext === "json" ? "lucide:file-json"
    : ext === "md" ? "lucide:file-text"
    : (ext === "yml" || ext === "yaml") ? "lucide:file-cog"
    : CODE_EXTENSIONS.has(ext) ? "lucide:file-code"
    : "lucide:file";
  return <Icon icon={icon} className="text-slate-400 text-[16px] shrink-0" />;
}

function formatSize(bytes) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function timeAgo(dateString) {
  if (!dateString) return "";
  const seconds = Math.floor((new Date() - new Date(dateString)) / 1000);
  if (seconds < 60) return "just now";
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateString).toLocaleDateString();
}

export default function SourceBrowser({ repo: propRepo }) {
  const location = useLocation();
  const searchParams = new URLSearchParams(location.search);
  const urlRepoId = searchParams.get('repoId');

  const [repo, setRepo]           = useState(propRepo || null);
  const [branches, setBranches]   = useState([]);
  const [branch, setBranch]       = useState("");
  const [path, setPath]           = useState("");
  const [entries, setEntries]     = useState([]);
  const [headCommit, setHeadCommit] = useState(null);
  const [file, setFile]           = useState(null);
  const [filter, setFilter]       = useState("");
  const [loading, setLoading]     = useState(false);
  const [syncing, setSyncing]     = useState(false);
  const [error, setError]         = useState("");

  const repoId = repo?.id || urlRepoId;

  // Fetch repo if only repoId is provided via URL
  useEffect(() => {
    if (!propRepo && urlRepoId) {
      getRepo(urlRepoId).then(setRepo).catch(console.error);
    } else if (propRepo) {
      setRepo(propRepo);
    }
  }, [propRepo, urlRepoId]);

  // Load branches, then browse root of the first one
  useEffect(() => {
    if (!repoId) return;
    setBranch("");
    setBranches([]);
    setEntries([]);
    setFile(null);
    setPath("");
    listBranches(repoId)
      .then(data => {
        const list = data.branches || [];
        setBranches(list);
        const selected = list[0] || "";
        setBranch(selected);
        return selected;
      })
      .then(selected => { if (selected) browseDir("", selected); })
      .catch(() => {});
  }, [repoId]);

  // Browse directory on the currently-selected branch
  const browseDir = useCallback((p = "", br = "") => {
    if (!repoId) return;
    const activeBranch = br || branch;
    if (!activeBranch) return;
    setLoading(true);
    setFile(null);
    setError("");
    browseSource(repoId, p, activeBranch)
      .then(data => { setEntries(Array.isArray(data) ? data : []); setPath(p); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
    getSourceHeadCommit(repoId, activeBranch).then(setHeadCommit).catch(() => setHeadCommit(null));
  }, [repoId, branch]);

  function openEntry(entry) {
    if (entry.type === "dir") {
      browseDir(entry.path);
    } else {
      setLoading(true);
      setError("");
      readSourceFile(repoId, entry.path, branch)
        .then(data => setFile(data))
        .catch(e => setError(e.message))
        .finally(() => setLoading(false));
    }
  }

  async function handleBranchChange(newBranch) {
    if (newBranch === branch) return;
    setBranch(newBranch);
    setPath("");
    setFile(null);
    setFilter("");
    browseDir("", newBranch);
  }

  async function handleSync() {
    setSyncing(true);
    setError("");
    try {
      await syncRepo(repoId);
      browseDir(path);
    } catch (e) {
      setError(e.message);
    } finally {
      setSyncing(false);
    }
  }

  const crumbs = () => {
    if (!path) return [{ label: repo?.repo_slug || "root", path: "" }];
    const parts = path.split("/");
    return [
      { label: repo?.repo_slug || "root", path: "" },
      ...parts.map((p, i) => ({ label: p, path: parts.slice(0, i + 1).join("/") })),
    ];
  };

  const visibleEntries = useMemo(() => {
    const term = filter.toLowerCase();
    return [...entries]
      .filter(e => !term || e.name.toLowerCase().includes(term))
      .sort((a, b) => {
        if (a.type === b.type) return a.name.localeCompare(b.name);
        return a.type === "dir" ? -1 : 1;
      });
  }, [entries, filter]);

  const indexedCount = repo?.indexed_branches?.length || 0;
  const totalBranchCount = repo?.branches?.length || branches.length;

  if (!repo) {
    return (
      <div className="p-10 text-slate-500 text-sm">
        Select a repository from the sidebar.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0 bg-[#f8fafc]">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex-shrink-0 z-20 shadow-sm">
        <div className="text-[13px] text-slate-500 mb-2 flex items-center gap-2">
          <Link to={`/pr-list?repoId=${repo.id}`} className="hover:text-brand-600 flex items-center gap-1 transition-colors">
            <Icon icon="lucide:arrow-left" className="text-[14px]" />
            Back to Pull Requests
          </Link>
          <span className="text-slate-300">/</span>
          <Icon icon="mdi:bitbucket" className="text-[#0052CC] text-[14px]" />
          <span>{repo.workspace}</span>
          <span className="text-slate-300">/</span>
          <span className="font-medium text-slate-700">{repo.repo_slug}</span>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">Source</h1>

          <div className="flex items-center gap-2">
            <BranchDropdown branches={branches} value={branch} onChange={handleBranchChange} />

            <button
              onClick={handleSync}
              disabled={syncing}
              className="flex items-center gap-1.5 text-[13px] font-medium text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 hover:text-slate-900 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
            >
              <Icon icon="lucide:refresh-cw" className={`text-[13px] ${syncing ? 'animate-spin' : ''}`} />
              {syncing ? 'Syncing…' : 'Sync'}
            </button>
          </div>
        </div>

        {error && <p className="text-red-500 text-[13px] mt-2">{error}</p>}
      </header>

      <div className="flex flex-1 min-h-0">
        {/* Main content */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0">
          {/* Toolbar: breadcrumb path + filter */}
          <div className="flex items-center justify-between gap-4 px-6 py-3 border-b border-slate-200 bg-white flex-shrink-0">
            <div className="text-[13px] flex items-center flex-wrap min-w-0">
              {crumbs().map((c, i, arr) => (
                <span key={c.path} className="flex items-center min-w-0">
                  {i > 0 && <span className="mx-1.5 text-slate-300">/</span>}
                  <button
                    onClick={() => { setFile(null); browseDir(c.path); }}
                    className={`truncate hover:text-brand-600 transition-colors ${
                      i === arr.length - 1 ? 'text-slate-900 font-semibold' : 'text-brand-600 font-medium'
                    }`}
                  >{c.label}</button>
                </span>
              ))}
            </div>

            {!file && (
              <div className="relative shrink-0">
                <Icon icon="lucide:search" className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-[13px]" />
                <input
                  type="text"
                  value={filter}
                  onChange={e => setFilter(e.target.value)}
                  placeholder="Filter files"
                  className="pl-8 pr-3 py-1.5 w-48 bg-slate-50 border border-slate-200 focus:border-brand-400 rounded-lg text-[13px] outline-none transition-colors"
                />
              </div>
            )}
          </div>

          {/* Latest commit banner */}
          {!file && headCommit && (
            <div className="flex items-center gap-2 px-6 py-2.5 border-b border-slate-200 bg-slate-50 text-[13px] text-slate-600 flex-shrink-0">
              <Icon icon="lucide:git-commit-horizontal" className="text-slate-400 text-[14px] shrink-0" />
              <span className="font-medium text-slate-800 truncate">{headCommit.message}</span>
              <span className="text-slate-400">·</span>
              <span className="truncate">{headCommit.author}</span>
              <span className="text-slate-400">·</span>
              <span className="font-mono text-[12px] text-slate-500">{headCommit.hash}</span>
              <span className="text-slate-400 ml-auto shrink-0">{timeAgo(headCommit.date)}</span>
            </div>
          )}

          {/* Content */}
          <div className="flex-1 overflow-auto bg-white">
            {loading && (
              <div className="p-6 text-slate-500 text-sm">Loading…</div>
            )}

            {!loading && !file && (
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="border-b border-slate-200 text-[12px] uppercase tracking-wider text-slate-400">
                    <th className="px-6 py-2.5 font-semibold">Name</th>
                    <th className="px-6 py-2.5 font-semibold text-right w-32">Size</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleEntries.length === 0 && (
                    <tr><td colSpan={2} className="px-6 py-8 text-slate-400 text-sm">Empty directory</td></tr>
                  )}
                  {visibleEntries.map(entry => (
                    <tr
                      key={entry.path}
                      onClick={() => openEntry(entry)}
                      className="cursor-pointer border-b border-slate-100 hover:bg-slate-50 transition-colors"
                    >
                      <td className="px-6 py-2.5 text-[14px]">
                        <span className="flex items-center gap-2.5">
                          <FileIcon type={entry.type} name={entry.name} />
                          <span className={entry.type === "dir" ? "text-brand-700 font-medium" : "text-slate-700"}>
                            {entry.name}
                          </span>
                        </span>
                      </td>
                      <td className="px-6 py-2.5 text-[13px] text-slate-400 text-right font-mono">
                        {entry.type === "file" && formatSize(entry.size)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {!loading && file && (
              <div>
                <div className="px-6 py-2.5 border-b border-slate-200 bg-slate-50 text-[13px] text-slate-500 flex justify-between items-center">
                  <span className="font-mono">{file.path}</span>
                  <button onClick={() => setFile(null)} className="flex items-center gap-1 text-brand-600 hover:text-brand-700 font-medium">
                    <Icon icon="lucide:arrow-left" className="text-[13px]" /> Back
                  </button>
                </div>
                <pre className="m-0 py-4 text-slate-800 text-[13px] leading-relaxed font-mono overflow-x-auto">
                  {file.content.split("\n").map((line, i) => (
                    <div key={i} className="flex">
                      <span className="text-slate-400 select-none min-w-[48px] pr-4 pl-2 text-right text-[12px] shrink-0 border-r border-slate-200">
                        {i + 1}
                      </span>
                      <span className="pl-4 whitespace-pre">{line}</span>
                    </div>
                  ))}
                </pre>
              </div>
            )}
          </div>
        </div>

        {/* Repository details panel */}
        <aside className="w-72 border-l border-slate-200 bg-white p-5 overflow-y-auto flex-shrink-0 hidden lg:block">
          <h3 className="text-[13px] font-semibold text-slate-900 mb-4 flex items-center gap-1.5">
            <Icon icon="lucide:info" className="text-slate-400 text-[14px]" />
            Repository details
          </h3>
          <dl className="space-y-4 text-[13px]">
            <div>
              <dt className="text-slate-400 mb-0.5">Last synced</dt>
              <dd className="text-slate-800 font-medium">{timeAgo(repo.indexed_at || repo.cloned_at) || '—'}</dd>
            </div>
            <div>
              <dt className="text-slate-400 mb-0.5">Branches indexed</dt>
              <dd className="text-slate-800 font-medium">{indexedCount} / {totalBranchCount || indexedCount}</dd>
            </div>
            <div>
              <dt className="text-slate-400 mb-0.5">Open pull requests</dt>
              <dd className="text-slate-800 font-medium">{repo.pr_count ?? 0}</dd>
            </div>
            <div>
              <dt className="text-slate-400 mb-0.5">Clone size</dt>
              <dd className="text-slate-800 font-medium">{repo.clone_size_mb ? `${repo.clone_size_mb} MB` : '—'}</dd>
            </div>
            <div>
              <dt className="text-slate-400 mb-0.5">Index status</dt>
              <dd>
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[12px] font-medium ${
                  repo.index_status === 'indexed' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'
                }`}>
                  {repo.index_status}
                </span>
              </dd>
            </div>
          </dl>

          <a
            href={`https://bitbucket.org/${repo.workspace}/${repo.repo_slug}/src/${branch}/`}
            target="_blank" rel="noreferrer"
            className="mt-6 flex items-center justify-center gap-2 w-full text-[13px] font-medium text-slate-600 bg-slate-50 border border-slate-200 hover:bg-slate-100 hover:text-slate-900 px-3 py-2 rounded-lg transition-colors"
          >
            <Icon icon="mdi:bitbucket" className="text-[#0052CC] text-[14px]" />
            View on Bitbucket
          </a>
        </aside>
      </div>
    </div>
  );
}
