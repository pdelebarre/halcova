import './SectionHeader.css'

/**
 * A labelled shelf header for the collection "Floor" (§ Phase 1): an optional
 * mono kicker, a Fraunces title, and a count and/or an action on the right
 * (e.g. the "Crate dive" button). `id` lands on the heading so a wrapping
 * `<section aria-labelledby={id}>` can point at it.
 */
export default function SectionHeader({ id, kicker, title, count, action }) {
  return (
    <div className="section-header">
      <div className="section-header-text">
        {kicker && <span className="section-kicker">{kicker}</span>}
        <h2 id={id} className="section-title">{title}</h2>
      </div>
      <div className="section-header-right">
        {typeof count === 'number' && (
          <span className="section-count" aria-hidden="true">{Number(count).toLocaleString()}</span>
        )}
        {action}
      </div>
    </div>
  )
}
