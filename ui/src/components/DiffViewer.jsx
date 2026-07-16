import { useState } from "react";

export function parseDiff(raw) {
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
  const textColor = line.type === "add" ? "#116329" : line.type === "del" ? "#82071e" : "#24292f";
  const numColor = line.type === "add" ? "#4ac26b" : line.type === "del" ? "#f5c6c2" : "#8c959f";
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
          borderRight: "1px solid #d0d7de", flexShrink: 0,
          fontFamily: "monospace",
        }}>{line.aLine ?? ""}</span>
        <span style={{
          minWidth: 42, padding: "1px 8px", textAlign: "right",
          fontSize: "0.72rem", color: numColor, userSelect: "none",
          borderRight: "1px solid #d0d7de", flexShrink: 0,
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
              background: "#0969da", border: "none", borderRadius: 4,
              color: "#fff", cursor: "pointer", padding: "2px 8px",
              fontSize: "0.72rem", fontWeight: 700, zIndex: 2,
            }}
          >+ Comment</button>
        )}
      </div>

      {showForm && (
        <div style={{
          background: "#f6f8fa", border: "1px solid #d0d7de",
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
                background: "#fff", color: "#24292f",
                border: "1px solid #d0d7de", borderRadius: 5,
                padding: "7px 10px", fontSize: "0.83rem",
                resize: "vertical", outline: "none", marginBottom: 6,
              }}
            />
            <div style={{ display: "flex", gap: 6 }}>
              <button type="submit" disabled={posting || !commentText.trim()} style={{
                padding: "5px 14px", fontSize: "0.8rem", fontWeight: 600,
                backgroundColor: "#0969da", color: "#fff",
                border: "none", borderRadius: 5, cursor: "pointer",
              }}>{posting ? "Posting…" : "Add Comment"}</button>
              <button type="button" onClick={() => setShowForm(false)} style={{
                padding: "5px 12px", fontSize: "0.8rem",
                background: "#f6f8fa", color: "#57606a",
                border: "1px solid #d0d7de", borderRadius: 5, cursor: "pointer",
              }}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {existing.map((c, i) => (
        <div key={i} style={{
          background: "#f6f8fa", border: "1px solid #d0d7de",
          borderRadius: 6, margin: "3px 8px 3px 104px", padding: "8px 12px",
          fontSize: "0.82rem", color: "#24292f",
        }}>
          <strong style={{ color: "#0969da" }}>You</strong>
          <span style={{ color: "#57606a" }}> · just now</span>
          <p style={{ margin: "4px 0 0" }}>{c.text}</p>
        </div>
      ))}
    </>
  );
}

export function FileDiff({ file, onAddComment, reviewComments, aiIssues }) {
  const [collapsed, setCollapsed] = useState(false);
  const fileIssues = aiIssues.filter(i => i.file === file.path);

  return (
    <div style={{
      border: "1px solid #d0d7de", borderRadius: 8,
      overflow: "hidden", marginBottom: 12,
    }}>
      <div
        onClick={() => setCollapsed(v => !v)}
        style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "9px 14px", background: "#f6f8fa",
          cursor: "pointer", userSelect: "none",
          borderBottom: collapsed ? "none" : "1px solid #d0d7de",
        }}
      >
        <span style={{ color: "#57606a", fontSize: "0.75rem" }}>{collapsed ? "▶" : "▼"}</span>
        <span style={{
          fontFamily: "monospace", fontSize: "0.82rem", color: "#24292f", flex: 1, fontWeight: 500,
        }}>{file.path}</span>
        {fileIssues.length > 0 && (
          <span style={{
            background: "#ffebe9", color: "#cf222e",
            border: "1px solid rgba(255,129,130,0.4)", borderRadius: 20,
            padding: "1px 8px", fontSize: "0.7rem", fontWeight: 700,
          }}>⚠ {fileIssues.length} issue{fileIssues.length > 1 ? "s" : ""}</span>
        )}
      </div>

      {!collapsed && fileIssues.length > 0 && (
        <div style={{ background: "#ffebe9", padding: "8px 14px", borderBottom: "1px solid rgba(255,129,130,0.4)" }}>
          {fileIssues.map((issue, i) => (
            <div key={i} style={{ fontSize: "0.8rem", color: "#cf222e", marginBottom: 3 }}>
              ⚠ {issue.description || issue.message}
            </div>
          ))}
        </div>
      )}

      {!collapsed && file.hunks.map((hunk, hi) => (
        <div key={hi}>
          <div style={{
            background: "#ddf4ff", padding: "3px 10px",
            fontFamily: "monospace", fontSize: "0.75rem", color: "#0969da",
            borderBottom: "1px solid rgba(84,174,255,0.4)",
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
