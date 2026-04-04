import { useState, useEffect } from "react";
import { analyzeHybrid, getRepoPRs } from "../api/client";
import { getPRDiff, postPRComment } from "../api/client";
import Spinner from "../components/Spinner";
import HybridResultCard from "../components/HybridResultCard";

// ─── Diff parser ────────────────────────────────────────────────────────────

function parseDiff(raw) {
  const files = [];
  let current = null;
  let aLine = 0, bLine = 0;

  for (const line of raw.split("\n")) {
    if (line.startsWith("diff --git")) {
      if (current) files.push(current);
      const m = line.match(/diff --git a\/(.*) b\/(.*)/);
      current = { path: m ? m[2] : line, hunks: [] };
    } else if (line.startsWith("--- ") || line.startsWith("+++ ")) {
      // skip
    } else if (line.startsWith("@@ ")) {
      const m = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (m) { aLine = parseInt(m[1]); bLine = parseInt(m[2]); }
      if (current) current.hunks.push({ header: line, lines: [] });
    } else if (current && current.hunks.length) {
      const hunk = current.hunks[current.hunks.length - 1];
      if (line.startsWith("+")) {
        hunk.lines.push({ type: "add", text: line.slice(1), bLine: bLine++ });
      } else if (line.startsWith("-")) {
        hunk.lines.push({ type: "del", text: line.slice(1), aLine: aLine++ });
      } else {
        hunk.lines.push({ type: "ctx", text: line.slice(1), aLine: aLine++, bLine: bLine++ });
      }
    }
  }
  if (current) files.push(current);
  return files;
}

// ─── Diff line component with inline comment trigger ─────────────────────────

