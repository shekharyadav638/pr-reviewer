import { useEffect, useState, useCallback } from "react";
import { useLocation } from "react-router-dom";
import { listBranches, browseSource, readSourceFile, syncRepo, getRepo } from "../api/client";

function FileIcon({ type, name }) {
  if (type === "dir") return <span style={{ marginRight: 6 }}>📁</span>;
  const ext = (name || "").split(".").pop().toLowerCase();
  const icons = {
    py: "🐍", js: "🟨", jsx: "⚛️", ts: "🔷", tsx: "⚛️",
    json: "📋", md: "📝", yml: "⚙️", yaml: "⚙️",
    css: "🎨", html: "🌐", go: "🐹", java: "☕",
    sh: "⚙️", env: "⚙️",
  };
  return <span style={{ marginRight: 6 }}>{icons[ext] || "📄"}</span>;
}

function formatSize(bytes) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
  const [file, setFile]           = useState(null);
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
  }, [repoId, branch]);

  // Keep backward-compat alias used in JSX below
  const browse = browseDir;

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

  if (!repo) {
    return (
      <div style={{ padding: 40, color: "var(--text-muted)" }}>
        Select a repository from the sidebar.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      {/* Toolbar */}
      <div style={{
        display: "flex", alignItems: "center", gap: 12,
        padding: "10px 20px", borderBottom: "1px solid var(--border)",
        background: "var(--surface)", flexShrink: 0,
      }}>
        <span style={{ fontWeight: 600, fontSize: "0.95rem", color: "var(--text)" }}>
          {repo.display_name || repo.repo_slug}
        </span>

        {/* Branch selector */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>⎇</span>
          <select
            value={branch}
            onChange={e => handleBranchChange(e.target.value)}
            style={{
              background: "var(--surface-2)", color: "var(--text)",
              border: "1px solid var(--border)", borderRadius: 6,
              padding: "4px 8px", fontSize: "0.83rem", cursor: "pointer",
              outline: "none",
            }}
          >
            {branches.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>

        <button
          onClick={handleSync}
          disabled={syncing}
          style={{
            background: syncing ? "var(--surface-2)" : "var(--green-bg)",
            color: "var(--green)", border: "1px solid var(--green-border)",
            borderRadius: 6, padding: "4px 12px", fontSize: "0.8rem",
            fontWeight: 600, cursor: syncing ? "default" : "pointer",
          }}
        >
          {syncing ? "Syncing…" : "↻ Sync"}
        </button>

        {error && (
          <span style={{ color: "var(--red)", fontSize: "0.8rem", flex: 1 }}>{error}</span>
        )}
      </div>

      {/* Breadcrumb */}
      <div style={{
        padding: "7px 20px", borderBottom: "1px solid var(--border)",
        background: "var(--surface-2)", fontSize: "0.82rem",
        color: "var(--text-muted)", flexShrink: 0,
      }}>
        {crumbs().map((c, i) => (
          <span key={c.path}>
            {i > 0 && <span style={{ margin: "0 5px", color: "var(--border-strong)" }}>/</span>}
            <button
              onClick={() => { setFile(null); browseDir(c.path); }}
              style={{
                background: "none", border: "none", padding: 0,
                color: i === crumbs().length - 1 ? "var(--text)" : "var(--blue)",
                cursor: "pointer", fontSize: "0.82rem", fontWeight: i === 0 ? 600 : 400,
              }}
            >{c.label}</button>
          </span>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: "auto", background: "var(--surface)" }}>
        {loading && (
          <div style={{ padding: 24, color: "var(--text-muted)" }}>Loading…</div>
        )}

        {!loading && !file && (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <tbody>
              {entries.length === 0 && (
                <tr><td style={{ padding: "20px", color: "var(--text-muted)" }}>Empty directory</td></tr>
              )}
              {[...entries]
                .sort((a, b) => {
                  if (a.type === b.type) return a.name.localeCompare(b.name);
                  return a.type === "dir" ? -1 : 1;
                })
                .map(entry => (
                  <tr
                    key={entry.path}
                    onClick={() => openEntry(entry)}
                    style={{ cursor: "pointer", borderBottom: "1px solid var(--border)" }}
                    onMouseEnter={e => e.currentTarget.style.background = "var(--surface-2)"}
                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                  >
                    <td style={{
                      padding: "8px 20px",
                      color: entry.type === "dir" ? "var(--blue)" : "var(--text)",
                      fontSize: "0.875rem", width: "60%",
                    }}>
                      <FileIcon type={entry.type} name={entry.name} />
                      {entry.name}
                    </td>
                    <td style={{
                      padding: "8px 20px", color: "var(--text-muted)",
                      fontSize: "0.8rem", textAlign: "right",
                    }}>
                      {entry.type === "file" && formatSize(entry.size)}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}

        {!loading && file && (
          <div>
            <div style={{
              padding: "8px 20px", borderBottom: "1px solid var(--border)",
              background: "var(--surface-2)", fontSize: "0.82rem",
              color: "var(--text-secondary)", display: "flex", justifyContent: "space-between",
              alignItems: "center",
            }}>
              <span style={{ fontFamily: "monospace" }}>{file.path}</span>
              <button onClick={() => setFile(null)} style={{
                background: "none", border: "none", color: "var(--blue)",
                cursor: "pointer", fontSize: "0.82rem",
              }}>← Back</button>
            </div>
            <pre style={{
              margin: 0, padding: "16px 0",
              color: "var(--text)", fontSize: "0.82rem", lineHeight: 1.65,
              fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
              overflowX: "auto",
            }}>
              {file.content.split("\n").map((line, i) => (
                <div key={i} style={{ display: "flex" }}>
                  <span style={{
                    color: "var(--text-muted)", userSelect: "none",
                    minWidth: 48, paddingRight: 16, textAlign: "right",
                    fontSize: "0.75rem", flexShrink: 0,
                    borderRight: "1px solid var(--border)",
                    paddingLeft: 8,
                  }}>{i + 1}</span>
                  <span style={{ paddingLeft: 16 }}>{line}</span>
                </div>
              ))}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
