import { useEffect, useState, useCallback } from "react";
import Sidebar from "./components/Sidebar";
import PRList from "./pages/PRList";
import PRDetail from "./pages/PRDetail";
import Analyzer from "./pages/Analyzer";
import SourceBrowser from "./pages/SourceBrowser";
import { listRepos } from "./api/client";

export default function App() {
  const [repos, setRepos]           = useState([]);
  const [selectedRepoId, setSelectedRepoId] = useState(null);
  const [selectedView, setSelectedView]     = useState(null); // "prs" | "pr-detail" | "analyzer"
  const [selectedPR, setSelectedPR]         = useState(null);
  const [globalError, setGlobalError]       = useState(null);

  const loadRepos = useCallback(async () => {
    try { setRepos(await listRepos()); } catch { /* api not running yet */ }
  }, []);

  useEffect(() => { loadRepos(); }, [loadRepos]);

  // Poll while any background jobs are running
  useEffect(() => {
    const anyActive = repos.some(
      r =>
        r.index_status === "indexing" ||
        r.pr_fetch_status === "fetching" ||
        r.clone_status === "cloning" ||
        r.graph_status === "building"
    );
    if (!anyActive) return;
    const t = setInterval(loadRepos, 2500);
    return () => clearInterval(t);
  }, [repos, loadRepos]);

  const selectedRepo = repos.find(r => r.id === selectedRepoId) || null;

  function handleSelectRepo(id) {
    setSelectedRepoId(id);
    setSelectedView("source");
    setSelectedPR(null);
  }

  function handleSelectPRs(id) {
    setSelectedRepoId(id);
    setSelectedView("prs");
    setSelectedPR(null);
  }

  function handleSelectSource(id) {
    setSelectedRepoId(id);
    setSelectedView("source");
    setSelectedPR(null);
  }

  function handleOpenPR(pr) {
    setSelectedPR(pr);
    setSelectedView("pr-detail");
  }

  function handleBackToPRs() {
    setSelectedPR(null);
    setSelectedView("prs");
  }

  function renderMain() {
    if (selectedView === "pr-detail" && selectedPR && selectedRepo) {
      return (
        <PRDetail
          pr={selectedPR}
          repo={selectedRepo}
          onBack={handleBackToPRs}
        />
      );
    }
    if (selectedView === "prs" && selectedRepo) {
      return <PRList repo={selectedRepo} onOpenPR={handleOpenPR} />;
    }
    if (selectedView === "source") {
      return <SourceBrowser repo={selectedRepo} />;
    }
    if (selectedView === "analyzer") {
      return <Analyzer />;
    }
    // Welcome screen
    return (
      <div style={{
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        height: "100%", padding: 40, textAlign: "center",
      }}>
        <div style={{ fontSize: "3rem", marginBottom: 16 }}>🛡</div>
        <h2 style={{ margin: "0 0 8px", color: "#e2e8f0", fontSize: "1.3rem" }}>
          Welcome to PR Guardian
        </h2>
        <p style={{ margin: "0 0 24px", color: "#6b7280", maxWidth: 400, fontSize: "0.9rem" }}>
          Add a repository from the sidebar, build its semantic index,
          then open any pull request to get a full AI review with diff viewer and inline comments.
        </p>
        <button
          onClick={() => setSelectedView("analyzer")}
          style={{
            padding: "9px 22px", backgroundColor: "#1f6feb", color: "#fff",
            border: "none", borderRadius: 6, cursor: "pointer",
            fontWeight: 600, fontSize: "0.9rem",
          }}
        >Or analyze a PR by URL →</button>
      </div>
    );
  }

  return (
    <div style={{
      display: "flex", height: "100vh", overflow: "hidden",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      backgroundColor: "#0d1117", color: "#c9d1d9",
    }}>
      <Sidebar
        repos={repos}
        selectedRepoId={selectedRepoId}
        selectedView={selectedView}
        onSelectRepo={handleSelectRepo}
        onSelectPRs={handleSelectPRs}
        onSelectSource={handleSelectSource}
        onReposChanged={loadRepos}
        onError={setGlobalError}
      />

      <main style={{ flex: 1, overflowY: "auto", backgroundColor: "#0d1117", display: "flex", flexDirection: "column" }}>
        {globalError && (
          <div style={{
            margin: "14px 20px 0", padding: "10px 14px", borderRadius: 7,
            background: "#450a0a", border: "1px solid #6b2737",
            color: "#f87171", display: "flex", justifyContent: "space-between",
            alignItems: "center", fontSize: "0.85rem", flexShrink: 0,
          }}>
            <span>{globalError}</span>
            <button onClick={() => setGlobalError(null)} style={{
              background: "none", border: "none", cursor: "pointer",
              color: "#f87171", fontSize: "1rem",
            }}>✕</button>
          </div>
        )}
        <div style={{ flex: 1 }}>{renderMain()}</div>
      </main>
    </div>
  );
}
