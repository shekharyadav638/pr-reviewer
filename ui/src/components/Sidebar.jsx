import { useState } from "react";
import { addRepo, deleteRepo, indexRepo, fetchRepoPRs, syncRepo } from "../api/client";

const STATUS_CFG = {
  pending:  { color: "#6b7280", label: "Not indexed" },
  indexing: { color: "#f59e0b", label: "Indexing…"  },
  indexed:  { color: "#22c55e", label: "Indexed"     },
  error:    { color: "#ef4444", label: "Error"       },
};

function RepoDot({ status }) {
  const c = STATUS_CFG[status] || STATUS_CFG.pending;
  return (
    <span title={c.label} style={{
      width: 8, height: 8, borderRadius: "50%",
      backgroundColor: c.color, flexShrink: 0, display: "inline-block",
    }} />
  );
}

function NavItem({ icon, label, active, onClick, badge }) {
  return (
    <div
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "7px 14px 7px 20px", cursor: "pointer", userSelect: "none",
        backgroundColor: active ? "rgba(255,255,255,0.07)" : "transparent",
        borderLeft: active ? "3px solid #579dff" : "3px solid transparent",
        borderRadius: "0 6px 6px 0",
        transition: "background 0.12s",
        fontSize: "0.85rem", color: active ? "#e2e8f0" : "#8c9bab",
      }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.04)"; }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.backgroundColor = "transparent"; }}
    >
      <span style={{ fontSize: "0.9rem", width: 16, textAlign: "center" }}>{icon}</span>
      <span style={{ flex: 1 }}>{label}</span>
      {badge != null && badge > 0 && (
        <span style={{
          backgroundColor: "#334155", color: "#94a3b8",
          borderRadius: 10, padding: "1px 7px", fontSize: "0.7rem", fontWeight: 600,
        }}>{badge}</span>
      )}
    </div>
  );
}

