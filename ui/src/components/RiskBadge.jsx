const LEVEL_CONFIG = {
  HIGH: { emoji: "\uD83D\uDD34", color: "#dc2626", bg: "#fef2f2" },
  MEDIUM: { emoji: "\uD83D\uDFE1", color: "#d97706", bg: "#fffbeb" },
  LOW: { emoji: "\uD83D\uDFE2", color: "#16a34a", bg: "#f0fdf4" },
};

export default function RiskBadge({ level }) {
  const config = LEVEL_CONFIG[level] || LEVEL_CONFIG.MEDIUM;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        padding: "6px 16px",
        borderRadius: "20px",
        fontWeight: 700,
        fontSize: "0.95rem",
        color: config.color,
        backgroundColor: config.bg,
        border: `1.5px solid ${config.color}`,
      }}
    >
      {config.emoji} {level}
    </span>
  );
}
