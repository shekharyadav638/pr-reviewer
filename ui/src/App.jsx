import { useEffect, useState, useCallback } from "react";
import Sidebar from "./components/Sidebar";
import PRList from "./pages/PRList";
import PRDetail from "./pages/PRDetail";
import SourceBrowser from "./pages/SourceBrowser";
import BitbucketBrowser from "./pages/BitbucketBrowser";
import { listRepos } from "./api/client";

export default function App() {
  const [repos, setRepos]                   = useState([]);
  const [selectedRepoId, setSelectedRepoId] = useState(null);
  const [selectedView, setSelectedView]     = useState(null);
  const [selectedPR, setSelectedPR]         = useState(null);
  const [globalError, setGlobalError]       = useState(null);

  const loadRepos = useCallback(async () => {
    try { setRepos(await listRepos()); } catch { /* api not up yet */ }
  }, []);

  useEffect(() => { loadRepos(); }, [loadRepos]);

  // Poll while any background task is running
  useEffect(() => {
    const anyActive = repos.some(
      r =>
        r.index_status  === "indexing" ||
        r.pr_fetch_status === "fetching" ||
        r.clone_status  === "cloning"   ||
        r.graph_status  === "building"
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
  function handleBitbucketBrowse() {
    setSelectedView("bitbucket");
    setSelectedPR(null);
  }
  function handleConnectRepo() {
    loadRepos();
    setSelectedView("source");
  }

  function renderMain() {
    if (selectedView === "pr-detail" && selectedPR && selectedRepo) {
      return <PRDetail pr={selectedPR} repo={selectedRepo} onBack={handleBackToPRs} />;
    }
    if (selectedView === "prs" && selectedRepo) {
      return <PRList repo={selectedRepo} onOpenPR={handleOpenPR} />;
    }
    if (selectedView === "source") {
      return <SourceBrowser repo={selectedRepo} />;
    }
    if (selectedView === "bitbucket") {
      return (
        <BitbucketBrowser
          connectedRepos={repos}
          onConnect={handleConnectRepo}
          onError={setGlobalError}
        />
      );
    }
    return <WelcomeScreen onBrowseBitbucket={handleBitbucketBrowse} />;
  }

  return (
    <div className="app-shell">
      <Sidebar
        repos={repos}
        selectedRepoId={selectedRepoId}
        selectedView={selectedView}
        onSelectRepo={handleSelectRepo}
        onSelectPRs={handleSelectPRs}
        onSelectSource={handleSelectSource}
        onReposChanged={loadRepos}
        onError={setGlobalError}
        onBrowseBitbucket={handleBitbucketBrowse}
      />

      <main className="app-main">
        {globalError && (
          <div className="error-banner">
            <span>{globalError}</span>
            <button
              onClick={() => setGlobalError(null)}
              style={{ background: "none", border: "none", cursor: "pointer", color: "var(--red)", fontSize: "1rem" }}
            >✕</button>
          </div>
        )}
        <div style={{ flex: 1 }}>{renderMain()}</div>
      </main>
    </div>
  );
}

function WelcomeScreen({ onBrowseBitbucket }) {
  return (
    <div className="welcome-screen">
      <div className="welcome-icon">🛡</div>
      <h1 className="welcome-title">PR Guardian</h1>
      <p className="welcome-desc">
        AI-powered pull request analysis with 7-layer review — ML risk scoring, static analysis,
        security scanning, semantic search, and GPT-4 code review.
      </p>

      <div className="welcome-steps">
        <div className="welcome-step">
          <div className="welcome-step-num">Step 1</div>
          <div className="welcome-step-title">Connect a repo</div>
          <div className="welcome-step-desc">Browse Bitbucket or paste a repo URL in the sidebar.</div>
        </div>
        <div className="welcome-step">
          <div className="welcome-step-num">Step 2</div>
          <div className="welcome-step-title">Build index</div>
          <div className="welcome-step-desc">Click "Build Index" to clone and embed the codebase.</div>
        </div>
        <div className="welcome-step">
          <div className="welcome-step-num">Step 3</div>
          <div className="welcome-step-title">Review PRs</div>
          <div className="welcome-step-desc">Open any PR to get a full AI review with inline comments.</div>
        </div>
        <div className="welcome-step">
          <div className="welcome-step-num">Auto</div>
          <div className="welcome-step-title">Webhook</div>
          <div className="welcome-step-desc">Set up a webhook for instant review on every new PR.</div>
        </div>
      </div>

      <button className="btn btn-primary btn-lg" onClick={onBrowseBitbucket}>
        Browse Bitbucket repos →
      </button>
    </div>
  );
}
