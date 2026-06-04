import { useEffect, useState } from "react";
import { getRepoPRs } from "../api/client";

const STATE_CFG = {
  OPEN:       { badge: "badge-green",  label: "Open"       },
  MERGED:     { badge: "badge-purple", label: "Merged"     },
  DECLINED:   { badge: "badge-red",    label: "Declined"   },
  SUPERSEDED: { badge: "badge-gray",   label: "Superseded" },
};

function StateBadge({ state }) {
  const s   = (state || "").toUpperCase();
  const cfg = STATE_CFG[s] || STATE_CFG.SUPERSEDED;
  return <span className={`badge ${cfg.badge}`}>{cfg.label}</span>;
}

function Avatar({ name }) {
  const initials = (name || "?").split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
  const palette  = ["#3070d6", "#7c3aed", "#0891b2", "#22a860", "#c07c1a"];
  const bg       = palette[initials.charCodeAt(0) % palette.length];
  return (
    <div className="pr-avatar" style={{ backgroundColor: bg }}>
      {initials}
    </div>
  );
}

const STATES = ["OPEN", "MERGED", "DECLINED"];

export default function PRList({ repo, onOpenPR }) {
  const [prs, setPRs]          = useState([]);
  const [loading, setLoading]  = useState(true);
  const [error, setError]      = useState(null);
  const [stateFilter, setFilter] = useState("OPEN");
  const [search, setSearch]    = useState("");

  useEffect(() => {
    if (!repo) return;
    setLoading(true); setError(null);
    getRepoPRs(repo.id, stateFilter)
      .then(setPRs)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [repo?.id, stateFilter]);

  const filtered = prs.filter(pr =>
    !search ||
    pr.title.toLowerCase().includes(search.toLowerCase()) ||
    pr.author.toLowerCase().includes(search.toLowerCase()) ||
    String(pr.pr_id).includes(search)
  );

  return (
    <div className="pr-list-page">
      {/* Header */}
      <div className="page-header">
        <div className="page-title">
          <h2>Pull Requests</h2>
          {repo.index_status === "indexed" && (
            <span className="badge badge-green">● Semantic index ready</span>
          )}
        </div>
        <p className="page-subtitle">
          {repo.workspace} / <strong style={{ color: "var(--text)" }}>{repo.repo_slug}</strong>
        </p>
      </div>

      {/* Toolbar */}
      <div className="toolbar">
        <div className="tab-group">
          {STATES.map(s => (
            <button
              key={s}
              className={`tab-btn${stateFilter === s ? " active" : ""}`}
              onClick={() => setFilter(s)}
            >{s}</button>
          ))}
        </div>

        <div className="search-wrap" style={{ flex: 1, minWidth: 180 }}>
          <span className="search-icon">⌕</span>
          <input
            className="input search-input"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search pull requests…"
          />
        </div>

        <span className="results-count">
          {filtered.length} result{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {loading && (
        <div className="spinner-wrap">
          <div className="spinner-ring" />
          <span className="spinner-text">Loading pull requests…</span>
        </div>
      )}

      {error && (
        <div className="error-banner" style={{ margin: "0 0 16px" }}>
          <span>{error}</span>
        </div>
      )}

      {!loading && !error && (
        <div className="card">
          {filtered.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">⎇</div>
              No {stateFilter.toLowerCase()} pull requests{search ? " matching your search" : ""}.
            </div>
          ) : (
            filtered.map(pr => (
              <div key={pr.pr_id} className="pr-row" onClick={() => onOpenPR(pr)}>
                <Avatar name={pr.author} />

                <div className="pr-info">
                  <div className="pr-meta">
                    <StateBadge state={pr.state} />
                    <span className="pr-title">{pr.title}</span>
                  </div>
                  <div className="pr-sub">
                    #{pr.pr_id} · {pr.author}
                    {pr.created_at && (
                      <> · {new Date(pr.created_at).toLocaleDateString("en-US", {
                        month: "short", day: "numeric", year: "numeric",
                      })}</>
                    )}
                    {pr.source_branch && pr.destination_branch && (
                      <> ·{" "}
                        <code style={{ fontSize: "0.72rem", color: "var(--blue)", fontFamily: "var(--font-mono)" }}>
                          {pr.source_branch}
                        </code>
                        {" "}→{" "}
                        <code style={{ fontSize: "0.72rem", color: "var(--green)", fontFamily: "var(--font-mono)" }}>
                          {pr.destination_branch}
                        </code>
                      </>
                    )}
                  </div>
                </div>

                {pr.state === "OPEN" ? (
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={e => { e.stopPropagation(); onOpenPR(pr); }}
                  >Review →</button>
                ) : (
                  <span style={{ color: "var(--text-muted)", fontSize: "0.8rem", flexShrink: 0 }}>View →</span>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
