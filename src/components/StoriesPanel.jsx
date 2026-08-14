import { useEffect, useMemo, useRef, useState } from 'react'
import { computeStories } from '../utils/stories'
import { track } from '../utils/track'
import './StoriesPanel.css'

/**
 * Release 1.4 "Play" — Shelf Stories feed (issue #44). A swipeable, snap-
 * scrolling carousel of deterministic story cards derived ONLY from the
 * member's own items (computeStories — facts tier + era-lesson
 * recommendations grounded in owned data).
 *
 * - Emits `gamif_story_opened` once per story card per panel mount (track is
 *   default-off).
 * - Each actionable story shows a "Turn into a quest" affordance. Quests are
 *   Phase 2, so the button is honest: it emits `gamif_quest_started` (a no-op
 *   today) and shows a "quest-building arrives in Phase 2" note.
 *
 * Rendered inside the Play hub (PlayPanel), which is gated by the member's
 * admin-granted `features.games` entitlement.
 */
export default function StoriesPanel({ items = [], catalog }) {
  const storiesCopy = (catalog?.copy?.gamif?.stories) || {}
  const kind = catalog?.kind === 'books' ? 'books' : 'records'
  const stories = useMemo(() => computeStories(items, catalog), [items, catalog])

  const scrollerRef = useRef(null)
  const trackRef = useRef(new Set()) // story ids emitted as opened this mount
  const hintTimer = useRef(null)
  const [index, setIndex] = useState(0)
  const [questHint, setQuestHint] = useState(null) // storyId just quest-seeded

  // Clamp the index when the story set shrinks (e.g. items removed).
  useEffect(() => {
    if (index >= stories.length && stories.length > 0) setIndex(stories.length - 1)
    if (stories.length === 0) setIndex(0)
  }, [stories.length, index])

  // Emit `gamif_story_opened` for the currently visible card, once per mount.
  useEffect(() => {
    const story = stories[index]
    if (!story) return
    if (trackRef.current.has(story.id)) return
    trackRef.current.add(story.id)
    track('gamif_story_opened', { storyId: story.id, kind })
  }, [stories, index, kind])

  useEffect(() => {
    return () => {
      if (hintTimer.current) clearTimeout(hintTimer.current)
    }
  }, [])

  function scrollTo(i) {
    const next = Math.max(0, Math.min(stories.length - 1, i))
    const el = scrollerRef.current
    if (el && typeof el.scrollTo === 'function') {
      try {
        el.scrollTo({ left: next * Math.max(1, el.clientWidth || 1), behavior: 'smooth' })
      } catch { /* jsdom / very old engines: fall back to index only */ }
    }
    setIndex(next)
  }

  function handleQuest(story) {
    // Phase 2 quests are not built — this is a tracked, honest no-op today.
    track('gamif_quest_started', { storyId: story.id, kind })
    setQuestHint(story.id)
    if (hintTimer.current) clearTimeout(hintTimer.current)
    hintTimer.current = setTimeout(() => setQuestHint(null), 4000)
  }

  function handleScroll(e) {
    const el = e.currentTarget
    if (!el || !el.clientWidth) return
    const i = Math.round(el.scrollLeft / el.clientWidth)
    if (i !== index) setIndex(i)
  }

  const empty = stories.length === 0
  // "Go to story N" labels the pagination dots (screen-reader accessible).
  const goToStory = (n) => (typeof storiesCopy.goToStory === 'string' ? storiesCopy.goToStory.replace('{n}', String(n + 1)) : `Go to story ${n + 1}`)

  return (
    <div className="stories-panel">
      {empty ? (
        <div className="stories-empty">
          <p className="stories-empty-title">{storiesCopy.emptyTitle || 'No stories yet'}</p>
          <p className="stories-empty-sub">{storiesCopy.emptySub || 'Add a few items and your collection starts talking.'}</p>
        </div>
      ) : (
        <>
          <div
            className="stories-scroller"
            ref={scrollerRef}
            onScroll={handleScroll}
            aria-label={storiesCopy.headline || 'Shelf stories'}
          >
            <div className="stories-track">
              {stories.map((story) => (
                <article key={story.id} className="story-card" aria-label={story.title}>
                  <h3 className="story-title">{story.title}</h3>
                  <p className="story-body">{story.body}</p>
                  {story.actionable && (
                    <>
                      <button type="button" className="btn btn-ghost story-quest" onClick={() => handleQuest(story)}>
                        {storiesCopy.quest || 'Turn into a quest'}
                      </button>
                      {questHint === story.id && (
                        <output className="story-hint">{storiesCopy.questSoon || 'Quest-building arrives in Phase 2'}</output>
                      )}
                    </>
                  )}
                </article>
              ))}
            </div>
          </div>

          {stories.length > 1 && (
            <div className="stories-controls">
              <button
                type="button"
                className="story-nav"
                onClick={() => scrollTo(index - 1)}
                disabled={index === 0}
                aria-label={storiesCopy.prev || 'Previous story'}
              >←</button>

              {/* Pagination dots as plain buttons (not per-dot tab stops): each
                  carries "Go to story N" + aria-current on the active one. */}
              <div className="stories-dots">
                {stories.map((story, i) => (
                  <button
                    key={story.id}
                    type="button"
                    aria-label={goToStory(i)}
                    aria-current={i === index ? 'true' : undefined}
                    className={`story-dot${i === index ? ' active' : ''}`}
                    onClick={() => scrollTo(i)}
                  />
                ))}
              </div>

              <button
                type="button"
                className="story-nav"
                onClick={() => scrollTo(index + 1)}
                disabled={index >= stories.length - 1}
                aria-label={storiesCopy.next || 'Next story'}
              >→</button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
