function Section({ title, count, children, defaultOpen = true, accent }) {
  return (
    <details open={defaultOpen} style={{ marginBottom: 16 }}>
      <summary style={{
        cursor: "pointer", padding: "10px 0 8px", userSelect: "none",
        display: "flex", alignItems: "center", gap: 8,
        fontSize: "0.78rem", fontWeight: 700, color: "var(--text-secondary)",
        textTransform: "uppercase", letterSpacing: "0.07em",
        listStyle: "none", borderBottom: "1px solid var(--border)",
      }}>
        <span style={{
          display: "inline-block", width: 3, height: 14, borderRadius: 2,
          backgroundColor: accent || "var(--blue)", flexShrink: 0,
        }} />
        {title}
        {count != null && (
          <span style={{
            marginLeft: 4, background: "var(--surface-2)", color: "var(--text-muted)",
            border: "1px solid var(--border)",
            borderRadius: 20, padding: "1px 8px", fontSize: "0.7rem", fontWeight: 600,
          }}>{count}</span>
        )}
      </summary>
      <div style={{ paddingTop: 10 }}>{children}</div>
    </details>
  );
}

function Chip({ label, color, bg, border }) {
  return (
    <span style={{
      display: "inline-block", padding: "2px 8px", borderRadius: 20,
      fontSize: "0.7rem", fontWeight: 700, textTransform: "uppercase",
      letterSpacing: "0.04em",
      background: bg || "var(--surface-2)",
      color: color || "var(--text-secondary)",
      border: `1px solid ${border || "var(--border)"}`,
      marginRight: 6, flexShrink: 0,
    }}>{label}</span>
  );
}

function SeverityChip({ severity }) {
  const map = {
    critical: { color: "var(--red)",    bg: "var(--red-bg)",    border: "var(--red-border)"    },
    high:     { color: "var(--red)",    bg: "var(--red-bg)",    border: "var(--red-border)"    },
    error:    { color: "var(--red)",    bg: "var(--red-bg)",    border: "var(--red-border)"    },
    medium:   { color: "var(--orange)", bg: "var(--orange-bg)", border: "var(--orange-border)" },
    warning:  { color: "var(--orange)", bg: "var(--orange-bg)", border: "var(--orange-border)" },
    low:      { color: "var(--blue)",   bg: "var(--blue-bg)",   border: "var(--blue-border)"   },
    info:     { color: "var(--text-muted)", bg: "var(--surface-2)", border: "var(--border)"    },
  };
  const s = (severity || "info").toLowerCase();
  const c = map[s] || map.info;
  return <Chip label={severity || "info"} color={c.color} bg={c.bg} border={c.border} />;
}

