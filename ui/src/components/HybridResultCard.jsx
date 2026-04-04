function Section({ title, count, children, defaultOpen = true, accent }) {
  return (
    <details open={defaultOpen} style={{ marginBottom: 20 }}>
      <summary style={{
        cursor: "pointer", padding: "8px 0", userSelect: "none",
        display: "flex", alignItems: "center", gap: 8,
        fontSize: "0.82rem", fontWeight: 700, color: "#8c9bab",
        textTransform: "uppercase", letterSpacing: "0.07em",
        listStyle: "none",
      }}>
        <span style={{
          display: "inline-block", width: 3, height: 14, borderRadius: 2,
          backgroundColor: accent || "#1f6feb", flexShrink: 0,
        }} />
        {title}
        {count != null && (
          <span style={{
            marginLeft: 4, background: "#21262d", color: "#6b7280",
            borderRadius: 10, padding: "1px 8px", fontSize: "0.7rem", fontWeight: 600,
          }}>{count}</span>
        )}
      </summary>
      <div style={{ paddingTop: 8 }}>{children}</div>
    </details>
  );
}

function Chip({ label, color = "#6b7280", bg = "#21262d" }) {
  return (
    <span style={{
      display: "inline-block", padding: "2px 8px", borderRadius: 4,
      fontSize: "0.7rem", fontWeight: 700, textTransform: "uppercase",
      letterSpacing: "0.05em", background: bg, color,
      marginRight: 6, flexShrink: 0,
    }}>{label}</span>
  );
}

function SeverityChip({ severity }) {
  const map = {
    critical: { color: "#f87171", bg: "#450a0a" },
    high:     { color: "#f87171", bg: "#450a0a" },
    error:    { color: "#f87171", bg: "#450a0a" },
    medium:   { color: "#fb923c", bg: "#431407" },
    warning:  { color: "#fb923c", bg: "#431407" },
    low:      { color: "#579dff", bg: "#0d2033" },
    info:     { color: "#8c9bab", bg: "#21262d" },
  };
  const s = (severity || "info").toLowerCase();
  const c = map[s] || map.info;
  return <Chip label={severity || "info"} color={c.color} bg={c.bg} />;
}

