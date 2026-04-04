import { useEffect, useState } from "react";
import { getRepoPRs } from "../api/client";
import Spinner from "../components/Spinner";

const STATE_CFG = {
  OPEN:      { bg: "#1a4731", text: "#4ade80", border: "#166534" },
  MERGED:    { bg: "#2e1065", text: "#c4b5fd", border: "#4c1d95" },
  DECLINED:  { bg: "#450a0a", text: "#f87171", border: "#6b2737" },
  SUPERSEDED:{ bg: "#1c1917", text: "#a8a29e", border: "#44403c" },
};

function StateBadge({ state }) {
  const s = (state || "").toUpperCase();
  const c = STATE_CFG[s] || STATE_CFG.SUPERSEDED;
  return (
    <span style={{
      display: "inline-block", padding: "2px 9px", borderRadius: 4,
      fontSize: "0.7rem", fontWeight: 700, letterSpacing: "0.04em",
      background: c.bg, color: c.text, border: `1px solid ${c.border}`,
    }}>{s}</span>
  );
}

function Avatar({ name }) {
  const initials = (name || "?").split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
  const colors = ["#1f6feb","#7c3aed","#0891b2","#059669","#d97706"];
  const color = colors[initials.charCodeAt(0) % colors.length];
  return (
    <div style={{
      width: 28, height: 28, borderRadius: "50%",
      backgroundColor: color, color: "#fff",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: "0.7rem", fontWeight: 700, flexShrink: 0,
    }}>{initials}</div>
  );
}

const STATES = ["OPEN", "MERGED", "DECLINED"];

export default function PRList({ repo, onOpenPR }) {
  const [prs, setPRs]         = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [stateFilter, setFilter] = useState("OPEN");
  const [search, setSearch]   = useState("");

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
    <div style={{ padding: "28px 32px", maxWidth: 960 }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
          <h2 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 700, color: "#e2e8f0" }}>
            Pull requests
          </h2>
          {repo.index_status === "indexed" && (
            <span style={{
              fontSize: "0.72rem", padding: "2px 8px", borderRadius: 4,
              background: "#14532d", color: "#4ade80", border: "1px solid #166534",
            }}>● Semantic index ready</span>
          )}
        </div>
        <p style={{ margin: 0, fontSize: "0.85rem", color: "#6b7280" }}>
          {repo.workspace} / <strong style={{ color: "#8c9bab" }}>{repo.repo_slug}</strong>
        </p>
      </div>

      {/* Toolbar */}
      <div style={{
        display: "flex", gap: 10, marginBottom: 16,
        alignItems: "center", flexWrap: "wrap",
      }}>
        {/* State tabs */}
        <div style={{
          display: "flex", border: "1px solid #30363d", borderRadius: 6, overflow: "hidden",
        }}>
          {STATES.map(s => (
            <button key={s} onClick={() => setFilter(s)} style={{
              padding: "6px 14px", fontSize: "0.8rem", fontWeight: 600,
              border: "none", cursor: "pointer",
              borderRight: s !== "DECLINED" ? "1px solid #30363d" : "none",
              backgroundColor: stateFilter === s ? "#21262d" : "#0d1117",
              color: stateFilter === s ? "#e2e8f0" : "#6b7280",
              transition: "all 0.12s",
            }}>{s}</button>
          ))}
        </div>

        {/* Search */}
        <div style={{ position: "relative", flex: 1, minWidth: 180 }}>
          <span style={{
            position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)",
            color: "#6b7280", fontSize: "0.85rem", pointerEvents: "none",
          }}>🔍</span>
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search pull requests"
            style={{
              width: "100%", boxSizing: "border-box",
              paddingLeft: 32, paddingRight: 12, paddingTop: 7, paddingBottom: 7,
              fontSize: "0.83rem", background: "#0d1117", color: "#e2e8f0",
              border: "1px solid #30363d", borderRadius: 6, outline: "none",
            }}
          />
        </div>

        <span style={{ fontSize: "0.8rem", color: "#6b7280", marginLeft: "auto" }}>
          {filtered.length} result{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Table */}
      {loading && <Spinner />}

      {error && (
        <div style={{
          padding: "12px 16px", borderRadius: 8, marginBottom: 16,
          background: "#450a0a", border: "1px solid #6b2737", color: "#f87171",
          fontSize: "0.85rem",
        }}>{error}</div>
      )}

      {!loading && !error && (
        <div style={{
          border: "1px solid #21262d", borderRadius: 8, overflow: "hidden",
          background: "#0d1117",
        }}>
          {filtered.length === 0 ? (
            <div style={{ padding: "40px 24px", textAlign: "center", color: "#4b5563" }}>
              No {stateFilter.toLowerCase()} pull requests{search ? " matching your search" : ""}.
            </div>
          ) : (
            filtered.map((pr, i) => (
              <div
                key={pr.pr_id}
                style={{
                  display: "flex", alignItems: "center", gap: 14,
                  padding: "14px 18px",
                  borderBottom: i < filtered.length - 1 ? "1px solid #21262d" : "none",
                  transition: "background 0.12s", cursor: "pointer",
                }}
                onClick={() => onOpenPR(pr)}
                onMouseEnter={e => e.currentTarget.style.backgroundColor = "#161b22"}
                onMouseLeave={e => e.currentTarget.style.backgroundColor = "transparent"}
              >
                <Avatar name={pr.author} />

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3, flexWrap: "wrap" }}>
                    <StateBadge state={pr.state} />
                    <span style={{
                      fontWeight: 600, fontSize: "0.9rem", color: "#e2e8f0",
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>
                      {pr.title}
                    </span>
                  </div>
                  <div style={{ fontSize: "0.77rem", color: "#6b7280" }}>
                    #{pr.pr_id} · {pr.author}
                    {pr.created_at && (
                      <> · {new Date(pr.created_at).toLocaleDateString("en-US", {
                        month: "short", day: "numeric", year: "numeric",
                      })}</>
                    )}
                  </div>
                </div>

                {/* Review button — only OPEN PRs */}
                {pr.state === "OPEN" && (
                  <button
                    onClick={e => { e.stopPropagation(); onOpenPR(pr); }}
                    style={{
                      padding: "6px 14px", fontSize: "0.8rem", fontWeight: 600,
                      backgroundColor: "#1f6feb", color: "#fff",
                      border: "none", borderRadius: 6, cursor: "pointer",
                      whiteSpace: "nowrap", flexShrink: 0,
                    }}
                  >Review PR →</button>
                )}

                {/* For merged/declined: view link */}
                {pr.state !== "OPEN" && (
                  <span style={{ color: "#4b5563", fontSize: "0.8rem", flexShrink: 0 }}>
                    View →
                  </span>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
