import { useState, useEffect } from "react";
import { analyzeHybrid, getPRDiff, postPRComment, postReviewComments } from "../api/client";
import Spinner from "../components/Spinner";
import HybridResultCard from "../components/HybridResultCard";

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

function DiffLine({ line, filepath, onAddComment, reviewComments }) {
  const lineNo = line.bLine ?? line.aLine;
  const existing = reviewComments.filter(c => c.filepath === filepath && c.line === lineNo);
  const [hover, setHover] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [posting, setPosting] = useState(false);

  const bgColor = line.type === "add" ? "#e6ffec" : line.type === "del" ? "#ffebe9" : "transparent";
  const textColor = line.type === "add" ? "#116329" : line.type === "del" ? "#82071e" : "var(--text)";
  const numColor = line.type === "add" ? "#4ac26b" : line.type === "del" ? "#f5c6c2" : "var(--text-muted)";
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
        <span style={{
          minWidth: 42, padding: "1px 8px", textAlign: "right",
          fontSize: "0.72rem", color: numColor, userSelect: "none",
          borderRight: "1px solid var(--border)", flexShrink: 0,
          fontFamily: "monospace",
        }}>{line.aLine ?? ""}</span>
        <span style={{
          minWidth: 42, padding: "1px 8px", textAlign: "right",
          fontSize: "0.72rem", color: numColor, userSelect: "none",
          borderRight: "1px solid var(--border)", flexShrink: 0,
          fontFamily: "monospace",
        }}>{line.bLine ?? ""}</span>
        <span style={{
          width: 20, padding: "1px 4px", color: textColor,
          fontFamily: "monospace", fontSize: "0.82rem", userSelect: "none", flexShrink: 0,
        }}>{prefix}</span>
        <span style={{
          flex: 1, padding: "1px 8px 1px 0",
          fontFamily: "monospace", fontSize: "0.82rem", color: textColor,
          whiteSpace: "pre", overflow: "hidden",
        }}>{line.text}</span>
        {hover && lineNo && (
          <button
            onClick={() => setShowForm(v => !v)}
            style={{
              position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)",
              background: "var(--blue)", border: "none", borderRadius: 4,
              color: "#fff", cursor: "pointer", padding: "2px 8px",
              fontSize: "0.72rem", fontWeight: 700, zIndex: 2,
            }}
          >+ Comment</button>
        )}
      </div>

      {showForm && (
        <div style={{
          background: "var(--blue-bg)", border: "1px solid var(--blue-border)",
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
                background: "var(--surface)", color: "var(--text)",
                border: "1px solid var(--border)", borderRadius: 5,
                padding: "7px 10px", fontSize: "0.83rem",
                resize: "vertical", outline: "none", marginBottom: 6,
              }}
            />
            <div style={{ display: "flex", gap: 6 }}>
              <button type="submit" disabled={posting || !commentText.trim()} style={{
                padding: "5px 14px", fontSize: "0.8rem", fontWeight: 600,
                backgroundColor: "var(--blue)", color: "#fff",
                border: "none", borderRadius: 5, cursor: "pointer",
              }}>{posting ? "Posting…" : "Add Comment"}</button>
              <button type="button" onClick={() => setShowForm(false)} style={{
                padding: "5px 12px", fontSize: "0.8rem",
                background: "var(--surface)", color: "var(--text-secondary)",
                border: "1px solid var(--border)", borderRadius: 5, cursor: "pointer",
              }}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {existing.map((c, i) => (
        <div key={i} style={{
          background: "var(--blue-bg)", border: "1px solid var(--blue-border)",
          borderRadius: 6, margin: "3px 8px 3px 104px", padding: "8px 12px",
          fontSize: "0.82rem", color: "var(--text)",
        }}>
          <strong style={{ color: "var(--blue)" }}>You</strong>
          <span style={{ color: "var(--text-muted)" }}> · just now</span>
          <p style={{ margin: "4px 0 0" }}>{c.text}</p>
        </div>
      ))}
    </>
  );
}

