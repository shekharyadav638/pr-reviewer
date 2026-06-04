import { useState } from "react";
import { addRepo, deleteRepo, indexRepo, fetchRepoPRs, syncRepo, registerWebhook } from "../api/client";

function statusDotClass(repo) {
  if (repo.index_status  === "indexing")  return "repo-dot repo-dot-indexing";
  if (repo.clone_status  === "cloning")   return "repo-dot repo-dot-cloning";
  if (repo.graph_status  === "building")  return "repo-dot repo-dot-building";
  if (repo.index_status  === "indexed")   return "repo-dot repo-dot-indexed";
  if (repo.index_status  === "error" || repo.clone_status === "error") return "repo-dot repo-dot-error";
  return "repo-dot repo-dot-pending";
}

function BranchProgressBar({ repo }) {
  const isBusy =
    repo.clone_status === "cloning" ||
    repo.index_status === "indexing" ||
    repo.graph_status === "building";

  if (!isBusy && !repo.current_branch) return null;

  const pct   = repo.index_progress || repo.clone_progress || 0;
  const total = repo.total_branches  || 0;
  const cur   = repo.current_branch  || "";

  const label = cur
    ? `${cur}${total > 1 ? ` (${Math.round(pct / 100 * total)}/${total})` : ""}`
    : `${pct}%`;

  const color =
    repo.clone_status  === "cloning"  ? "orange" :
    repo.graph_status  === "building" ? "purple" : "blue";

  return (
    <div className="repo-progress">
      {repo.clone_status === "cloning"  && "Cloning "}
      {repo.graph_status === "building" && "Building graph "}
      {repo.index_status === "indexing" && "Indexing "}
      <span style={{ fontFamily: "var(--font-mono)", color: "var(--text)" }}>{label}</span>
      <div className="repo-progress-bar">
        <div className={`repo-progress-fill ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}


function RepoItem({
  repo, isSelected, selectedView,
  onSelectSource, onSelectPRs, onIndex, onSync, onFetch, onDelete, onWebhook, syncing, webhooking,
}) {
  const [open, setOpen] = useState(false);

  const busy = repo.clone_status === "cloning" ||
               repo.index_status === "indexing" ||
               repo.graph_status === "building";

  const indexedBranches = repo.indexed_branches || [];
  const isIndexed       = repo.index_status === "indexed";

  return (
    <div>
      <div
        className={`repo-row${isSelected ? " selected" : ""}`}
        onClick={() => { onSelectSource(repo.id); setOpen(v => !v); }}
      >
        <span className={statusDotClass(repo)} />
        <div className="repo-info">
          <div className="repo-slug">{repo.repo_slug}</div>
          <div className="repo-workspace">
            {repo.workspace}
            {isIndexed && indexedBranches.length > 0 && (
              <span style={{ marginLeft: 5, color: "var(--green)", fontSize: "0.62rem" }}>
                · {indexedBranches.length} branch{indexedBranches.length !== 1 ? "es" : ""}
              </span>
            )}
          </div>
        </div>
        <span className={`repo-chevron${open ? " open" : ""}`}>▶</span>
      </div>

      <BranchProgressBar repo={repo} />

      {open && (
        <div className="repo-submenu">
          <div
            className={`nav-item${isSelected && selectedView === "source" ? " active" : ""}`}
            style={{ paddingLeft: 24 }}
            onClick={() => onSelectSource(repo.id)}
          >
            <span className="nav-item-icon">📁</span>
            <span className="nav-item-label">Source</span>
          </div>
          <div
            className={`nav-item${isSelected && selectedView === "prs" ? " active" : ""}`}
            style={{ paddingLeft: 24 }}
            onClick={() => onSelectPRs(repo.id)}
          >
            <span className="nav-item-icon">⎇</span>
            <span className="nav-item-label">Pull Requests</span>
            {repo.pr_count > 0 && (
              <span className="nav-item-badge">{repo.pr_count}</span>
            )}
          </div>


          <div className="repo-actions">
            <button
              className="btn btn-secondary btn-sm"
              onClick={e => { e.stopPropagation(); onIndex(repo.id); }}
              disabled={busy}
              title="Fetch all branches from Bitbucket and index each one"
            >
              {busy
                ? (repo.current_branch
                    ? `Indexing ${repo.current_branch}…`
                    : `${repo.index_progress || 0}%…`)
                : isIndexed ? "Re-index all" : "Index all branches"}
            </button>
            <button
              className="btn btn-secondary btn-sm"
              onClick={e => { e.stopPropagation(); onSync(repo.id); }}
              disabled={syncing === repo.id || busy}
            >
              {syncing === repo.id ? "Syncing…" : "↻ Sync all"}
            </button>
            <button
              className="btn btn-secondary btn-sm"
              onClick={e => { e.stopPropagation(); onFetch(repo.id); }}
              disabled={repo.pr_fetch_status === "fetching"}
            >
              {repo.pr_fetch_status === "fetching" ? "Fetching…" : "Fetch PRs"}
            </button>
            <button
              className="btn btn-secondary btn-sm"
              onClick={e => { e.stopPropagation(); onWebhook(repo.id); }}
              disabled={webhooking === repo.id}
              title="Register PR Guardian webhook on this Bitbucket repo"
            >
              {webhooking === repo.id ? "Registering…" : "⚡ Webhook"}
            </button>
            <button
              className="btn btn-danger btn-sm"
              onClick={e => { e.stopPropagation(); onDelete(repo); }}
            >Remove</button>
          </div>

          {(repo.index_error || repo.clone_error || repo.graph_error) && (
            <div className="repo-error">
              {repo.clone_error || repo.graph_error || repo.index_error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function Sidebar({
  repos, selectedRepoId, selectedView,
  onSelectRepo, onSelectPRs, onSelectSource, onReposChanged, onError, onBrowseBitbucket,
}) {
  const [addOpen, setAddOpen]     = useState(false);
  const [repoUrl, setRepoUrl]     = useState("");
  const [adding, setAdding]       = useState(false);
  const [syncing, setSyncing]     = useState(null);
  const [webhooking, setWebhooking] = useState(null);
  const [webhookMsg, setWebhookMsg] = useState("");

  async function handleAdd(e) {
    e.preventDefault();
    if (!repoUrl.trim()) return;
    setAdding(true);
    try {
      await addRepo(repoUrl.trim());
      setRepoUrl(""); setAddOpen(false); onReposChanged();
    } catch (err) { onError(err.message); }
    finally { setAdding(false); }
  }

  async function handleIndex(repoId) {
    try { await indexRepo(repoId); onReposChanged(); }
    catch (err) { onError(err.message); }
  }

  async function handleSync(repoId) {
    setSyncing(repoId);
    try { await syncRepo(repoId); onReposChanged(); }
    catch (err) { onError(err.message); }
    finally { setSyncing(null); }
  }

  async function handleFetch(repoId) {
    try { await fetchRepoPRs(repoId); onReposChanged(); }
    catch (err) { onError(err.message); }
  }

  async function handleWebhook(repoId) {
    setWebhooking(repoId);
    setWebhookMsg("");
    try {
      const res = await registerWebhook(repoId);
      if (res.status === "registered") setWebhookMsg("✓ Webhook registered");
      else if (res.status === "already_registered") setWebhookMsg("✓ Already registered");
      else if (res.status === "permission_denied") setWebhookMsg("✗ App password missing Webhooks scope");
      else setWebhookMsg(res.message || "Done");
      setTimeout(() => setWebhookMsg(""), 4000);
    } catch (err) {
      onError(err.message);
    } finally {
      setWebhooking(null);
    }
  }

  async function handleDelete(repo) {
    if (!window.confirm(`Remove "${repo.display_name || repo.repo_slug}"?`)) return;
    try {
      await deleteRepo(repo.id);
      if (selectedRepoId === repo.id) onSelectRepo(null);
      onReposChanged();
    } catch (err) { onError(err.message); }
  }

  return (
    <aside className="app-sidebar">
      {/* Logo */}
      <div className="sidebar-logo">
        <div className="sidebar-logo-icon">🛡</div>
        <div className="sidebar-logo-text">
          <div className="sidebar-logo-name">PR Guardian</div>
          <div className="sidebar-logo-sub">AI code review</div>
        </div>
      </div>

      <div className="sidebar-scroll">
        {/* Bitbucket Browse */}
        <div className="sidebar-section" style={{ paddingTop: 10 }}>
          <div
            className={`bb-browse-btn${selectedView === "bitbucket" ? " active" : ""}`}
            onClick={onBrowseBitbucket}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style={{ flexShrink: 0 }}>
              <path d="M.778 1.211c-.424-.006-.772.337-.778.761v.044l3.352 19.234a1.01 1.01 0 0 0 .99.75h15.33a.753.753 0 0 0 .753-.65L23.78 2.016a.762.762 0 0 0-.778-.805zm13.52 13.188h-4.63L8.022 9.6h7.956z"/>
            </svg>
            <span>Browse Bitbucket</span>
          </div>
        </div>

        {/* Repositories */}
        <div className="sidebar-section">
          <div className="sidebar-section-header">
            <span className="sidebar-section-title">My Repos</span>
            <button
              className="sidebar-add-btn"
              title="Add repository by URL"
              onClick={() => setAddOpen(v => !v)}
            >+</button>
          </div>

          {addOpen && (
            <form onSubmit={handleAdd} style={{ padding: "0 12px 10px" }}>
              <input
                autoFocus
                className="input input-sm"
                value={repoUrl}
                onChange={e => setRepoUrl(e.target.value)}
                placeholder="workspace/repo or git URL"
                disabled={adding}
                style={{ marginBottom: 6 }}
              />
              <div className="flex gap-2">
                <button type="submit" className="btn btn-primary btn-sm" disabled={adding || !repoUrl.trim()} style={{ flex: 1 }}>
                  {adding ? "Adding…" : "Add"}
                </button>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setAddOpen(false)}>✕</button>
              </div>
            </form>
          )}

          {repos.length === 0 && !addOpen && (
            <div style={{ padding: "8px 14px 4px", fontSize: "0.75rem", color: "var(--text-muted)" }}>
              No repos connected yet.
            </div>
          )}

          {webhookMsg && (
            <div style={{ padding: "4px 14px", fontSize: "0.75rem",
              color: webhookMsg.startsWith("✓") ? "var(--green)" : "var(--red)" }}>
              {webhookMsg}
            </div>
          )}

          {repos.map(repo => (
            <RepoItem
              key={repo.id}
              repo={repo}
              isSelected={selectedRepoId === repo.id}
              selectedView={selectedView}
              onSelectSource={onSelectSource}
              onSelectPRs={onSelectPRs}
              onIndex={handleIndex}
              onSync={handleSync}
              onFetch={handleFetch}
              onDelete={handleDelete}
              onWebhook={handleWebhook}
              syncing={syncing}
              webhooking={webhooking}
            />
          ))}
        </div>

        {/* Webhook hint */}
        <div style={{
          margin: "12px 12px 0",
          padding: "10px 12px",
          background: "var(--surface-2)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
          fontSize: "0.72rem",
          color: "var(--text-muted)",
          lineHeight: 1.5,
        }}>
          <div style={{ fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 }}>
            ⚡ Auto-review with webhooks
          </div>
          Connect Bitbucket webhooks to auto-review every new PR.
          <div style={{ marginTop: 6 }}>
            <span onClick={onBrowseBitbucket} style={{ color: "var(--blue)", cursor: "pointer", textDecoration: "underline" }}>
              Set up webhook →
            </span>
          </div>
        </div>
      </div>
    </aside>
  );
}
