import { useState } from "react";
import { analyzeHybrid } from "../api/client";
import Spinner from "../components/Spinner";
import HybridResultCard from "../components/HybridResultCard";

export default function PRReview({ pr, repo, onBack }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult]   = useState(null);
  const [error, setError]     = useState(null);

  async function handleReview() {
    setLoading(true);
    setResult(null);
    setError(null);
    try {
      const data = await analyzeHybrid(pr.pr_url);
      setResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ padding: "32px 36px", maxWidth: "920px" }}>
      {/* Breadcrumb */}
      <div style={{ display: "flex", alignItems: "center", gap: "8px",
                    marginBottom: "24px", flexWrap: "wrap" }}>
        <button
          onClick={onBack}
          style={{
            background: "none", border: "none", cursor: "pointer",
            color: "#7c3aed", fontWeight: 600, fontSize: "0.9rem", padding: 0,
          }}
        >
          ← {repo?.display_name || "Repos"}
        </button>
        <span style={{ color: "#d1d5db" }}>/</span>
        <span style={{ color: "#6b7280", fontSize: "0.9rem" }}>
          PR #{pr.pr_id}
        </span>
      </div>

      {/* PR header */}
      <div style={{
        padding: "20px 24px", borderRadius: "12px",
        border: "1px solid #e5e7eb", backgroundColor: "#fff",
        marginBottom: "24px",
      }}>
        <h2 style={{ margin: "0 0 6px", fontSize: "1.2rem" }}>
          #{pr.pr_id} — {pr.title}
        </h2>
        <p style={{ margin: "0 0 16px", color: "#6b7280", fontSize: "0.9rem" }}>
          {repo?.workspace}/{repo?.repo_slug} &middot; {pr.author}
          {pr.created_at && (
            <span> &middot; {new Date(pr.created_at).toLocaleDateString()}</span>
          )}
        </p>

        {!result && (
          <button
            onClick={handleReview}
            disabled={loading}
            style={{
              padding: "10px 28px", fontSize: "0.95rem", fontWeight: 700,
              backgroundColor: loading ? "#5b21b6" : "#7c3aed",
              color: "#fff", border: "none", borderRadius: "8px",
              cursor: loading ? "not-allowed" : "pointer",
              display: "flex", alignItems: "center", gap: "8px",
            }}
          >
            {loading && (
              <span style={{
                display: "inline-block", width: "14px", height: "14px",
                border: "2px solid rgba(255,255,255,0.3)",
                borderTopColor: "#fff", borderRadius: "50%",
                animation: "spin 0.7s linear infinite",
              }} />
            )}
            {loading ? "Analyzing PR…" : "Review PR"}
          </button>
        )}

        {result && (
          <button
            onClick={() => { setResult(null); handleReview(); }}
            disabled={loading}
            style={{
              padding: "8px 20px", fontSize: "0.85rem", fontWeight: 600,
              backgroundColor: "#f3f4f6", color: "#374151",
              border: "1px solid #d1d5db", borderRadius: "6px", cursor: "pointer",
            }}
          >
            Re-analyze
          </button>
        )}
      </div>

      {loading && <Spinner />}

      {error && (
        <div style={{
          padding: "14px 16px", borderRadius: "8px", marginBottom: "20px",
          backgroundColor: "#fef2f2", border: "1px solid #fecaca", color: "#dc2626",
        }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {result && <HybridResultCard data={result} />}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
