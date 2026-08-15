// Generates the "One home, two rooms" theme mockups for the Phase 0 survey
// (marketing/survey-theme-rooms.md §5). Emits 5 SVGs + 5 PNGs:
//   records-room-gold-reference  (status quo, gold accent — the reference)
//   books-room-A-amber           (warm amber)
//   books-room-B-green           (reading-room green)
//   books-room-C-oxblood         (oxblood/wine red — two-tone for text contrast)
//   books-room-D-gold            (keep gold / no change — the control)
//
// Grounded in the real UI: src/components/{Header,Toolbar,FilterSheet,
// BookCard,AlbumCard}.css, src/index.css tokens. Every "room" shares the
// exact same skeleton (header, tab bar, toolbar, search pill, FAB) — only the
// ambient tint and the accent surfaces differ, per the cohesion rules.
//
// Run:  node marketing/mockups/theme-rooms/generate.mjs

import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import sharp from 'sharp'

const __dirname = dirname(fileURLToPath(import.meta.url))

// --- Design tokens (from src/index.css) -------------------------------------
const T = {
  base: '#16130F',      // --sleeve-black
  groove: '#211D18',    // --vinyl-groove
  groove2: '#2B251E',   // --vinyl-groove-2
  kraft: '#EFE6D8',     // --jacket-kraft
  dim: '#C9BFAF',       // --jacket-kraft-dim
  grey: '#A49C8E',      // --static-grey
  line: '#35302A',      // --line
  gold: '#C9A227',      // --runout-gold
  fabRed: '#B23A2E',    // --label-red (FAB — global primary, stays in every room)
}

// Fonts: the app self-hosts Fraunces/Inter/Plex Mono; SVG falls back to
// Georgia/Helvetica/Menlo when rendering (PNG via sharp/librsvg).
const F = {
  serif: "'Fraunces Variable', Georgia, serif",
  sans: 'Inter, -apple-system, Helvetica, Arial, sans-serif',
  mono: "'IBM Plex Mono', ui-monospace, Menlo, monospace",
}

const W = 375
const H = 920

const rgb = (hex) => {
  const c = hex.replace('#', '')
  return `${Number.parseInt(c.slice(0, 2), 16)},${Number.parseInt(c.slice(2, 4), 16)},${Number.parseInt(c.slice(4, 6), 16)}`
}

// --- Shared skeleton ----------------------------------------------------------
function header(activeTab) {
  const tabs = [
    { id: 'records', label: 'Records', x: 163, w: 70 },
    { id: 'books', label: 'Books', x: 233, w: 70 },
  ]
  const pill = `<rect x="159" y="10" width="148" height="44" rx="22" fill="${T.groove}" stroke="${T.line}"/>`
  const tabEls = tabs
    .map((t) => {
      const on = t.id === activeTab
      const cx = t.x + t.w / 2
      return (
        (on
          ? `<rect x="${t.x}" y="14" width="${t.w}" height="36" rx="18" fill="${T.groove2}" stroke="${T.line}"/>`
          : '') +
        `<text x="${cx}" y="39" font-family="${F.mono}" font-size="12" letter-spacing="0.02em" text-anchor="middle" fill="${on ? T.kraft : T.grey}">${t.label}</text>`
      )
    })
    .join('')
  // User chip: gold initial in EVERY room — the brand thread.
  const chip = `<circle cx="337" cy="32" r="21" fill="${T.groove}" stroke="${T.line}"/><text x="337" y="39" font-family="${F.serif}" font-weight="700" font-size="15" text-anchor="middle" fill="${T.gold}">S</text>`
  return (
    `<text x="16" y="30" font-family="${F.serif}" font-weight="700" font-size="22" letter-spacing="-0.01em" fill="${T.kraft}">Halcova</text>` +
    pill + tabEls + chip
  )
}

