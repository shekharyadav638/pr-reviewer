export default function Spinner({ text = "Analyzing pull request…" }) {
  return (
    <div className="spinner-wrap">
      <div className="spinner-ring" />
      <span className="spinner-text">{text}</span>
    </div>
  );
}