function DiffLine({ line, filepath, onAddComment, reviewComments }) {
  const lineNo = line.bLine ?? line.aLine;
  const existing = reviewComments.filter(
    c => c.filepath === filepath && c.line === lineNo
  );

  const [hover, setHover] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [posting, setPosting] = useState(false);

  const bgColor = line.type === "add" ? "#0d2818" : line.type === "del" ? "#2d0f0f" : "transparent";
  const textColor = line.type === "add" ? "#4ade80" : line.type === "del" ? "#f87171" : "#c9d1d9";
  const prefix = line.type === "add" ? "+" : line.type === "del" ? "−" : " ";

  async function submitComment(e) {
    e.preventDefault();
    if (!commentText.trim() || !lineNo) return;
    setPosting(true);
    try {
      await onAddComment(filepath, lineNo, commentText.trim());
      setCommentText(""); setShowForm(false);
    } finally { setPosting(false); }
  }

  return (
    <>
      <div
        style={{ display: "flex", backgroundColor: bgColor, position: "relative" }}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
      >
        {/* Line numbers */}
        <span style={{
          minWidth: 42, padding: "1px 8px", textAlign: "right",
          fontSize: "0.72rem", color: "#4b5563", userSelect: "none",
          borderRight: "1px solid #21262d", flexShrink: 0,
          fontFamily: "monospace",
        }}>
          {line.aLine ?? ""}
        </span>
        <span style={{
          minWidth: 42, padding: "1px 8px", textAlign: "right",
          fontSize: "0.72rem", color: "#4b5563", userSelect: "none",
          borderRight: "1px solid #21262d", flexShrink: 0,
          fontFamily: "monospace",
        }}>
          {line.bLine ?? ""}
        </span>

        {/* Prefix */}
        <span style={{
          width: 20, padding: "1px 4px", color: textColor,
          fontFamily: "monospace", fontSize: "0.82rem", userSelect: "none",
          flexShrink: 0,
        }}>{prefix}</span>

        {/* Code */}
        <span style={{
          flex: 1, padding: "1px 8px 1px 0",
          fontFamily: "monospace", fontSize: "0.82rem", color: textColor,
          whiteSpace: "pre", overflow: "hidden",
        }}>{line.text}</span>

        {/* Add comment button on hover */}
        {hover && lineNo && (
          <button
            onClick={() => setShowForm(v => !v)}
            title="Add comment"
            style={{
              position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)",
              background: "#1f6feb", border: "none", borderRadius: 4,
              color: "#fff", cursor: "pointer", padding: "2px 8px",
              fontSize: "0.72rem", fontWeight: 700, zIndex: 2,
            }}
          >+ Comment</button>
        )}
      </div>

      {/* Inline comment form */}
      {showForm && (
        <div style={{
          background: "#161b22", border: "1px solid #30363d",
          borderRadius: 6, margin: "4px 8px 4px 104px", padding: 10,
        }}>
          <form onSubmit={submitComment}>
            <textarea
              autoFocus value={commentText}
              onChange={e => setCommentText(e.target.value)}
              placeholder="Write a comment…"
              rows={3}
              style={{
                width: "100%", boxSizing: "border-box",
                background: "#0d1117", color: "#e2e8f0",
                border: "1px solid #30363d", borderRadius: 5,
                padding: "7px 10px", fontSize: "0.83rem",
                resize: "vertical", outline: "none", marginBottom: 6,
              }}
            />
            <div style={{ display: "flex", gap: 6 }}>
              <button type="submit" disabled={posting || !commentText.trim()} style={{
                padding: "5px 14px", fontSize: "0.8rem", fontWeight: 600,
                backgroundColor: "#1f6feb", color: "#fff",
                border: "none", borderRadius: 5, cursor: "pointer",
              }}>{posting ? "Posting…" : "Add Comment"}</button>
              <button type="button" onClick={() => setShowForm(false)} style={{
                padding: "5px 12px", fontSize: "0.8rem",
                background: "transparent", color: "#8c9bab",
                border: "1px solid #30363d", borderRadius: 5, cursor: "pointer",
              }}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {/* Existing inline comments */}
      {existing.map((c, i) => (
        <div key={i} style={{
          background: "#0d2033", border: "1px solid #1f6feb",
          borderRadius: 6, margin: "3px 8px 3px 104px", padding: "8px 12px",
          fontSize: "0.82rem", color: "#c9d1d9",
        }}>
          <strong style={{ color: "#579dff" }}>You</strong> · just now
          <p style={{ margin: "4px 0 0" }}>{c.text}</p>
        </div>
      ))}
    </>
  );
}

// ─── File diff block ─────────────────────────────────────────────────────────

function FileDiff({ file, onAddComment, reviewComments, aiIssues }) {
  const [collapsed, setCollapsed] = useState(false);
  const fileIssues = aiIssues.filter(i => i.file === file.path);

  return (
    <div style={{
      border: "1px solid #21262d", borderRadius: 8,
      overflow: "hidden", marginBottom: 16,
    }}>
      {/* File header */}
      <div
        onClick={() => setCollapsed(v => !v)}
        style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "10px 14px", background: "#161b22",
          cursor: "pointer", userSelect: "none",
          borderBottom: collapsed ? "none" : "1px solid #21262d",
        }}
      >
        <span style={{ color: "#4b5563", fontSize: "0.8rem" }}>{collapsed ? "▶" : "▼"}</span>
        <span style={{
          fontFamily: "monospace", fontSize: "0.83rem", color: "#c9d1d9", flex: 1,
        }}>{file.path}</span>
        {fileIssues.length > 0 && (
          <span style={{
            background: "#450a0a", color: "#f87171",
            border: "1px solid #6b2737", borderRadius: 4,
            padding: "1px 8px", fontSize: "0.7rem", fontWeight: 700,
          }}>⚠ {fileIssues.length} AI issue{fileIssues.length > 1 ? "s" : ""}</span>
        )}
      </div>

      {/* AI issues for this file */}
      {!collapsed && fileIssues.length > 0 && (
        <div style={{ background: "#160b0b", padding: "8px 14px", borderBottom: "1px solid #21262d" }}>
          {fileIssues.map((issue, i) => (
            <div key={i} style={{ fontSize: "0.8rem", color: "#f87171", marginBottom: 3 }}>
              ⚠ {issue.description || issue.message}
            </div>
          ))}
        </div>
      )}

      {/* Diff hunks */}
      {!collapsed && file.hunks.map((hunk, hi) => (
        <div key={hi}>
          <div style={{
            background: "#0d2033", padding: "3px 10px",
            fontFamily: "monospace", fontSize: "0.75rem", color: "#579dff",
            borderBottom: "1px solid #21262d",
          }}>{hunk.header}</div>
          {hunk.lines.map((line, li) => (
            <DiffLine
              key={li} line={line} filepath={file.path}
              onAddComment={onAddComment}
              reviewComments={reviewComments}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

// ─── Main PRDetail page ───────────────────────────────────────────────────────

const TABS = ["Changes", "AI Review"];

export default function PRDetail({ pr, repo, onBack }) {
  const [tab, setTab]               = useState("Changes");
  const [diff, setDiff]             = useState(null);
  const [diffLoading, setDiffLoading] = useState(true);
  const [diffError, setDiffError]   = useState(null);
  const [review, setReview]         = useState(null);
  const [reviewing, setReviewing]   = useState(false);
  const [reviewError, setReviewError] = useState(null);
  const [reviewComments, setReviewComments] = useState([]);
  const [commentError, setCommentError] = useState(null);
  const [postedCount, setPostedCount] = useState(0);

  // Load diff on mount
  useEffect(() => {
    if (!repo || !pr) return;
    getPRDiff(repo.id, pr.pr_id)
      .then(data => setDiff(data))
      .catch(e => setDiffError(e.message))
      .finally(() => setDiffLoading(false));
  }, [repo?.id, pr?.pr_id]);

  async function handleReview() {
    setReviewing(true); setReviewError(null);
    try {
      const data = await analyzeHybrid(pr.pr_url);
      setReview(data);
      setTab("AI Review");
    } catch (e) { setReviewError(e.message); }
    finally { setReviewing(false); }
  }

  async function handleAddComment(filepath, line, text) {
    setCommentError(null);
    try {
      await postPRComment(repo.id, pr.pr_id, text, filepath, line);
      setReviewComments(prev => [...prev, { filepath, line, text }]);
      setPostedCount(c => c + 1);
    } catch (e) {
      setCommentError(`Failed to post comment: ${e.message}`);
    }
  }

  const parsedFiles = diff?.diff ? parseDiff(diff.diff) : [];
  const aiIssues = review
    ? [
        ...(review.llm_detected_issues || []),
        ...(review.llm_security_concerns || []),
        ...(review.static_analysis_issues || []).map(i => ({ file: i.file, description: `[${i.rule}] ${i.message}` })),
      ]
    : [];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>

      {/* Top bar */}
      <div style={{
        padding: "16px 24px", borderBottom: "1px solid #21262d",
        background: "#0d1117", flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <button onClick={onBack} style={{
            background: "none", border: "none", cursor: "pointer",
            color: "#579dff", fontWeight: 600, fontSize: "0.85rem", padding: 0,
          }}>← {repo?.repo_slug}</button>
          <span style={{ color: "#30363d" }}>/</span>
          <span style={{ color: "#6b7280", fontSize: "0.85rem" }}>Pull request #{pr.pr_id}</span>
        </div>

        <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
          <div style={{ flex: 1 }}>
            <h1 style={{ margin: "0 0 4px", fontSize: "1.15rem", color: "#e2e8f0", fontWeight: 700 }}>
              {pr.title}
            </h1>
            <p style={{ margin: 0, fontSize: "0.82rem", color: "#6b7280" }}>
              #{pr.pr_id} · {pr.author}
              {pr.created_at && ` · ${new Date(pr.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`}
            </p>
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
            {postedCount > 0 && (
              <span style={{
                fontSize: "0.78rem", color: "#4ade80",
                background: "#1a4731", border: "1px solid #166534",
                borderRadius: 4, padding: "3px 10px",
              }}>✓ {postedCount} comment{postedCount > 1 ? "s" : ""} posted</span>
            )}
            <button
              onClick={handleReview}
              disabled={reviewing}
              style={{
                padding: "7px 18px", fontSize: "0.85rem", fontWeight: 700,
                backgroundColor: reviewing ? "#1a3a6b" : "#1f6feb",
                color: "#fff", border: "none", borderRadius: 6,
                cursor: reviewing ? "not-allowed" : "pointer",
                display: "flex", alignItems: "center", gap: 6,
              }}
            >
              {reviewing && (
                <span style={{
                  width: 12, height: 12, borderRadius: "50%",
                  border: "2px solid rgba(255,255,255,0.3)",
                  borderTopColor: "#fff", display: "inline-block",
                  animation: "spin 0.7s linear infinite",
                }} />
              )}
              {reviewing ? "Analyzing…" : review ? "Re-analyze" : "AI Review"}
            </button>
          </div>
        </div>

        {reviewError && (
          <div style={{
            marginTop: 10, padding: "8px 12px", borderRadius: 6,
            background: "#450a0a", border: "1px solid #6b2737",
            color: "#f87171", fontSize: "0.82rem",
          }}>{reviewError}</div>
        )}
        {commentError && (
          <div style={{
            marginTop: 10, padding: "8px 12px", borderRadius: 6,
            background: "#450a0a", border: "1px solid #6b2737",
            color: "#f87171", fontSize: "0.82rem",
          }}>{commentError}</div>
        )}
      </div>

      {/* Tabs */}
      <div style={{
        display: "flex", gap: 0, borderBottom: "1px solid #21262d",
        background: "#0d1117", flexShrink: 0, padding: "0 24px",
      }}>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: "10px 16px", fontSize: "0.85rem", fontWeight: 600,
            background: "none", border: "none", cursor: "pointer",
            color: tab === t ? "#e2e8f0" : "#6b7280",
            borderBottom: tab === t ? "2px solid #1f6feb" : "2px solid transparent",
            marginBottom: -1, transition: "color 0.12s",
          }}>
            {t}
            {t === "Changes" && parsedFiles.length > 0 && (
              <span style={{
                marginLeft: 6, background: "#21262d", borderRadius: 10,
                padding: "1px 7px", fontSize: "0.7rem", color: "#8c9bab",
              }}>{parsedFiles.length}</span>
            )}
            {t === "AI Review" && review && (
              <span style={{
                marginLeft: 6, borderRadius: 10, padding: "1px 7px",
                fontSize: "0.7rem", fontWeight: 700,
                background: review.risk_level === "HIGH" ? "#450a0a" : review.risk_level === "MEDIUM" ? "#431407" : "#1a4731",
                color: review.risk_level === "HIGH" ? "#f87171" : review.risk_level === "MEDIUM" ? "#fb923c" : "#4ade80",
              }}>{review.risk_level}</span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>

        {/* Changes tab */}
        {tab === "Changes" && (
          <>
            {diffLoading && <Spinner />}
            {diffError && (
              <div style={{
                padding: "12px 16px", borderRadius: 8,
                background: "#450a0a", border: "1px solid #6b2737",
                color: "#f87171", fontSize: "0.85rem",
              }}>{diffError}</div>
            )}
            {!diffLoading && !diffError && parsedFiles.length === 0 && (
              <p style={{ color: "#4b5563" }}>No diff available for this PR.</p>
            )}
            {!diffLoading && parsedFiles.map((file, i) => (
              <FileDiff
                key={i} file={file}
                onAddComment={handleAddComment}
                reviewComments={reviewComments}
                aiIssues={aiIssues}
              />
            ))}
          </>
        )}

        {/* AI Review tab */}
        {tab === "AI Review" && (
          <>
            {!review && !reviewing && (
              <div style={{
                textAlign: "center", padding: "60px 20px", color: "#4b5563",
              }}>
                <div style={{ fontSize: "2.5rem", marginBottom: 12 }}>🤖</div>
                <p style={{ margin: "0 0 16px" }}>
                  Click <strong style={{ color: "#8c9bab" }}>AI Review</strong> to run the full hybrid analysis on this PR.
                </p>
                <button onClick={handleReview} style={{
                  padding: "8px 20px", fontSize: "0.85rem", fontWeight: 700,
                  backgroundColor: "#1f6feb", color: "#fff",
                  border: "none", borderRadius: 6, cursor: "pointer",
                }}>Run AI Review</button>
              </div>
            )}
            {reviewing && <Spinner />}
            {review && <HybridResultCard data={review} />}
          </>
        )}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