function toolbar(placeholder, count) {
  const mag =
    `<circle cx="34" cy="94" r="7" fill="none" stroke="${T.grey}" stroke-width="2"/>` +
    `<line x1="39" y1="99" x2="44" y2="104" stroke="${T.grey}" stroke-width="2" stroke-linecap="round"/>`
  const filter =
    `<rect x="256" y="72" width="44" height="44" rx="22" fill="${T.groove}" stroke="${T.line}"/>` +
    `<line x1="270" y1="88" x2="286" y2="88" stroke="${T.grey}" stroke-width="2" stroke-linecap="round"/>` +
    `<line x1="270" y1="94" x2="286" y2="94" stroke="${T.grey}" stroke-width="2" stroke-linecap="round"/>` +
    `<line x1="270" y1="100" x2="286" y2="100" stroke="${T.grey}" stroke-width="2" stroke-linecap="round"/>`
  const sort =
    `<rect x="304" y="72" width="44" height="44" rx="22" fill="${T.groove}" stroke="${T.line}"/>` +
    `<line x1="318" y1="86" x2="334" y2="86" stroke="${T.grey}" stroke-width="2" stroke-linecap="round"/>` +
    `<polyline points="328,80 334,86 328,92" fill="none" stroke="${T.grey}" stroke-width="2" stroke-linejoin="round"/>` +
    `<line x1="318" y1="104" x2="334" y2="104" stroke="${T.grey}" stroke-width="2" stroke-linecap="round"/>` +
    `<polyline points="326,98 320,104 326,110" fill="none" stroke="${T.grey}" stroke-width="2" stroke-linejoin="round"/>`
  return (
    `<rect x="16" y="72" width="236" height="44" rx="22" fill="${T.groove}" stroke="${T.line}"/>` +
    mag +
    `<text x="50" y="100" font-family="${F.sans}" font-size="15" fill="${T.grey}">${placeholder}</text>` +
    `<text x="238" y="100" font-family="${F.mono}" font-size="12" fill="${T.grey}" text-anchor="end">${count}</text>` +
    filter + sort
  )
}

// Category/genre chips row. active chip = accent border/text/tint (real app
// active-chip pattern); inactive = neutral.
function chipRow(label, chips, accent, accentText) {
  const labelEl = `<text x="16" y="176" font-family="${F.mono}" font-size="10" letter-spacing="1.6" fill="${T.grey}">${label}</text>`
  let x = 16
  const els = chips.map((c) => {
    const w = c.w ?? Math.round(c.label.length * 7.4 + 28)
    const el = c.active
      ? `<rect x="${x}" y="182" width="${w}" height="40" rx="20" fill="rgba(${rgb(accent)},0.10)" stroke="${accent}"/>` +
        `<text x="${x + w / 2}" y="208" font-family="${F.mono}" font-size="12" text-anchor="middle" fill="${accentText || accent}">${c.label}</text>`
      : `<rect x="${x}" y="182" width="${w}" height="40" rx="20" fill="none" stroke="${T.line}"/>` +
        `<text x="${x + w / 2}" y="208" font-family="${F.mono}" font-size="12" text-anchor="middle" fill="${T.dim}">${c.label}</text>`
    x += w + 8
    return el
  })
  return labelEl + els.join('')
}

// Book covers (2:3) — placeholder art, 2 columns × 2 rows at true app scale.
function bookGrid(cards) {
  const col = [16, 195]
  const rows = [236, 541]
  const cw = 163
  const ch = 245
  const spine =
    `<linearGradient id="spine" x1="0" y1="0" x2="1" y2="0">` +
    `<stop offset="0" stop-color="rgba(0,0,0,0.45)"/><stop offset="0.9" stop-color="rgba(0,0,0,0)"/>` +
    `</linearGradient>`
  let out = spine
  cards.forEach((card, i) => {
    const x = col[i % 2]
    const y = rows[Math.floor(i / 2)]
    out +=
      `<rect x="${x}" y="${y}" width="${cw}" height="${ch}" rx="4" fill="${card.bg}" stroke="rgba(0,0,0,0.35)"/>` +
      `<rect x="${x}" y="${y}" width="7" height="${ch}" fill="url(#spine)"/>` +
      `<text x="${x + cw / 2}" y="${y + 137}" font-family="${F.serif}" font-weight="600" font-size="34" text-anchor="middle" fill="${T.kraft}" opacity="0.9">${card.letter}</text>` +
      `<text x="${x}" y="${y + ch + 27}" font-family="${F.sans}" font-weight="600" font-size="14" fill="${T.kraft}">${card.title}</text>` +
      `<text x="${x}" y="${y + ch + 45}" font-family="${F.sans}" font-size="12.5" fill="${T.grey}">${card.author}</text>`
  })
  return out
}

