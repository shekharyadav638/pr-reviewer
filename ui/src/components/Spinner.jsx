export default function Spinner() {
  return (
    <div style={{ textAlign: "center", padding: "40px 0" }}>
      <div
        style={{
          display: "inline-block",
          width: "36px",
          height: "36px",
          border: "4px solid #e5e7eb",
          borderTopColor: "#3b82f6",
          borderRadius: "50%",
          animation: "spin 0.8s linear infinite",
        }}
      />
      <p style={{ marginTop: "12px", color: "#6b7280" }}>
        Analyzing pull request...
      </p>
    </div>
  );
}
