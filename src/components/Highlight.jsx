import { Fragment } from 'react'
import './Highlight.css'

/**
 * Emphasizes case-insensitive substring matches of `query` inside `text`
 * with <mark> (React text nodes — no HTML injection). Falls back to plain
 * text when there's nothing to highlight or no query.
 */
export default function Highlight({ text, query }) {
  const source = text == null ? '' : String(text)
  const needle = (query || '').trim()
  if (!source || !needle) return source

  const lower = source.toLowerCase()
  const q = needle.toLowerCase()
  const out = []
  let i = 0
  let idx = lower.indexOf(q, i)
  while (idx !== -1) {
    if (idx > i) out.push(source.slice(i, idx))
    out.push(<mark key={idx} className="search-hit">{source.slice(idx, idx + q.length)}</mark>)
    i = idx + q.length
    idx = lower.indexOf(q, i)
  }
  if (i < source.length) out.push(source.slice(i))
  return out.length ? <Fragment>{out}</Fragment> : source
}