// Album covers (square, with vinyl "peek") — records reference.
function albumGrid(cards) {
  const col = [16, 195]
  const rows = [236, 459]
  const cw = 163
  const ch = 163
  let out = ''
  cards.forEach((card, i) => {
    const x = col[i % 2]
    const y = rows[Math.floor(i / 2)]
    const cx = x + cw / 2
    const cy = y - 3 + 62 // vinyl peek: top:-3, r=62
    out +=
      `<circle cx="${cx}" cy="${cy}" r="62" fill="${card.peek}"/>` +
      `<circle cx="${cx}" cy="${cy}" r="40" fill="none" stroke="rgba(0,0,0,0.22)"/>` +
      `<circle cx="${cx}" cy="${cy}" r="6" fill="${T.base}"/>` +
      `<rect x="${x}" y="${y}" width="${cw}" height="${ch}" rx="4" fill="${card.bg}" stroke="rgba(0,0,0,0.35)"/>` +
      `<text x="${cx}" y="${y + 95}" font-family="${F.serif}" font-weight="600" font-size="34" text-anchor="middle" fill="${T.kraft}" opacity="0.9">${card.letter}</text>` +
      `<text x="${x}" y="${y + ch + 27}" font-family="${F.sans}" font-weight="600" font-size="14" fill="${T.kraft}">${card.title}</text>` +
      `<text x="${x}" y="${y + ch + 45}" font-family="${F.sans}" font-size="12.5" fill="${T.grey}">${card.artist}</text>`
  })
  return out
}

function fab() {
  // Red scan FAB — global primary action, identical in every room.
  return (
    `<rect x="265" y="${H - 20 - 48}" width="90" height="48" rx="24" fill="${T.fabRed}" filter="url(#fabShadow)"/>` +
    `<line x1="282" y1="${H - 20 - 26}" x2="282" y2="${H - 20 - 22}" stroke="${T.kraft}" stroke-width="3"/>` +
    `<line x1="289" y1="${H - 20 - 26}" x2="289" y2="${H - 20 - 22}" stroke="${T.kraft}" stroke-width="2"/>` +
    `<line x1="295" y1="${H - 20 - 26}" x2="295" y2="${H - 20 - 22}" stroke="${T.kraft}" stroke-width="3"/>` +
    `<text x="322" y="${H - 20 - 16}" font-family="${F.sans}" font-weight="600" font-size="14.5" fill="${T.kraft}">Scan</text>`
  )
}

function letterBadge(letter) {
  return (
    `<rect x="16" y="${H - 40 - 16}" width="44" height="40" rx="20" fill="${T.groove}" stroke="${T.line}"/>` +
    `<text x="38" y="${H - 40 - 16 + 25}" font-family="${F.mono}" font-size="13" text-anchor="middle" fill="${T.dim}">${letter}</text>`
  )
}

// --- Assemble one SVG ---------------------------------------------------------
function svg({ kind, accent, accentText, ambient, activeTab, placeholder, count, label, chips, tagline, cards, badge, ref }) {
  const defs =
    `<defs>` +
    `<filter id="fabShadow" x="-40%" y="-40%" width="180%" height="180%">` +
    `<feDropShadow dx="0" dy="6" stdDeviation="8" flood-color="${T.fabRed}" flood-opacity="0.55"/>` +
    `</filter>` +
    (ambient
      ? `<linearGradient id="amb" x1="0" y1="0" x2="0" y2="1">` +
        `<stop offset="0" stop-color="rgb(${rgb(ambient)})" stop-opacity="0.13"/>` +
        `<stop offset="0.4" stop-color="rgb(${rgb(ambient)})" stop-opacity="0.04"/>` +
        `<stop offset="1" stop-color="rgb(${rgb(ambient)})" stop-opacity="0"/>` +
        `</linearGradient>`
      : '') +
    `</defs>`
  const bg =
    `<rect width="${W}" height="${H}" fill="${T.base}"/>` +
    (ambient ? `<rect width="${W}" height="${H}" fill="url(#amb)"/>` : '')
  const taglineEl = `<text x="16" y="150" font-family="${F.mono}" font-size="12.5" fill="${T.dim}">${tagline}</text>`
  const grid = kind === 'books' ? bookGrid(cards) : albumGrid(cards)
  const refNote = ref
    ? `<text x="16" y="${H - 40 - 16 + 25}" font-family="${F.mono}" font-size="11" fill="${T.grey}">REF — records, current look</text>`
    : ''
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${F.sans}">` +
    defs + bg +
    header(activeTab) + toolbar(placeholder, count) + taglineEl +
    chipRow(label, chips, accent, accentText) + grid + fab() + letterBadge(badge) + refNote +
    `</svg>`
  )
}