function FileDiff({ file, onAddComment, reviewComments, aiIssues }) {
  const [collapsed, setCollapsed] = useState(false);
  const fileIssues = aiIssues.filter(i => i.file === file.path);

  return (
    <div style={{
      border: "1px solid var(--border)", borderRadius: 8,
      overflow: "hidden", marginBottom: 12,
    }}>
      <div
        onClick={() => setCollapsed(v => !v)}
        style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "9px 14px", background: "var(--surface-2)",
          cursor: "pointer", userSelect: "none",
          borderBottom: collapsed ? "none" : "1px solid var(--border)",
        }}
      >
        <span style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>{collapsed ? "▶" : "▼"}</span>
        <span style={{
          fontFamily: "monospace", fontSize: "0.82rem", color: "var(--text)", flex: 1, fontWeight: 500,
        }}>{file.path}</span>
        {fileIssues.length > 0 && (
          <span style={{
            background: "var(--red-bg)", color: "var(--red)",
            border: "1px solid var(--red-border)", borderRadius: 20,
            padding: "1px 8px", fontSize: "0.7rem", fontWeight: 700,
          }}>⚠ {fileIssues.length} issue{fileIssues.length > 1 ? "s" : ""}</span>
        )}
      </div>

      {!collapsed && fileIssues.length > 0 && (
        <div style={{ background: "var(--red-bg)", padding: "8px 14px", borderBottom: "1px solid var(--red-border)" }}>
          {fileIssues.map((issue, i) => (
            <div key={i} style={{ fontSize: "0.8rem", color: "var(--red)", marginBottom: 3 }}>
              ⚠ {issue.description || issue.message}
            </div>
          ))}
        </div>
      )}

      {!collapsed && file.hunks.map((hunk, hi) => (
        <div key={hi}>
          <div style={{
            background: "var(--blue-bg)", padding: "3px 10px",
            fontFamily: "monospace", fontSize: "0.75rem", color: "var(--blue)",
            borderBottom: "1px solid var(--blue-border)",
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

const TABS = ["Changes", "AI Review"];

export default function PRDetail({ pr, repo, onBack }) {
  const [tab, setTab]                     = useState("Changes");
  const [diff, setDiff]                   = useState(null);
  const [diffLoading, setDiffLoading]     = useState(true);
  const [diffError, setDiffError]         = useState(null);
  const [review, setReview]               = useState(null);
  const [reviewing, setReviewing]         = useState(false);
  const [reviewError, setReviewError]     = useState(null);
  const [reviewComments, setReviewComments] = useState([]);
  const [commentError, setCommentError]     = useState(null);
  const [postedCount, setPostedCount]       = useState(0);
  const [posting, setPosting]               = useState(false);
  const [postResult, setPostResult]         = useState(null);

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

  async function handlePostReviewComments() {
    if (!review) return;
    setPosting(true);
    setCommentError(null);
    setPostResult(null);
    try {
      const result = await postReviewComments(repo.id, pr.pr_id, review);
      setPostResult(result);
    } catch (e) {
      setCommentError(`Failed to post review comments: ${e.message}`);
    } finally {
      setPosting(false);
    }
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
  const aiIssues = review ? [
    ...(review.llm_detected_issues || []),
    ...(review.llm_security_concerns || []),
    ...(review.static_analysis_issues || []).map(i => ({ file: i.file, description: `[${i.rule}] ${i.message}` })),
  ] : [];

  const riskBg  = review?.risk_level === "HIGH" ? "var(--red-bg)"
                : review?.risk_level === "MEDIUM" ? "var(--orange-bg)"
                : "var(--green-bg)";
  const riskColor = review?.risk_level === "HIGH" ? "var(--red)"
                  : review?.risk_level === "MEDIUM" ? "var(--orange)"
                  : "var(--green)";
  const riskBorder = review?.risk_level === "HIGH" ? "var(--red-border)"
                   : review?.risk_level === "MEDIUM" ? "var(--orange-border)"
                   : "var(--green-border)";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", background: "var(--bg)" }}>

      {/* Top bar */}
      <div style={{
        padding: "14px 24px", borderBottom: "1px solid var(--border)",
        background: "var(--surface)", flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
          <button onClick={onBack} style={{
            background: "none", border: "none", cursor: "pointer",
            color: "var(--blue)", fontWeight: 600, fontSize: "0.85rem", padding: 0,
          }}>← {repo?.repo_slug}</button>
          <span style={{ color: "var(--border-strong)" }}>/</span>
          <span style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>Pull request #{pr.pr_id}</span>
        </div>

        <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
          <div style={{ flex: 1 }}>
            <h1 style={{ margin: "0 0 3px", fontSize: "1.1rem", color: "var(--text)", fontWeight: 700 }}>
              {pr.title}
            </h1>
            <p style={{ margin: 0, fontSize: "0.82rem", color: "var(--text-secondary)" }}>
              #{pr.pr_id} · {pr.author}
              {pr.created_at && ` · ${new Date(pr.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`}
            </p>
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0, flexWrap: "wrap" }}>
            {postedCount > 0 && (
              <span style={{
                fontSize: "0.78rem", color: "var(--green)",
                background: "var(--green-bg)", border: "1px solid var(--green-border)",
                borderRadius: 20, padding: "3px 10px",
              }}>✓ {postedCount} comment{postedCount > 1 ? "s" : ""} posted</span>
            )}
            {postResult && (
              <span style={{
                fontSize: "0.78rem", color: "var(--green)",
                background: "var(--green-bg)", border: "1px solid var(--green-border)",
                borderRadius: 20, padding: "3px 10px",
              }}>✓ {postResult.posted} issue{postResult.posted !== 1 ? "s" : ""} posted to PR
                {postResult.skipped > 0 && `, ${postResult.skipped} skipped`}
              </span>
            )}
            {review && (() => {
              const issueCount = (review.llm_detected_issues?.length || 0)
                + (review.llm_security_concerns?.length || 0)
                + (review.llm_performance_concerns?.length || 0)
                + (review.llm_code_smells?.length || 0)
                + (review.static_analysis_issues?.length || 0);
              return issueCount > 0 ? (
                <button
                  onClick={handlePostReviewComments}
                  disabled={posting}
                  style={{
                    padding: "7px 14px", fontSize: "0.82rem", fontWeight: 600,
                    backgroundColor: posting ? "var(--surface-2)" : "var(--orange-bg)",
                    color: posting ? "var(--text-muted)" : "var(--orange)",
                    border: "1px solid var(--orange-border)", borderRadius: 6,
                    cursor: posting ? "not-allowed" : "pointer",
                    display: "flex", alignItems: "center", gap: 6,
                  }}
                >
                  {posting && (
                    <span style={{
                      width: 11, height: 11, borderRadius: "50%",
                      border: "2px solid var(--orange-border)",
                      borderTopColor: "var(--orange)", display: "inline-block",
                      animation: "spin 0.7s linear infinite",
                    }} />
                  )}
                  {posting ? "Posting…" : `Post Issues to PR (${issueCount})`}
                </button>
              ) : null;
            })()}
            <button
              onClick={handleReview}
              disabled={reviewing}
              style={{
                padding: "7px 18px", fontSize: "0.85rem", fontWeight: 700,
                backgroundColor: "var(--blue)", color: "#fff",
                border: "none", borderRadius: 6,
                cursor: reviewing ? "not-allowed" : "pointer",
                opacity: reviewing ? 0.7 : 1,
                display: "flex", alignItems: "center", gap: 6,
              }}
            >
              {reviewing && (
                <span style={{
                  width: 12, height: 12, borderRadius: "50%",
                  border: "2px solid rgba(255,255,255,0.4)",
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
            background: "var(--red-bg)", border: "1px solid var(--red-border)",
            color: "var(--red)", fontSize: "0.82rem",
          }}>{reviewError}</div>
        )}
        {commentError && (
          <div style={{
            marginTop: 8, padding: "8px 12px", borderRadius: 6,
            background: "var(--red-bg)", border: "1px solid var(--red-border)",
            color: "var(--red)", fontSize: "0.82rem",
          }}>{commentError}</div>
        )}
      </div>

      {/* Tabs */}
      <div style={{
        display: "flex", borderBottom: "1px solid var(--border)",
        background: "var(--surface)", flexShrink: 0, padding: "0 24px",
      }}>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: "10px 16px", fontSize: "0.85rem", fontWeight: 600,
            background: "none", border: "none", cursor: "pointer",
            color: tab === t ? "var(--text)" : "var(--text-secondary)",
            borderBottom: tab === t ? "2px solid var(--blue)" : "2px solid transparent",
            marginBottom: -1,
          }}>
            {t}
            {t === "Changes" && parsedFiles.length > 0 && (
              <span style={{
                marginLeft: 6, background: "var(--surface-2)", borderRadius: 20,
                padding: "1px 7px", fontSize: "0.7rem", color: "var(--text-muted)",
                border: "1px solid var(--border)",
              }}>{parsedFiles.length}</span>
            )}
            {t === "AI Review" && review && (
              <span style={{
                marginLeft: 6, borderRadius: 20, padding: "1px 7px",
                fontSize: "0.7rem", fontWeight: 700,
                background: riskBg, color: riskColor, border: `1px solid ${riskBorder}`,
              }}>{review.risk_level}</span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px", background: "var(--bg)" }}>
        {tab === "Changes" && (
          <>
            {diffLoading && <Spinner />}
            {diffError && (
              <div style={{
                padding: "12px 16px", borderRadius: 8,
                background: "var(--red-bg)", border: "1px solid var(--red-border)",
                color: "var(--red)", fontSize: "0.85rem",
              }}>{diffError}</div>
            )}
            {!diffLoading && !diffError && parsedFiles.length === 0 && (
              <p style={{ color: "var(--text-muted)" }}>No diff available for this PR.</p>
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

        {tab === "AI Review" && (
          <>
            {!review && !reviewing && (
              <div style={{ textAlign: "center", padding: "60px 20px", color: "var(--text-muted)" }}>
                <div style={{ fontSize: "2.5rem", marginBottom: 12 }}>🤖</div>
                <p style={{ margin: "0 0 16px", fontSize: "0.9rem" }}>
                  Click <strong style={{ color: "var(--text-secondary)" }}>AI Review</strong> to run the full hybrid analysis.
                </p>
                <button onClick={handleReview} style={{
                  padding: "8px 20px", fontSize: "0.85rem", fontWeight: 700,
                  backgroundColor: "var(--blue)", color: "#fff",
                  border: "none", borderRadius: 6, cursor: "pointer",
                }}>Run AI Review</button>
              </div>
            )}
            {reviewing && (
              <div style={{ textAlign: "center", padding: "60px 20px" }}>
                <Spinner />
                <p style={{ color: "var(--text-secondary)", marginTop: 12, fontSize: "0.9rem" }}>
                  Analyzing pull request…
                </p>
              </div>
            )}
            {review && <HybridResultCard data={review} />}
          </>
        )}
      </div>
    </div>
  );
}
