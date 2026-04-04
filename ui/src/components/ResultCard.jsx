import RiskBadge from "./RiskBadge";

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: "24px" }}>
      <h3 style={{ margin: "0 0 8px", fontSize: "0.85rem", color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {title}
      </h3>
      {children}
    </div>
  );
}

function FileList({ files }) {
  if (!files || files.length === 0) return <p style={{ color: "#9ca3af" }}>None</p>;
  return (
    <ul style={{ margin: 0, paddingLeft: "20px" }}>
      {files.map((f, i) => (
        <li key={i} style={{ fontFamily: "monospace", fontSize: "0.85rem", marginBottom: "4px" }}>{f}</li>
      ))}
    </ul>
  );
}

function BulletList({ items }) {
  if (!items || items.length === 0) return <p style={{ color: "#9ca3af" }}>None</p>;
  return (
    <ul style={{ margin: 0, paddingLeft: "20px" }}>
      {items.map((item, i) => (
        <li key={i} style={{ marginBottom: "4px" }}>{item}</li>
      ))}
    </ul>
  );
}

export default function ResultCard({ data }) {
  return (
    <div style={{ border: "1px solid #e5e7eb", borderRadius: "12px", padding: "28px", backgroundColor: "#fff" }}>
      {/* Header */}
      <div style={{ marginBottom: "24px", borderBottom: "1px solid #f3f4f6", paddingBottom: "16px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "12px" }}>
          <div>
            <h2 style={{ margin: "0 0 4px", fontSize: "1.15rem" }}>
              #{data.pr_id} &mdash; {data.pr_title}
            </h2>
            <p style={{ margin: 0, color: "#6b7280", fontSize: "0.9rem" }}>
              {data.repo} &middot; {data.pr_author}
            </p>
          </div>
          <RiskBadge level={data.risk_level} />
        </div>
      </div>

      {/* Risk Score */}
      <Section title="Risk Score">
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div style={{
            flex: 1, height: "10px", backgroundColor: "#f3f4f6",
            borderRadius: "5px", overflow: "hidden", maxWidth: "300px",
          }}>
            <div style={{
              width: `${Math.round(data.risk_score * 100)}%`, height: "100%",
              backgroundColor: data.risk_level === "HIGH" ? "#dc2626" : data.risk_level === "MEDIUM" ? "#d97706" : "#16a34a",
              borderRadius: "5px", transition: "width 0.4s ease",
            }} />
          </div>
          <span style={{ fontWeight: 600, fontSize: "1.1rem" }}>
            {Math.round(data.risk_score * 100)}%
          </span>
        </div>
      </Section>

      {/* Reasons */}
      <Section title="Reasons">
        <BulletList items={data.reasons} />
      </Section>

      {/* Issues */}
      <Section title="Issues Detected">
        {data.detected_issues && data.detected_issues.length > 0 ? (
          data.detected_issues.map((issue, i) => (
            <div key={i} style={{
              marginBottom: "12px", padding: "12px", borderRadius: "8px",
              backgroundColor: issue.severity === "high" ? "#fef2f2" : "#fffbeb",
              border: `1px solid ${issue.severity === "high" ? "#fecaca" : "#fde68a"}`,
            }}>
              <div style={{ fontWeight: 600, marginBottom: "4px" }}>
                <span style={{
                  display: "inline-block", padding: "1px 8px", borderRadius: "4px", fontSize: "0.75rem",
                  fontWeight: 700, marginRight: "8px", textTransform: "uppercase",
                  backgroundColor: issue.severity === "high" ? "#dc2626" : "#d97706",
                  color: "#fff",
                }}>{issue.severity}</span>
                {issue.category}
              </div>
              <p style={{ margin: "4px 0 0", fontSize: "0.9rem", color: "#374151" }}>{issue.description}</p>
              {issue.files && issue.files.length > 0 && (
                <FileList files={issue.files} />
              )}
            </div>
          ))
        ) : (
          <p style={{ color: "#9ca3af" }}>No issues detected</p>
        )}
      </Section>

      {/* Problematic Files */}
      <Section title="Problematic Files">
        <FileList files={data.problematic_files} />
      </Section>

      {/* Recommendations */}
      <Section title="Recommended Review Focus">
        <BulletList items={data.recommendations} />
      </Section>

      {/* Metrics */}
      <Section title="Metrics">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: "12px" }}>
          {Object.entries(data.metrics || {}).map(([key, val]) => (
            <div key={key} style={{ textAlign: "center", padding: "12px", backgroundColor: "#f9fafb", borderRadius: "8px" }}>
              <div style={{ fontSize: "1.3rem", fontWeight: 700 }}>{val}</div>
              <div style={{ fontSize: "0.75rem", color: "#6b7280", textTransform: "capitalize" }}>
                {key.replace(/_/g, " ")}
              </div>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}