// --- The five mockups ---------------------------------------------------------
const booksCards = [
  { bg: '#6B4F3A', letter: 'L', title: 'The Left Hand of Darkness', author: 'Ursula K. Le Guin' },
  { bg: '#3E5C63', letter: 'D', title: 'Dune', author: 'Frank Herbert' },
  { bg: '#5A4B6E', letter: 'C', title: 'Circe', author: 'Madeline Miller' },
  { bg: '#4E5D3A', letter: 'N', title: 'The Name of the Wind', author: 'Patrick Rothfuss' },
]
const recordsCards = [
  { bg: '#6E5A3F', letter: 'K', peek: '#CE4B3D', title: 'Kind of Blue', artist: 'Miles Davis' },
  { bg: '#4A5A6E', letter: 'L', peek: '#C9A227', title: 'Low', artist: 'David Bowie' },
  { bg: '#5E4A5C', letter: 'T', peek: '#9FB4C7', title: 'Tago Mago', artist: 'Can' },
  { bg: '#4F5A3A', letter: 'R', peek: '#7A9A6B', title: 'Revolver', artist: 'The Beatles' },
]
const chips = (active) => [
  { label: 'Fiction', active },
  { label: 'Sci-Fi' },
  { label: 'History' },
  { label: 'Cooking' },
]

const mockups = [
  {
    file: 'records-room-gold-reference',
    badge: 'REF',
    ref: true,
    kind: 'records',
    accent: T.gold,
    accentText: T.gold,
    ambient: null, // status quo — no tint
    activeTab: 'records',
    placeholder: 'Search your crate…',
    count: '42',
    label: 'GENRE',
    chips: [{ label: 'Jazz', active: true }, { label: 'Funk' }, { label: 'Rock' }, { label: 'Soul' }],
    tagline: 'your crate, cataloged',
    cards: recordsCards,
  },
  {
    file: 'books-room-A-amber',
    badge: 'A',
    kind: 'books',
    accent: '#D9A441', // 8.23:1 on #16130F
    accentText: '#D9A441',
    ambient: '#D9A441',
    activeTab: 'books',
    placeholder: 'Search your shelf…',
    count: '26',
    label: 'CATEGORY',
    chips: chips(true),
    tagline: 'your shelf, cataloged',
    cards: booksCards,
  },
  {
    file: 'books-room-B-green',
    badge: 'B',
    kind: 'books',
    accent: '#7FA98C', // 7.02:1 on #16130F — teal-leaning, distinct from --success
    accentText: '#7FA98C',
    ambient: '#7FA98C',
    activeTab: 'books',
    placeholder: 'Search your shelf…',
    count: '26',
    label: 'CATEGORY',
    chips: chips(true),
    tagline: 'your shelf, cataloged',
    cards: booksCards,
  },
  {
    file: 'books-room-C-oxblood',
    badge: 'C',
    kind: 'books',
    accent: '#B05750', // deep oxblood — UI/border only (3.81:1, ≥3:1 UI)
    accentText: '#CB7C70', // lighter oxblood text tone (5.87:1, ≥4.5:1)
    ambient: '#B05750',
    activeTab: 'books',
    placeholder: 'Search your shelf…',
    count: '26',
    label: 'CATEGORY',
    chips: chips(true),
    tagline: 'your shelf, cataloged',
    cards: booksCards,
  },
  {
    file: 'books-room-D-gold',
    badge: 'D',
    kind: 'books',
    accent: T.gold, // keep gold = status quo control
    accentText: T.gold,
    ambient: null, // no change
    activeTab: 'books',
    placeholder: 'Search your shelf…',
    count: '26',
    label: 'CATEGORY',
    chips: chips(true),
    tagline: 'your shelf, cataloged',
    cards: booksCards,
  },
]

// --- Write SVGs + PNGs --------------------------------------------------------
const outDir = join(__dirname)
mkdirSync(outDir, { recursive: true })

for (const m of mockups) {
  const svgStr = svg(m)
  const svgPath = join(outDir, `${m.file}.svg`)
  writeFileSync(svgPath, svgStr)
  console.log('SVG  ', m.file, `(accent ${m.accent}, text ${m.accentText})`)
}

console.log('\nRendering PNGs (2×)…')
for (const m of mockups) {
  const svgPath = join(outDir, `${m.file}.svg`)
  const pngPath = join(outDir, `${m.file}.png`)
  await sharp(svgPath, { density: 144 }).png().toFile(pngPath)
  console.log('PNG  ', m.file)
}
console.log('\nDone —', mockups.length, 'mockups in', outDir)
