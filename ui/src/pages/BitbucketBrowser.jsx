import { useEffect, useState } from "react";
import { listBitbucketRepos, refreshBitbucketRepos, addRepo, registerWebhook } from "../api/client";

const LANG_COLORS = {
  Python:     "#3572A5", JavaScript: "#f1e05a", TypeScript: "#2b7489",
  PHP:        "#4F5D95", Java:       "#b07219", Go:         "#00ADD8",
  Ruby:       "#701516", Rust:       "#dea584", "C++":      "#f34b7d",
  C:          "#555555", Swift:      "#F05138", Kotlin:     "#A97BFF",
};

function LangDot({ lang }) {
  const color = LANG_COLORS[lang] || "var(--text-muted)";
  return (
    <span style={{
      width: 9, height: 9, borderRadius: "50%",
      background: color, display: "inline-block", flexShrink: 0,
    }} />
  );
}

function RepoCard({ repo, isConnected, onConnect, connecting }) {
  return (
    <div className={`bb-repo-card${isConnected ? " connected" : ""}`}>
      <div className="bb-repo-header">
        <div>
          <div className="bb-repo-name">{repo.slug}</div>
          <div className="bb-repo-workspace">{repo.workspace}</div>
        </div>
        {isConnected ? (
          <span className="badge badge-green" style={{ flexShrink: 0 }}>✓ Connected</span>
        ) : (
          <button
            className="btn btn-primary btn-sm"
            style={{ flexShrink: 0 }}
            onClick={() => onConnect(repo)}
            disabled={connecting === `${repo.workspace}/${repo.slug}`}
          >
            {connecting === `${repo.workspace}/${repo.slug}` ? "Connecting…" : "Connect"}
          </button>
        )}
      </div>

      {repo.description && (
        <p className="bb-repo-desc">{repo.description}</p>
      )}

      <div className="bb-repo-footer">
        <div className="bb-repo-lang">
          {repo.language && (
            <>
              <LangDot lang={repo.language} />
              {repo.language}
            </>
          )}
        </div>
        <div style={{ display: "flex", gap: 10, fontSize: "0.72rem", color: "var(--text-muted)" }}>
          {repo.is_private && <span>🔒 Private</span>}
          {repo.updated_on && (
            <span>
              {new Date(repo.updated_on).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}


export default function BitbucketBrowser({ connectedRepos, onConnect, onError }) {
  const [repos, setRepos]           = useState([]);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError]           = useState(null);
  const [search, setSearch]         = useState("");
  const [connecting, setConnecting] = useState(null);
  const [workspace, setWorkspace]   = useState("all");
  const [workspaces, setWorkspaces] = useState([]);

  function applyRepos(data) {
    setRepos(data);
    const ws = [...new Set(data.map(r => r.workspace))].sort();
    setWorkspaces(ws);
    setWorkspace("all");
  }

  // Load from cache instantly on mount
  useEffect(() => {
    setLoading(true);
    listBitbucketRepos()
      .then(data => {
        if (data.length > 0) applyRepos(data);
        // If cache is empty, trigger a refresh automatically
        else return refreshBitbucketRepos().then(applyRepos);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  async function handleRefresh() {
    setRefreshing(true);
    setError(null);
    try {
      const data = await refreshBitbucketRepos();
      applyRepos(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setRefreshing(false);
    }
  }

  const connectedSet = new Set(connectedRepos.map(r => `${r.workspace}/${r.repo_slug}`));

  async function handleConnect(repo) {
    const key = `${repo.workspace}/${repo.slug}`;
    setConnecting(key);
    try {
      const added = await addRepo(`${repo.workspace}/${repo.slug}`);
      // Auto-register webhook on the newly connected repo
      if (added?.id) {
        registerWebhook(added.id).catch(() => {});
      }
      onConnect();
    } catch (err) {
      onError(err.message);
    } finally {
      setConnecting(null);
    }
  }

  const filtered = repos.filter(r => {
    const matchWs = workspace === "all" || r.workspace === workspace;
    const matchSearch = !search ||
      r.slug.toLowerCase().includes(search.toLowerCase()) ||
      r.workspace.toLowerCase().includes(search.toLowerCase()) ||
      (r.description || "").toLowerCase().includes(search.toLowerCase());
    return matchWs && matchSearch;
  });

  const connected = filtered.filter(r => connectedSet.has(`${r.workspace}/${r.slug}`));
  const available = filtered.filter(r => !connectedSet.has(`${r.workspace}/${r.slug}`));

  return (
    <div className="bb-page">
      {/* Header */}
      <div className="page-header">
        <div className="page-title">
          <h2 style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="var(--blue)" style={{ flexShrink: 0 }}>
              <path d="M.778 1.211c-.424-.006-.772.337-.778.761v.044l3.352 19.234a1.01 1.01 0 0 0 .99.75h15.33a.753.753 0 0 0 .753-.65L23.78 2.016a.762.762 0 0 0-.778-.805zm13.52 13.188h-4.63L8.022 9.6h7.956z"/>
            </svg>
            Bitbucket Repositories
          </h2>
        </div>
        <p className="page-subtitle">
          Browse all repositories in your connected Bitbucket workspaces.
          Click <strong style={{ color: "var(--text)" }}>Connect</strong> to add a repo for AI review.
        </p>
      </div>

      {/* Webhook info */}
      <div className="webhook-box">
        <div className="webhook-title">
          ⚡ Auto-review with Webhooks
          <span className="badge badge-green" style={{ fontSize: "0.62rem" }}>Auto</span>
        </div>
        <p style={{ fontSize: "0.78rem", color: "var(--text-secondary)", margin: 0 }}>
          Webhooks are registered automatically when you connect a repo. Every new PR will be reviewed and issues posted as inline Bitbucket comments.
        </p>
      </div>

      {/* Filters */}
      <div className="toolbar" style={{ marginTop: 20 }}>
        <div className="search-wrap" style={{ flex: 1 }}>
          <span className="search-icon">⌕</span>
          <input
            className="input search-input"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search repositories…"
          />
        </div>

        {workspaces.length > 1 && (
          <select
            className="input"
            style={{ width: "auto", minWidth: 140 }}
            value={workspace}
            onChange={e => setWorkspace(e.target.value)}
          >
            <option value="all">All workspaces</option>
            {workspaces.map(w => (
              <option key={w} value={w}>{w}</option>
            ))}
          </select>
        )}

        <button
          className="btn btn-secondary btn-sm"
          onClick={handleRefresh}
          disabled={refreshing}
          style={{ flexShrink: 0 }}
        >
          {refreshing ? "Fetching…" : "↻ Refresh"}
        </button>

        <span className="results-count">{filtered.length} repos</span>
      </div>

      {loading && (
        <div className="spinner-wrap">
          <div className="spinner-ring" />
          <span className="spinner-text">Fetching Bitbucket repositories…</span>
        </div>
      )}

      {error && (
        <div className="error-banner" style={{ margin: "16px 0 0" }}>
          <span>{error}</span>
          <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>
            Make sure BITBUCKET_USERNAME and BITBUCKET_APP_PASSWORD are set in .env
          </span>
        </div>
      )}

      {!loading && !error && (
        <>
          {connected.length > 0 && (
            <>
              <div style={{ marginTop: 20, marginBottom: 8, fontSize: "0.75rem", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.1em" }}>
                Connected ({connected.length})
              </div>
              <div className="bb-repo-grid">
                {connected.map(r => (
                  <RepoCard
                    key={`${r.workspace}/${r.slug}`}
                    repo={r}
                    isConnected
                    onConnect={handleConnect}
                    connecting={connecting}
                  />
                ))}
              </div>
            </>
          )}

          {available.length > 0 && (
            <>
              <div style={{ marginTop: 20, marginBottom: 8, fontSize: "0.75rem", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.1em" }}>
                Available ({available.length})
              </div>
              <div className="bb-repo-grid">
                {available.map(r => (
                  <RepoCard
                    key={`${r.workspace}/${r.slug}`}
                    repo={r}
                    isConnected={false}
                    onConnect={handleConnect}
                    connecting={connecting}
                  />
                ))}
              </div>
            </>
          )}

          {filtered.length === 0 && (
            <div className="empty-state" style={{ marginTop: 32 }}>
              <div className="empty-icon">🔍</div>
              No repositories match your search.
            </div>
          )}
        </>
      )}
    </div>
  );
}