function IssueRow({ severity, title, file }) {
  const s = (severity || "").toLowerCase();
  const isHigh = ["critical", "high", "error"].includes(s);
  const isMed  = ["medium", "warning"].includes(s);
  return (
    <div style={{
      padding: "9px 12px", borderRadius: 6, marginBottom: 6,
      background: isHigh ? "var(--red-bg)" : isMed ? "var(--orange-bg)" : "var(--surface-2)",
      border: `1px solid ${isHigh ? "var(--red-border)" : isMed ? "var(--orange-border)" : "var(--border)"}`,
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
        <SeverityChip severity={severity} />
        <span style={{ fontSize: "0.85rem", color: "var(--text)", flex: 1 }}>{title}</span>
      </div>
      {file && (
        <div style={{
          fontFamily: "monospace", fontSize: "0.75rem",
          color: "var(--text-muted)", marginTop: 4, paddingLeft: 2,
        }}>{file}</div>
      )}
    </div>
  );
}

function MetricBox({ label, value }) {
  return (
    <div style={{
      textAlign: "center", padding: "12px 8px",
      background: "var(--surface-2)", borderRadius: 6, border: "1px solid var(--border)",
    }}>
      <div style={{ fontSize: "1.2rem", fontWeight: 700, color: "var(--text)" }}>{value}</div>
      <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", textTransform: "capitalize", marginTop: 2 }}>
        {String(label).replace(/_/g, " ")}
      </div>
    </div>
  );
}

function RiskBar({ score, level }) {
  const color  = level === "HIGH" ? "var(--red)" : level === "MEDIUM" ? "var(--orange)" : "var(--green)";
  const bg     = level === "HIGH" ? "var(--red-bg)" : level === "MEDIUM" ? "var(--orange-bg)" : "var(--green-bg)";
  const border = level === "HIGH" ? "var(--red-border)" : level === "MEDIUM" ? "var(--orange-border)" : "var(--green-border)";
  const barFill = level === "HIGH" ? "#cf222e" : level === "MEDIUM" ? "#9a6700" : "#1a7f37";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <div style={{
        flex: 1, height: 8, background: "var(--border)",
        borderRadius: 4, overflow: "hidden", maxWidth: 280,
      }}>
        <div style={{
          width: `${Math.round(score * 100)}%`, height: "100%",
          background: barFill, borderRadius: 4,
        }} />
      </div>
      <span style={{ fontWeight: 700, fontSize: "1.1rem", color }}>{Math.round(score * 100)}%</span>
      <span style={{
        padding: "3px 12px", borderRadius: 20, fontWeight: 700, fontSize: "0.82rem",
        background: bg, color, border: `1.5px solid ${border}`,
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
    <div style={{ color: "var(--text)", maxWidth: 900 }}>

      {/* Risk */}
      <Section title="Risk Score" accent="var(--blue)">
        <RiskBar score={data.risk_score} level={data.risk_level} />
        {data.llm_summary && (
          <p style={{ margin: "10px 0 0", fontSize: "0.85rem", color: "var(--text-secondary)", lineHeight: 1.6 }}>
            {data.llm_summary}
          </p>
        )}
      </Section>

      {/* ML & Rules */}
      {((data.ml_reasons || []).length > 0 || (data.rule_issues || []).length > 0) && (
        <Section
          title="ML & Rule Analysis"
          count={(data.ml_reasons || []).length + (data.rule_issues || []).length}
          accent="var(--purple)"
        >
          {(data.ml_reasons || []).map((r, i) => (
            <div key={i} style={{ fontSize: "0.85rem", color: "var(--text-secondary)", marginBottom: 4, paddingLeft: 4 }}>
              · {r}
            </div>
          ))}
          {(data.rule_issues || []).map((issue, i) => (
            <IssueRow
              key={i}
              severity={issue.severity}
              title={issue.description || issue.message || JSON.stringify(issue)}
              file={issue.files?.join(", ")}
            />
          ))}
        </Section>
      )}

      {/* LLM */}
      {llmTotal > 0 && (
        <Section title="AI Code Review" count={llmTotal} accent="var(--blue)">
          {(data.llm_detected_issues || []).map((i, idx) => (
            <IssueRow key={idx} severity={i.severity} title={i.description} file={i.file} />
          ))}
          {(data.llm_security_concerns || []).length > 0 && (
            <div style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--red)", margin: "8px 0 4px", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Security
            </div>
          )}
          {(data.llm_security_concerns || []).map((i, idx) => (
            <IssueRow key={idx} severity={i.severity || "high"} title={i.description} file={i.file} />
          ))}
          {(data.llm_performance_concerns || []).length > 0 && (
            <div style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--orange)", margin: "8px 0 4px", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Performance
            </div>
          )}
          {(data.llm_performance_concerns || []).map((i, idx) => (
            <IssueRow key={idx} severity={i.severity || "medium"} title={i.description} file={i.file} />
          ))}
          {(data.llm_code_smells || []).length > 0 && (
            <div style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--text-muted)", margin: "8px 0 4px", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Code Smells
            </div>
          )}
          {(data.llm_code_smells || []).map((i, idx) => (
            <IssueRow key={idx} severity={i.severity || "low"} title={i.description} file={i.file} />
          ))}
          {(data.llm_improvements || []).length > 0 && (
            <>
              <div style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--text-secondary)", margin: "8px 0 4px", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Suggested Improvements
              </div>
              {(data.llm_improvements || []).map((imp, idx) => (
                <div key={idx} style={{
                  fontSize: "0.84rem", color: "var(--text-secondary)", marginBottom: 4,
                  padding: "6px 10px", background: "var(--surface-2)", borderRadius: 5,
                  border: "1px solid var(--border)",
                }}>
                  · {imp.description}
                  {imp.file && (
                    <span style={{ fontFamily: "monospace", fontSize: "0.75rem", color: "var(--text-muted)", marginLeft: 8 }}>
                      {imp.file}
                    </span>
                  )}
                </div>
              ))}
            </>
          )}
        </Section>
      )}

      {/* Dependency Security */}
      <Section
        title="Dependency Security"
        count={vulnCount}
        accent="var(--red)"
        defaultOpen={vulnCount > 0}
      >
        {vulnCount === 0 ? (
          <div style={{ fontSize: "0.85rem", color: "var(--green)", padding: "4px 0" }}>
            ✓ No vulnerable dependencies detected
          </div>
        ) : (
          (data.security_warnings || []).map((v, i) => (
            <IssueRow
              key={i}
              severity={v.severity}
              title={`${v.package_name}@${v.installed_version}: ${v.summary}`}
              file={v.fixed_version ? `Fix: upgrade to ${v.fixed_version}` : null}
            />
          ))
        )}
      </Section>

      {/* Static Analysis */}
      <Section
        title="Static Analysis"
        count={staticCount}
        accent="var(--orange)"
        defaultOpen={staticCount > 0}
      >
        {staticCount === 0 ? (
          <div style={{ fontSize: "0.85rem", color: "var(--green)", padding: "4px 0" }}>
            ✓ No static analysis issues
          </div>
        ) : (
          (data.static_analysis_issues || []).map((i, idx) => (
            <IssueRow
              key={idx}
              severity={i.severity}
              title={`[${i.rule || i.tool}] ${i.message}`}
              file={i.file ? `${i.file}${i.line ? `:${i.line}` : ""}` : null}
            />
          ))
        )}
      </Section>

      {/* Code Reuse Opportunities */}
      {dupCount > 0 && (
        <Section title="Code Reuse Opportunities" count={dupCount} accent="var(--orange)">
          {(data.duplicate_warnings || []).map((w, i) => (
            <div key={i} style={{
              padding: "12px 14px", borderRadius: 8, marginBottom: 8,
              background: "var(--orange-bg)", border: "1px solid var(--orange-border)",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                <Chip
                  label={`${Math.round(w.similarity * 100)}% similar`}
                  color="var(--orange)" bg="var(--orange-bg)" border="var(--orange-border)"
                />
                <span style={{ fontSize: "0.85rem", color: "var(--text)", fontWeight: 600 }}>
                  {w.new_chunk_name || w.new_filepath}
                </span>
              </div>

              {/* PR file (where the duplicate is in this PR) */}
              <div style={{
                fontSize: "0.8rem", color: "var(--text-secondary)", marginBottom: 4,
                display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap",
              }}>
                <span style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>In this PR:</span>
                <code style={{
                  background: "var(--surface)", border: "1px solid var(--border)",
                  padding: "1px 6px", borderRadius: 4,
                  fontFamily: "monospace", fontSize: "0.78rem", color: "var(--blue)",
                }}>{w.new_filepath}</code>
              </div>

              {/* Existing file */}
              <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                <span style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>Already exists in:</span>
                <code style={{
                  background: "var(--surface)", border: "1px solid var(--border)",
                  padding: "1px 6px", borderRadius: 4,
                  fontFamily: "monospace", fontSize: "0.78rem", color: "var(--text-secondary)",
                }}>{w.existing_name || w.existing_filepath}</code>
                <span style={{ fontFamily: "monospace", fontSize: "0.75rem", color: "var(--text-muted)" }}>
                  {w.existing_filepath}
                </span>
              </div>

              {w.existing_code_snippet && (
                <pre style={{
                  margin: "8px 0 0", fontSize: "0.73rem", color: "var(--text-secondary)",
                  background: "var(--surface)", border: "1px solid var(--border)",
                  padding: "8px 10px", borderRadius: 5,
                  overflow: "auto", maxHeight: 100, whiteSpace: "pre-wrap",
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
          accent="#0891b2"
        >
          {data.graph_context.impact_summary && (
            <div style={{
              fontSize: "0.85rem", color: "var(--text-secondary)", marginBottom: 10,
              padding: "8px 12px", background: "#f0f9ff",
              borderRadius: 6, border: "1px solid #7dd3fc",
            }}>
              {data.graph_context.impact_summary}
            </div>
          )}
          {(data.graph_context.affected_functions || []).length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
                Affected Functions ({data.graph_context.affected_functions.length})
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                {data.graph_context.affected_functions.slice(0, 12).map((fn, i) => (
                  <code key={i} style={{
                    background: "#f0f9ff", border: "1px solid #7dd3fc",
                    borderRadius: 4, padding: "2px 8px",
                    fontFamily: "monospace", fontSize: "0.78rem", color: "#0369a1",
                  }}>{fn.name || fn}</code>
                ))}
              </div>
            </div>
          )}
          {data.graph_context.risk_score_boost > 0 && (
            <div style={{
              marginTop: 8, padding: "6px 10px", borderRadius: 5,
              background: "var(--red-bg)", border: "1px solid var(--red-border)",
              fontSize: "0.8rem", color: "var(--red)",
            }}>
              ⚠ Risk boosted +{(data.graph_context.risk_score_boost * 100).toFixed(0)}% due to critical execution flows
            </div>
          )}
        </Section>
      )}

      {/* Recommendations */}
      {(data.recommendations || []).length > 0 && (
        <Section title="Recommendations" accent="var(--green)">
          {data.recommendations.map((r, i) => (
            <div key={i} style={{
              fontSize: "0.85rem", color: "var(--text-secondary)",
              marginBottom: 5, paddingLeft: 4, display: "flex", gap: 6,
            }}>
              <span style={{ color: "var(--blue)", fontWeight: 700 }}>→</span>
              {r}
            </div>
          ))}
        </Section>
      )}

      {/* Metrics */}
      {Object.keys(data.metrics || {}).length > 0 && (
        <Section title="Metrics" defaultOpen={false} accent="var(--text-muted)">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(110px,1fr))", gap: 8 }}>
            {Object.entries(data.metrics || {}).map(([k, v]) => (
              <MetricBox key={k} label={k} value={v} />
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}
