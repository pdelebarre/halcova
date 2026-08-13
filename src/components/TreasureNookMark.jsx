// TreasureNookMark — the app's collection-agnostic mark: a Gothic pointed arch
// holding a single tilted card ("a cozy place for your things"). Replaces the old
// vinyl-record motif on the launch screen (AuthScreen) and in the Credits sheet.
//
// Geometry mirrors docs/icon-treasure-nook-spec.md (512×512 viewBox). Colors use
// the real design tokens from src/index.css — no invented palette.
export default function TreasureNookMark({ size = 104, className = '' }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      className={className}
      role="img"
      aria-hidden="true"
      focusable="false"
    >
      {/* Background tile */}
      <rect width="512" height="512" fill="var(--sleeve-black)" />
      {/* Warm glow deep inside the nook */}
      <path
        d="M 156 330 A 100 60 0 0 0 356 330 Z"
        fill="var(--runout-gold)"
        opacity="0.10"
      />
      {/* Gothic pointed arch */}
      <path
        d="M 116 380 A 280 280 0 0 1 256 137.5 A 280 280 0 0 1 396 380"
        stroke="var(--runout-gold)"
        strokeWidth="16"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Base line */}
      <line
        x1="108" y1="380" x2="404" y2="380"
        stroke="var(--runout-gold)"
        strokeWidth="16"
        strokeLinecap="round"
      />
      {/* The treasured object — a tilted card resting in the nook */}
      <rect
        x="-50" y="-70" width="100" height="140" rx="12" ry="12"
        fill="var(--jacket-kraft)"
        transform="translate(256, 302) rotate(10)"
      />
    </svg>
  )
}