export default function Sidebar({
  repos, selectedRepoId, selectedView,
  onSelectRepo, onSelectPRs, onSelectSource, onReposChanged, onError,
}) {
  const [addOpen, setAddOpen]   = useState(false);
  const [repoUrl, setRepoUrl]   = useState("");
  const [adding, setAdding]     = useState(false);
  const [expanded, setExpanded] = useState(null);
  const [syncing, setSyncing]   = useState(null); // repoId being synced

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

  async function handleIndex(e, repo) {
    e.stopPropagation();
    try { await indexRepo(repo.id); onReposChanged(); }
    catch (err) { onError(err.message); }
  }

  async function handleFetch(e, repo) {
    e.stopPropagation();
    try { await fetchRepoPRs(repo.id); onReposChanged(); }
    catch (err) { onError(err.message); }
  }

  async function handleSync(e, repo) {
    e.stopPropagation();
    setSyncing(repo.id);
    try { await syncRepo(repo.id); onReposChanged(); }
    catch (err) { onError(err.message); }
    finally { setSyncing(null); }
  }

  async function handleDelete(e, repo) {
    e.stopPropagation();
    if (!window.confirm(`Remove "${repo.display_name}"?`)) return;
    try {
      await deleteRepo(repo.id);
      if (selectedRepoId === repo.id) onSelectRepo(null);
      onReposChanged();
    } catch (err) { onError(err.message); }
  }

  function toggleExpand(id) {
    setExpanded(prev => prev === id ? null : id);
  }

  return (
    <aside style={{
      width: 240, minWidth: 240, backgroundColor: "#161b22",
      display: "flex", flexDirection: "column", height: "100vh",
      overflowY: "auto", borderRight: "1px solid #21262d", flexShrink: 0,
    }}>
      {/* Logo */}
      <div style={{
        padding: "16px 16px 14px", borderBottom: "1px solid #21262d",
        display: "flex", alignItems: "center", gap: 10,
      }}>
        <div style={{
          width: 30, height: 30, borderRadius: 6,
          background: "linear-gradient(135deg,#7c3aed,#2563eb)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: "1rem", flexShrink: 0,
        }}>🛡</div>
        <div>
          <div style={{ fontWeight: 700, fontSize: "0.92rem", color: "#e2e8f0" }}>
            PR Guardian
          </div>
          <div style={{ fontSize: "0.68rem", color: "#4b5563" }}>Code review platform</div>
        </div>
      </div>

      {/* Section label + add button */}
      <div style={{
        padding: "14px 14px 4px",
        display: "flex", justifyContent: "space-between", alignItems: "center",
      }}>
        <span style={{
          fontSize: "0.68rem", fontWeight: 700, color: "#4b5563",
          textTransform: "uppercase", letterSpacing: "0.1em",
        }}>Repositories</span>
        <button
          onClick={() => setAddOpen(v => !v)}
          title="Add repository"
          style={{
            background: "none", border: "none", cursor: "pointer",
            color: addOpen ? "#579dff" : "#4b5563", fontSize: "1.1rem",
            lineHeight: 1, padding: "2px 4px", borderRadius: 4,
            transition: "color 0.15s",
          }}
        >+</button>
      </div>

      {/* Add repo input */}
      {addOpen && (
        <form onSubmit={handleAdd} style={{ padding: "4px 12px 10px" }}>
          <input
            autoFocus value={repoUrl}
            onChange={e => setRepoUrl(e.target.value)}
            placeholder="workspace/repo or Bitbucket URL"
            disabled={adding}
            style={{
              width: "100%", boxSizing: "border-box",
              padding: "7px 10px", fontSize: "0.8rem",
              background: "#0d1117", color: "#e2e8f0",
              border: "1px solid #30363d", borderRadius: 6, outline: "none",
              marginBottom: 6,
            }}
          />
          <div style={{ display: "flex", gap: 6 }}>
            <button type="submit" disabled={adding || !repoUrl.trim()} style={{
              flex: 1, padding: "6px 0", fontSize: "0.78rem", fontWeight: 600,
              backgroundColor: "#1f6feb", color: "#fff",
              border: "none", borderRadius: 5, cursor: "pointer",
            }}>
              {adding ? "Adding…" : "Add"}
            </button>
            <button type="button" onClick={() => setAddOpen(false)} style={{
              padding: "6px 10px", fontSize: "0.78rem",
              backgroundColor: "#21262d", color: "#8c9bab",
              border: "1px solid #30363d", borderRadius: 5, cursor: "pointer",
            }}>✕</button>
          </div>
        </form>
      )}

      {/* Repo list */}
      <nav style={{ flex: 1, paddingBottom: 16 }}>
        {repos.length === 0 && (
          <p style={{ padding: "10px 16px", fontSize: "0.8rem", color: "#4b5563" }}>
            No repos yet. Click + to add one.
          </p>
        )}

        {repos.map(repo => {
          const isExpanded = expanded === repo.id;
          const isSelected = selectedRepoId === repo.id;

          return (
            <div key={repo.id}>
              {/* Repo row */}
              <div
                onClick={() => { onSelectRepo(repo.id); toggleExpand(repo.id); }}
                style={{
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "8px 12px 8px 14px", cursor: "pointer",
                  backgroundColor: isSelected ? "rgba(255,255,255,0.05)" : "transparent",
                  borderLeft: isSelected ? "3px solid #579dff" : "3px solid transparent",
                  transition: "background 0.12s",
                }}
                onMouseEnter={e => { if (!isSelected) e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.03)"; }}
                onMouseLeave={e => { if (!isSelected) e.currentTarget.style.backgroundColor = "transparent"; }}
              >
                <RepoDot status={repo.index_status} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: "0.84rem", fontWeight: 500, color: "#c9d1d9",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>{repo.repo_slug}</div>
                  <div style={{ fontSize: "0.7rem", color: "#4b5563" }}>{repo.workspace}</div>
                </div>
                <span style={{
                  color: "#4b5563", fontSize: "0.6rem",
                  transform: isExpanded ? "rotate(90deg)" : "none",
                  transition: "transform 0.15s",
                }}>▶</span>
              </div>

              {/* Progress bar while indexing */}
              {repo.index_status === "indexing" && (
                <div style={{ margin: "0 14px 4px", height: 3, background: "#21262d", borderRadius: 2 }}>
                  <div style={{
                    width: `${repo.index_progress}%`, height: "100%",
                    background: "#1f6feb", borderRadius: 2, transition: "width 0.3s",
                  }} />
                </div>
              )}

              {/* Sub-menu */}
              {isExpanded && (
                <div style={{ background: "#0d1117", borderBottom: "1px solid #21262d" }}>
                  <NavItem
                    icon="📁" label="Source"
                    active={isSelected && selectedView === "source"}
                    onClick={() => onSelectSource && onSelectSource(repo.id)}
                  />
                  <NavItem
                    icon="📋" label="Pull Requests"
                    badge={repo.pr_count}
                    active={isSelected && selectedView === "prs"}
                    onClick={() => onSelectPRs(repo.id)}
                  />

                  {/* Clone / graph status */}
                  {(repo.clone_status === "cloning" || repo.graph_status === "building") && (
                    <div style={{ padding: "2px 14px 4px", fontSize: "0.7rem", color: "#8b949e" }}>
                      {repo.clone_status === "cloning"
                        ? `Cloning… ${repo.clone_progress}%`
                        : `Building graph… ${repo.graph_progress}%`}
                      <div style={{ marginTop: 4, height: 2, background: "#21262d", borderRadius: 2 }}>
                        <div style={{
                          width: `${repo.clone_status === "cloning" ? repo.clone_progress : repo.graph_progress}%`,
                          height: "100%", background: "#f59e0b", borderRadius: 2, transition: "width 0.3s",
                        }} />
                      </div>
                    </div>
                  )}

                  {/* Action buttons */}
                  <div style={{ padding: "6px 14px 8px", display: "flex", flexWrap: "wrap", gap: 5 }}>
                    <button
                      onClick={e => handleIndex(e, repo)}
                      disabled={repo.index_status === "indexing" || repo.clone_status === "cloning"}
                      style={{
                        padding: "4px 10px", fontSize: "0.72rem", fontWeight: 600,
                        border: "1px solid #1f6feb", borderRadius: 4, cursor: "pointer",
                        backgroundColor: "transparent", color: "#579dff",
                        opacity: (repo.index_status === "indexing" || repo.clone_status === "cloning") ? 0.5 : 1,
                      }}
                    >
                      {repo.index_status === "indexing"
                        ? `${repo.index_progress}%…`
                        : repo.index_status === "indexed" ? "Re-index" : "Build Index"}
                    </button>
                    <button
                      onClick={e => handleSync(e, repo)}
                      disabled={syncing === repo.id || repo.clone_status === "cloning"}
                      style={{
                        padding: "4px 10px", fontSize: "0.72rem", fontWeight: 600,
                        border: "1px solid #30363d", borderRadius: 4, cursor: "pointer",
                        backgroundColor: "transparent", color: "#8c9bab",
                        opacity: (syncing === repo.id || repo.clone_status === "cloning") ? 0.5 : 1,
                      }}
                    >
                      {syncing === repo.id ? "Syncing…" : "↻ Sync"}
                    </button>
                    <button
                      onClick={e => handleFetch(e, repo)}
                      disabled={repo.pr_fetch_status === "fetching"}
                      style={{
                        padding: "4px 10px", fontSize: "0.72rem", fontWeight: 600,
                        border: "1px solid #30363d", borderRadius: 4, cursor: "pointer",
                        backgroundColor: "transparent", color: "#8c9bab",
                        opacity: repo.pr_fetch_status === "fetching" ? 0.5 : 1,
                      }}
                    >
                      {repo.pr_fetch_status === "fetching" ? "Fetching…" : "Fetch PRs"}
                    </button>
                    <button
                      onClick={e => handleDelete(e, repo)}
                      style={{
                        padding: "4px 10px", fontSize: "0.72rem", fontWeight: 600,
                        border: "1px solid #6b2737", borderRadius: 4, cursor: "pointer",
                        backgroundColor: "transparent", color: "#f87171",
                      }}
                    >Remove</button>
                  </div>

                  {(repo.index_error || repo.clone_error || repo.graph_error) && (
                    <div style={{
                      margin: "0 12px 8px", padding: "5px 8px", borderRadius: 4,
                      background: "#160b0b", border: "1px solid #6b2737",
                      fontSize: "0.72rem", color: "#f87171",
                    }}>{repo.clone_error || repo.graph_error || repo.index_error}</div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
