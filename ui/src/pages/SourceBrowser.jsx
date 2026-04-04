import { useEffect, useState, useCallback } from "react";
import {
  listBranches,
  browseSource,
  readSourceFile,
  syncRepo,
} from "../api/client";

// Minimal syntax highlight via class names — no external lib
function highlight(code, filename) {
  // Just return plain — real highlighting needs a library
  return code;
}

function FileIcon({ type, name }) {
  if (type === "dir") return <span style={{ marginRight: 6 }}>📁</span>;
  const ext = name.split(".").pop().toLowerCase();
  const icons = {
    py: "🐍", js: "🟨", jsx: "⚛️", ts: "🔷", tsx: "⚛️",
    json: "📋", md: "📝", yml: "⚙️", yaml: "⚙️",
    css: "🎨", html: "🌐", go: "🐹", java: "☕",
  };
  return <span style={{ marginRight: 6 }}>{icons[ext] || "📄"}</span>;
}

export default function SourceBrowser({ repo }) {
  const [branches, setBranches] = useState([]);
  const [branch, setBranch] = useState("");
  const [path, setPath] = useState("");
  const [entries, setEntries] = useState([]);
  const [file, setFile] = useState(null); // { path, content }
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");

  const repoId = repo?.id;

  // Load branches on mount
  useEffect(() => {
    if (!repoId) return;
    listBranches(repoId)
      .then((data) => {
        const list = data.branches || [];
        setBranches(list);
        if (!branch && list.length > 0) setBranch(list[0]);
      })
      .catch(() => {});
  }, [repoId]);

  // Browse directory whenever path changes
  const browse = useCallback(
    (p = path) => {
      if (!repoId) return;
      setLoading(true);
      setFile(null);
      setError("");
      browseSource(repoId, p)
        .then((data) => {
          setEntries(Array.isArray(data) ? data : []);
          setPath(p);
        })
        .catch((e) => setError(e.message))
        .finally(() => setLoading(false));
    },
    [repoId, path]
  );

  useEffect(() => {
    if (repoId) browse("");
  }, [repoId]);

  function openEntry(entry) {
    if (entry.type === "dir") {
      browse(entry.path);
    } else {
      setLoading(true);
      setError("");
      readSourceFile(repoId, entry.path)
        .then((data) => setFile(data))
        .catch((e) => setError(e.message))
        .finally(() => setLoading(false));
    }
  }

  function breadcrumbs() {
    if (!path) return [{ label: repo?.repo_slug || "root", path: "" }];
    const parts = path.split("/");
    return [
      { label: repo?.repo_slug || "root", path: "" },
      ...parts.map((p, i) => ({
        label: p,
        path: parts.slice(0, i + 1).join("/"),
      })),
    ];
  }

  async function handleSync() {
    setSyncing(true);
    setError("");
    try {
      await syncRepo(repoId, branch);
      browse(path);
    } catch (e) {
      setError(e.message);
    } finally {
      setSyncing(false);
    }
  }

  if (!repo) {
    return (
      <div style={{ padding: 40, color: "#8b949e" }}>
        Select a repository from the sidebar.
      </div>
    );
  }

  const crumbs = breadcrumbs();

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      {/* Toolbar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "12px 20px",
          borderBottom: "1px solid #21262d",
          background: "#161b22",
          flexShrink: 0,
        }}
      >
        <span style={{ color: "#e6edf3", fontWeight: 600, fontSize: 15 }}>
          {repo.display_name}
        </span>

        {/* Branch selector */}
        {branches.length > 0 && (
          <select
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            style={{
              background: "#21262d",
              color: "#c9d1d9",
              border: "1px solid #30363d",
              borderRadius: 6,
              padding: "4px 8px",
              fontSize: 13,
            }}
          >
            {branches.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        )}

        <button
          onClick={handleSync}
          disabled={syncing}
          style={{
            background: syncing ? "#21262d" : "#238636",
            color: "#fff",
            border: "none",
            borderRadius: 6,
            padding: "5px 14px",
            fontSize: 13,
            cursor: syncing ? "default" : "pointer",
          }}
        >
          {syncing ? "Syncing…" : "↻ Sync"}
        </button>

        {error && (
          <span style={{ color: "#f85149", fontSize: 13 }}>{error}</span>
        )}
      </div>

      {/* Breadcrumb */}
      <div
        style={{
          padding: "8px 20px",
          borderBottom: "1px solid #21262d",
          background: "#0d1117",
          fontSize: 13,
          color: "#8b949e",
          flexShrink: 0,
        }}
      >
        {crumbs.map((c, i) => (
          <span key={c.path}>
            {i > 0 && <span style={{ margin: "0 4px" }}>/</span>}
            <button
              onClick={() => (file ? setFile(null) || browse(c.path) : browse(c.path))}
              style={{
                background: "none",
                border: "none",
                color: i === crumbs.length - 1 ? "#e6edf3" : "#58a6ff",
                cursor: "pointer",
                padding: 0,
                fontSize: 13,
              }}
            >
              {c.label}
            </button>
          </span>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: "auto", background: "#0d1117" }}>
        {loading && (
          <div style={{ padding: 24, color: "#8b949e" }}>Loading…</div>
        )}

        {!loading && !file && (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <tbody>
              {entries.length === 0 && (
                <tr>
                  <td style={{ padding: "20px", color: "#8b949e" }}>
                    Empty directory
                  </td>
                </tr>
              )}
              {/* Directories first */}
              {[...entries]
                .sort((a, b) => {
                  if (a.type === b.type) return a.name.localeCompare(b.name);
                  return a.type === "dir" ? -1 : 1;
                })
                .map((entry) => (
                  <tr
                    key={entry.path}
                    onClick={() => openEntry(entry)}
                    style={{ cursor: "pointer", borderBottom: "1px solid #161b22" }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.background = "#161b22")
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.background = "transparent")
                    }
                  >
                    <td
                      style={{
                        padding: "8px 20px",
                        color: entry.type === "dir" ? "#58a6ff" : "#c9d1d9",
                        fontSize: 14,
                        width: "60%",
                      }}
                    >
                      <FileIcon type={entry.type} name={entry.name} />
                      {entry.name}
                    </td>
                    <td
                      style={{
                        padding: "8px 20px",
                        color: "#8b949e",
                        fontSize: 13,
                        textAlign: "right",
                      }}
                    >
                      {entry.type === "file" && entry.size > 0
                        ? formatSize(entry.size)
                        : ""}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}

        {!loading && file && (
          <div>
            <div
              style={{
                padding: "8px 20px",
                borderBottom: "1px solid #21262d",
                background: "#161b22",
                fontSize: 13,
                color: "#8b949e",
                display: "flex",
                justifyContent: "space-between",
              }}
            >
              <span>{file.path}</span>
              <button
                onClick={() => setFile(null)}
                style={{
                  background: "none",
                  border: "none",
                  color: "#58a6ff",
                  cursor: "pointer",
                  fontSize: 13,
                }}
              >
                ← Back
              </button>
            </div>
            <pre
              style={{
                margin: 0,
                padding: "16px 20px",
                color: "#c9d1d9",
                fontSize: 13,
                lineHeight: 1.6,
                fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                overflowX: "auto",
                whiteSpace: "pre",
                counterReset: "line",
              }}
            >
              {file.content.split("\n").map((line, i) => (
                <div key={i} style={{ display: "flex" }}>
                  <span
                    style={{
                      color: "#484f58",
                      userSelect: "none",
                      minWidth: 40,
                      paddingRight: 16,
                      textAlign: "right",
                      fontSize: 12,
                    }}
                  >
                    {i + 1}
                  </span>
                  <span>{line}</span>
                </div>
              ))}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