function IssueRow({ severity, title, file }) {
  const borderMap = {
    critical: "#6b2737", high: "#6b2737", error: "#6b2737",
    medium: "#78350f", warning: "#78350f",
  };
  const bgMap = {
    critical: "#160b0b", high: "#160b0b", error: "#160b0b",
    medium: "#160d00", warning: "#160d00",
  };
  const s = (severity || "").toLowerCase();
  return (
    <div style={{
      padding: "9px 12px", borderRadius: 6, marginBottom: 6,
      background: bgMap[s] || "#0d1117",
      border: `1px solid ${borderMap[s] || "#21262d"}`,
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
        <SeverityChip severity={severity} />
        <span style={{ fontSize: "0.85rem", color: "#c9d1d9", flex: 1 }}>{title}</span>
      </div>
      {file && (
        <div style={{
          fontFamily: "monospace", fontSize: "0.75rem",
          color: "#4b5563", marginTop: 4, paddingLeft: 2,
        }}>{file}</div>
      )}
    </div>
  );
}

function MetricBox({ label, value }) {
  return (
    <div style={{
      textAlign: "center", padding: "12px 8px",
      background: "#161b22", borderRadius: 6, border: "1px solid #21262d",
    }}>
      <div style={{ fontSize: "1.3rem", fontWeight: 700, color: "#e2e8f0" }}>{value}</div>
      <div style={{ fontSize: "0.72rem", color: "#6b7280", textTransform: "capitalize", marginTop: 2 }}>
        {String(label).replace(/_/g, " ")}
      </div>
    </div>
  );
}

function RiskBar({ score, level }) {
  const color = level === "HIGH" ? "#ef4444" : level === "MEDIUM" ? "#f97316" : "#22c55e";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <div style={{
        flex: 1, height: 8, background: "#21262d",
        borderRadius: 4, overflow: "hidden", maxWidth: 280,
      }}>
        <div style={{
          width: `${Math.round(score * 100)}%`, height: "100%",
          background: color, borderRadius: 4, transition: "width 0.4s",
        }} />
      </div>
      <span style={{ fontWeight: 700, fontSize: "1.1rem", color }}>{Math.round(score * 100)}%</span>
      <span style={{
        padding: "3px 12px", borderRadius: 20, fontWeight: 700, fontSize: "0.85rem",
        background: level === "HIGH" ? "#450a0a" : level === "MEDIUM" ? "#431407" : "#1a4731",
        color, border: `1.5px solid ${color}`,
      }}>{level}</span>
    </div>
  );
}

export default function HybridResultCard({ data }) {
  const dupCount    = (data.duplicate_warnings    || []).length;
  const vulnCount   = (data.security_warnings     || []).length;
  const staticCount = (data.static_analysis_issues|| []).length;
  const llmTotal    = (data.llm_detected_issues   || []).length
                    + (data.llm_security_concerns  || []).length
                    + (data.llm_performance_concerns || []).length
                    + (data.llm_code_smells        || []).length;

  return (
    <div style={{ color: "#c9d1d9" }}>

      {/* Risk */}
      <Section title="Risk Score" accent="#1f6feb">
        <RiskBar score={data.risk_score} level={data.risk_level} />
      </Section>

      {/* ML & Rules */}
      <Section
        title="ML & Rule Analysis"
        count={(data.ml_reasons || []).length + (data.rule_issues || []).length}
        accent="#7c3aed"
      >
        {(data.ml_reasons || []).map((r, i) => (
          <div key={i} style={{ fontSize: "0.85rem", color: "#8c9bab", marginBottom: 4, paddingLeft: 4 }}>
            · {r}
          </div>
        ))}
        {(data.rule_issues || []).map((issue, i) => (
          <IssueRow key={i} severity={issue.severity} title={`${issue.category} — ${issue.description}`} />
        ))}
        {!data.ml_reasons?.length && !data.rule_issues?.length && (
          <span style={{ fontSize: "0.83rem", color: "#4b5563" }}>No ML or rule findings.</span>
        )}
      </Section>

      {/* LLM Review */}
      <Section title="AI Code Review" count={llmTotal} accent="#0891b2">
        {data.llm_summary && (
          <div style={{
            padding: "10px 12px", borderRadius: 6, marginBottom: 10,
            background: "#0d2033", border: "1px solid #1f6feb",
            fontSize: "0.85rem", color: "#c9d1d9",
          }}>
            <strong style={{ color: "#579dff" }}>Summary:</strong> {data.llm_summary}
          </div>
        )}
        {(data.llm_detected_issues || []).map((i, idx) => (
          <IssueRow key={idx} severity={i.severity} title={i.description} file={i.file} />
        ))}
        {(data.llm_security_concerns || []).map((i, idx) => (
          <IssueRow key={`sec-${idx}`} severity={i.severity || "high"} title={i.description} file={i.file} />
        ))}
        {(data.llm_performance_concerns || []).map((i, idx) => (
          <IssueRow key={`perf-${idx}`} severity={i.severity || "medium"} title={i.description} file={i.file} />
        ))}
        {(data.llm_code_smells || []).map((i, idx) => (
          <IssueRow key={`smell-${idx}`} severity={i.severity || "low"} title={i.description} file={i.file} />
        ))}
        {llmTotal === 0 && !data.llm_summary && (
          <span style={{ fontSize: "0.83rem", color: "#4b5563" }}>LLM analysis not available.</span>
        )}
        {(data.llm_improvements || []).length > 0 && (
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: "0.75rem", color: "#6b7280", fontWeight: 700, marginBottom: 6, textTransform: "uppercase" }}>
              Suggested Improvements
            </div>
            {data.llm_improvements.map((imp, i) => (
              <div key={i} style={{ fontSize: "0.83rem", color: "#8c9bab", marginBottom: 4, paddingLeft: 4 }}>
                · {imp.description}
                {imp.file && <span style={{ fontFamily: "monospace", fontSize: "0.75rem", color: "#4b5563" }}> ({imp.file})</span>}
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Security */}
      <Section title="Dependency Security" count={vulnCount} accent="#ef4444">
        {vulnCount === 0 ? (
          <span style={{ fontSize: "0.83rem", color: "#22c55e" }}>✓ No vulnerable dependencies detected</span>
        ) : (data.security_warnings || []).map((v, i) => (
          <IssueRow
            key={i} severity={v.severity}
            title={`${v.package}@${v.version} — ${v.vuln_id}: ${v.summary}`}
          />
        ))}
      </Section>

      {/* Static analysis */}
      <Section title="Static Analysis" count={staticCount} accent="#f59e0b">
        {data.static_tools_run?.length > 0 && (
          <div style={{ fontSize: "0.75rem", color: "#4b5563", marginBottom: 8 }}>
            Tools: {data.static_tools_run.join(", ")}
            {data.static_tools_unavailable?.length > 0 && ` · Unavailable: ${data.static_tools_unavailable.join(", ")}`}
          </div>
        )}
        {staticCount === 0 ? (
          <span style={{ fontSize: "0.83rem", color: "#22c55e" }}>✓ No static analysis issues</span>
        ) : (data.static_analysis_issues || []).map((i, idx) => (
          <IssueRow key={idx} severity={i.severity} title={`[${i.rule}] ${i.message}`} file={`${i.file}:${i.line}`} />
        ))}
      </Section>

      {/* Duplicate warnings */}
      {dupCount > 0 && (
        <Section title="Code Reuse Opportunities" count={dupCount} accent="#f59e0b">
          {(data.duplicate_warnings || []).map((w, i) => (
            <div key={i} style={{
              padding: "10px 12px", borderRadius: 6, marginBottom: 8,
              background: "#160d00", border: "1px solid #78350f",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <Chip
                  label={`${Math.round(w.similarity * 100)}% similar`}
                  color="#fb923c" bg="#431407"
                />
                <span style={{ fontSize: "0.85rem", color: "#c9d1d9", fontWeight: 600 }}>
                  {w.new_chunk_name || w.new_filepath}
                </span>
              </div>
              <div style={{ fontSize: "0.8rem", color: "#8c9bab" }}>
                Similar to <code style={{
                  background: "#21262d", padding: "1px 5px", borderRadius: 3,
                  fontFamily: "monospace", fontSize: "0.78rem",
                }}>{w.existing_name || w.existing_filepath}</code>
                {" in "}
                <span style={{ fontFamily: "monospace", fontSize: "0.78rem", color: "#6b7280" }}>
                  {w.existing_filepath}
                </span>
              </div>
              {w.existing_code_snippet && (
                <pre style={{
                  margin: "6px 0 0", fontSize: "0.73rem", color: "#6b7280",
                  background: "#0d1117", padding: "6px 8px", borderRadius: 4,
                  overflow: "auto", maxHeight: 80, whiteSpace: "pre-wrap",
                }}>{w.existing_code_snippet}</pre>
              )}
            </div>
          ))}
        </Section>
      )}

      {/* Graph / Impact Analysis */}
      {data.graph_context?.available && (
        <Section
          title="Impact Analysis"
          count={
            (data.graph_context.affected_functions || []).length +
            (data.graph_context.affected_flows || []).length
          }
          accent="#06b6d4"
        >
          {data.graph_context.impact_summary && (
            <div style={{
              fontSize: "0.85rem", color: "#8c9bab", marginBottom: 10,
              padding: "8px 12px", background: "#0d1f2d",
              borderRadius: 6, border: "1px solid #164e63",
            }}>
              {data.graph_context.impact_summary}
            </div>
          )}

          {(data.graph_context.affected_functions || []).length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: "0.72rem", color: "#4b5563", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 5 }}>
                Affected Functions ({data.graph_context.affected_functions.length})
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                {data.graph_context.affected_functions.slice(0, 12).map((fn, i) => (
                  <span key={i} style={{
                    background: "#0d1f2d", border: "1px solid #164e63",
                    borderRadius: 4, padding: "2px 8px",
                    fontFamily: "monospace", fontSize: "0.78rem", color: "#67e8f9",
                  }}>{fn.name || fn}</span>
                ))}
                {data.graph_context.affected_functions.length > 12 && (
                  <span style={{ fontSize: "0.78rem", color: "#4b5563" }}>
                    +{data.graph_context.affected_functions.length - 12} more
                  </span>
                )}
              </div>
            </div>
          )}

          {(data.graph_context.affected_flows || []).length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: "0.72rem", color: "#4b5563", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 5 }}>
                Execution Flows ({data.graph_context.affected_flows.length})
              </div>
              {data.graph_context.affected_flows.slice(0, 5).map((flow, i) => (
                <div key={i} style={{
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "5px 10px", borderRadius: 5, marginBottom: 4,
                  background: "#0d1117", border: "1px solid #21262d",
                  fontSize: "0.82rem",
                }}>
                  <span style={{ fontFamily: "monospace", color: "#67e8f9", flex: 1 }}>
                    {flow.name || flow}
                  </span>
                  {flow.depth != null && (
                    <span style={{ fontSize: "0.72rem", color: "#4b5563" }}>depth: {flow.depth}</span>
                  )}
                  {flow.criticality > 0.7 && (
                    <span style={{
                      background: "#450a0a", color: "#f87171",
                      borderRadius: 4, padding: "1px 6px", fontSize: "0.68rem", fontWeight: 700,
                    }}>CRITICAL</span>
                  )}
                </div>
              ))}
            </div>
          )}

          {(data.graph_context.affected_communities || []).length > 0 && (
            <div>
              <div style={{ fontSize: "0.72rem", color: "#4b5563", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 5 }}>
                Affected Modules
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                {data.graph_context.affected_communities.map((c, i) => (
                  <span key={i} style={{
                    background: "#1a2035", border: "1px solid #1e3a5f",
                    borderRadius: 4, padding: "2px 8px",
                    fontSize: "0.78rem", color: "#93c5fd",
                  }}>{c}</span>
                ))}
              </div>
            </div>
          )}

          {data.graph_context.risk_score_boost > 0 && (
            <div style={{
              marginTop: 10, padding: "6px 10px", borderRadius: 5,
              background: "#2d1515", border: "1px solid #6b2737",
              fontSize: "0.8rem", color: "#f87171",
            }}>
              ⚠ Risk boosted +{(data.graph_context.risk_score_boost * 100).toFixed(0)}% due to critical execution flows
            </div>
          )}
        </Section>
      )}

      {/* Recommendations */}
      {(data.recommendations || []).length > 0 && (
        <Section title="Recommendations" accent="#22c55e">
          {data.recommendations.map((r, i) => (
            <div key={i} style={{ fontSize: "0.85rem", color: "#8c9bab", marginBottom: 5, paddingLeft: 4 }}>
              → {r}
            </div>
          ))}
        </Section>
      )}

      {/* Metrics */}
      <Section title="Metrics" defaultOpen={false} accent="#4b5563">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(110px,1fr))", gap: 8 }}>
          {Object.entries(data.metrics || {}).map(([k, v]) => (
            <MetricBox key={k} label={k} value={v} />
          ))}
        </div>
      </Section>
    </div>
  );
}
