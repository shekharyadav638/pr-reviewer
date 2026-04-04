import { useState } from "react";
import { analyzePR, analyzeHybrid } from "../api/client";
import Spinner from "../components/Spinner";
import ResultCard from "../components/ResultCard";
import HybridResultCard from "../components/HybridResultCard";

export default function Analyzer() {
  const [prUrl, setPrUrl] = useState("");
  const [mode, setMode] = useState("standard");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [resultMode, setResultMode] = useState(null);
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!prUrl.trim()) return;

    setLoading(true);
    setResult(null);
    setError(null);

    try {
      const fn = mode === "hybrid" ? analyzeHybrid : analyzePR;
      const data = await fn(prUrl.trim());
      setResult(data);
      setResultMode(mode);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const modeButtonStyle = (active) => ({
    padding: "8px 18px",
    fontSize: "0.85rem",
    fontWeight: 600,
    border: "1.5px solid",
    borderRadius: "6px",
    cursor: "pointer",
    transition: "all 0.2s",
    borderColor: active ? "#2563eb" : "#d1d5db",
    backgroundColor: active ? "#eff6ff" : "#fff",
    color: active ? "#2563eb" : "#6b7280",
  });

  return (
    <div style={{ maxWidth: "860px", margin: "0 auto", padding: "40px 20px" }}>
      <header style={{ textAlign: "center", marginBottom: "40px" }}>
        <h1 style={{ margin: "0 0 8px", fontSize: "1.8rem", fontWeight: 800 }}>
          PR Guardian
        </h1>
        <p style={{ margin: 0, color: "#6b7280" }}>
          Hybrid AI Pull Request Risk Analysis
        </p>
      </header>

      {/* Mode selector */}
      <div style={{ display: "flex", justifyContent: "center", gap: "10px", marginBottom: "20px" }}>
        <button
          type="button"
          onClick={() => setMode("standard")}
          style={modeButtonStyle(mode === "standard")}
        >
          Standard (ML + Rules)
        </button>
        <button
          type="button"
          onClick={() => setMode("hybrid")}
          style={modeButtonStyle(mode === "hybrid")}
        >
          Hybrid (ML + Rules + LLM + Security + Static)
        </button>
      </div>

      <form onSubmit={handleSubmit} style={{ marginBottom: "32px" }}>
        <div style={{ display: "flex", gap: "10px" }}>
          <input
            type="text"
            value={prUrl}
            onChange={(e) => setPrUrl(e.target.value)}
            placeholder="https://bitbucket.org/workspace/repo/pull-requests/123"
            disabled={loading}
            style={{
              flex: 1,
              padding: "12px 16px",
              fontSize: "0.95rem",
              border: "1.5px solid #d1d5db",
              borderRadius: "8px",
              outline: "none",
              transition: "border-color 0.2s",
            }}
            onFocus={(e) => (e.target.style.borderColor = "#3b82f6")}
            onBlur={(e) => (e.target.style.borderColor = "#d1d5db")}
          />
          <button
            type="submit"
            disabled={loading || !prUrl.trim()}
            style={{
              padding: "12px 28px",
              fontSize: "0.95rem",
              fontWeight: 600,
              color: "#fff",
              backgroundColor: loading || !prUrl.trim()
                ? "#93c5fd"
                : mode === "hybrid" ? "#7c3aed" : "#2563eb",
              border: "none",
              borderRadius: "8px",
              cursor: loading || !prUrl.trim() ? "not-allowed" : "pointer",
              transition: "background-color 0.2s",
              whiteSpace: "nowrap",
            }}
          >
            {loading ? "Analyzing..." : "Analyze"}
          </button>
        </div>
        {mode === "hybrid" && (
          <p style={{ margin: "8px 0 0", fontSize: "0.8rem", color: "#6b7280" }}>
            Hybrid mode runs ML prediction, rule checks, dependency security scan, static analysis, and LLM code review.
          </p>
        )}
      </form>

      {loading && <Spinner />}

      {error && (
        <div style={{
          padding: "16px", borderRadius: "8px", marginBottom: "24px",
          backgroundColor: "#fef2f2", border: "1px solid #fecaca", color: "#dc2626",
        }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {result && resultMode === "hybrid" && <HybridResultCard data={result} />}
      {result && resultMode === "standard" && <ResultCard data={result} />}
    </div>
  );
}
