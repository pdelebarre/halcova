// Release 1.2 badge share card — a self-contained, dark #16130F + gold SVG,
// visually consistent with the 1.1 persona card (PersonaCard.jsx). No new
// dependency: rendered as inline SVG, exported as-is by exportSvg.js.
//
// LEAK-SAFE BY CONSTRUCTION: the card contains only the headline + badge name
// + the badge's one-line joke + 1–2 aggregate stats + tagline/hashtag. No item
// lists, no covers, no barcodes/ISBNs, no access codes, no admin key, no owner
// identity. (Security Auditor re-verifies.)

const BG = '#16130F'
const GOLD = '#C9A227'
const KRAFT = '#EFE6D8'
const DIM = '#C9BFAF'
const LINE = '#35302A'

/** Wrap a string into lines of at most `maxChars` (SVG <text> has no wrap). */
function wrap(text, maxChars) {
  const words = String(text || '').split(/\s+/).filter(Boolean)
  const lines = []
  let line = ''
  for (const word of words) {
    if (line && (line + ' ' + word).length > maxChars) {
      lines.push(line)
      line = word
    } else {
      line = line ? `${line} ${word}` : word
    }
  }
  if (line) lines.push(line)
  return lines.length ? lines : ['']
}

export default function BadgeCard({ badge = {}, copy = {}, stats = [] }) {
  if (!badge || !badge.title) return null

  const nameLines = wrap(badge.title, 24)
  const lineLines = wrap(badge.line, 34)
  const statList = Array.isArray(stats) ? stats : []
  const headline = copy.headline || 'Unlocked:'
  const tagline = copy.tagline || ''
  const hashtag = copy.hashtag || '#WhatsInYourHalcova'

  const statsStartY = 470
  const statsRowGap = 78
  const statsBottomY = statsStartY + statList.length * statsRowGap
  const dividerY = Math.max(statsBottomY + 64, 640)

  return (
    <svg
      className="badge-card-svg"
      viewBox="0 0 720 900"
      role="img"
      aria-label={badge.title}
    >
      <rect width="720" height="900" fill={BG} />
      <rect x="0" y="0" width="720" height="10" fill={GOLD} />

      {/* Brand mark + wordmark */}
      <rect x="60" y="58" width="22" height="22" fill={GOLD} transform="rotate(45 71 69)" />
      <text x="98" y="84" fontFamily="Georgia, 'Times New Roman', serif" fontSize="30" fontWeight="600" fill={GOLD}>Halcova</text>

      {/* Headline */}
      <text x="60" y="170" fontFamily="'Inter', sans-serif" fontSize="20" fill={DIM}>{headline}</text>

      {/* Badge name */}
      <text x="60" y="236" fontFamily="Georgia, 'Times New Roman', serif" fontSize="40" fontWeight="700" fill={GOLD}>
        {nameLines.map((line, i) => (
          <tspan key={i} x="60" dy={i === 0 ? 0 : 46}>{line}</tspan>
        ))}
      </text>

      {/* The badge's one-line joke */}
      <text x="60" y="360" fontFamily="'Inter', sans-serif" fontSize="23" fill={KRAFT}>
        {lineLines.map((line, i) => (
          <tspan key={i} x="60" dy={i === 0 ? 0 : 30}>{line}</tspan>
        ))}
      </text>

      {/* Aggregate stats only */}
      <g>
        {statList.map((stat, i) => {
          const y = statsStartY + i * statsRowGap
          return (
            <g key={stat.label || i}>
              <text x="60" y={y} fontFamily="'Inter', sans-serif" fontSize="16" fill={DIM}>{stat.label}</text>
              <text x="60" y={y + 26} fontFamily="'Inter', sans-serif" fontSize="28" fontWeight="600" fill={KRAFT}>{stat.value}</text>
            </g>
          )
        })}
      </g>

      {/* Divider */}
      <line x1="60" y1={dividerY} x2="660" y2={dividerY} stroke={LINE} strokeWidth="1" />

      {/* Tagline + hashtag */}
      <text x="60" y={dividerY + 34} fontFamily="'Inter', sans-serif" fontSize="17" fill={DIM}>{tagline}</text>
      <text x="60" y={dividerY + 66} fontFamily="'Inter', sans-serif" fontSize="22" fontWeight="600" fill={GOLD}>{hashtag}</text>
    </svg>
  )
}
