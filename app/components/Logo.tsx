export default function Logo({ size = 34 }: { size?: number }) {
  return (
    <span className="brand">
      <svg width={size} height={size} viewBox="0 0 34 34" aria-hidden="true">
        <defs>
          <linearGradient id="brandlg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#6366f1" />
            <stop offset="1" stopColor="#8b5cf6" />
          </linearGradient>
        </defs>
        <rect x="1" y="1" width="32" height="32" rx="9" fill="url(#brandlg)" />
        <text
          x="17" y="22" textAnchor="middle"
          fontSize="13" fontWeight="800" fill="#ffffff"
          fontFamily="system-ui, sans-serif"
        >
          1:1
        </text>
      </svg>
      <span className="word">
        121 <span>CA Classes</span>
      </span>
    </span>
  );
}
