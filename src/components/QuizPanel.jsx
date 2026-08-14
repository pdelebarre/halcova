import { useEffect, useMemo, useState } from 'react'
import { buildQuiz, gradeAnswer, revealDate } from '../utils/quiz'
import { readLedger, recordQuizResult } from '../utils/progressionLedger'
import { currentStreak, toLocalDayKey } from '../utils/streak'
import { track } from '../utils/track'
import './QuizPanel.css'

/**
 * Release 1.3 "Play" — The Crate Quiz (issue #50). A 60-second daily quiz
 * dealt from the member's OWN items by the pure buildQuiz engine (seeded by
 * the local day → the same set all day, replay-safe). Fully offline-safe: no
 * network, all local (PWA cover cache already makes covers work offline).
 *
 * Flow: intro → one question at a time → feedback after each answer → a
 * day-complete summary with the current streak.
 *   - Scoring: +10 XP per correct, written into the progression ledger via
 *     recordQuizResult so release 1.2's progression engine reads it; a perfect
 *     day lands in ledger.perfectDays, which flips the `quiz-whiz` badge.
 *   - Streak: completion records the local play day; the streak is read back
 *     from the shared currentStreak helper (1-day grace). Already played today
 *     → we show the summary instead of replaying (no double XP).
 *   - Wrong answers reveal the real answer + the item's dateAdded + notes
 *     (copy-bank §3) — never fabricated when notes/date are missing.
 *
 * Rendered inside the Play hub (PlayPanel) when GAMIFICATION_ENABLED is on.
 * `today` is injectable for deterministic tests; it defaults to device time.
 */
export default function QuizPanel({ items = [], catalog, today }) {
  const quizCopy = (catalog?.copy?.gamif?.quiz) || {}
  const kind = catalog?.kind === 'books' ? 'books' : 'records'

  // A stable "now" captured once per mount (a fresh Date every render would
  // reshuffle the day-seeded quiz and break "stable within a day"). Accepts a
  // Date or a date-like string/number (tests) — anything else falls back to
  // device time.
  const [now] = useState(() => {
    if (today instanceof Date) return today
    if (today !== undefined && today !== null) {
      const d = new Date(today)
      if (!Number.isNaN(d.getTime())) return d
    }
    return new Date()
  })
  const todayKey = useMemo(() => toLocalDayKey(now), [now])

  const quiz = useMemo(() => buildQuiz(items, { day: now, catalog }), [items, now, catalog])
  const questions = Array.isArray(quiz?.questions) ? quiz.questions : []

  const [phase, setPhase] = useState('intro') // intro | question | feedback | done
  const [index, setIndex] = useState(0)
  const [score, setScore] = useState(0)
  const [feedback, setFeedback] = useState(null) // { correct, selection }
  const [sortPick, setSortPick] = useState([]) // sortShelf tapped order
  const [summary, setSummary] = useState(null) // day-complete summary

  // Did the user already finish today's quiz? (prevents replays / double XP.)
  const playedToday = useMemo(() => {
    if (!todayKey) return false
    const ledger = readLedger(kind)
    return Array.isArray(ledger.quizDays) && ledger.quizDays.includes(todayKey)
  }, [kind, todayKey])

  // Land on the day-complete summary (not a replay) when already played.
  useEffect(() => {
    if (!playedToday || phase !== 'intro') return
    const ledger = readLedger(kind)
    const streak = currentStreak(ledger.quizDays, { today: now }).streak
    setSummary({ alreadyPlayed: true, streak })
    setPhase('done')
  }, [playedToday, phase, kind, now])

  // Intro teaser — the streak so far, so the habit reads at a glance.
  const teaserStreak = useMemo(() => {
    if (phase !== 'intro') return 0
    const ledger = readLedger(kind)
    return currentStreak(ledger.quizDays, { today: now }).streak
  }, [phase, kind, now])

  const locked = Boolean(quiz?.locked) || questions.length === 0

  // --- flow -----------------------------------------------------------------

  function startQuiz() {
    setScore(0)
    setIndex(0)
    setFeedback(null)
    setSortPick([])
    setPhase('question')
  }

  function submitAnswer(question, selection, correct) {
    if (correct) setScore((s) => s + 1)
    setFeedback({ correct, selection })
    track('gamif_quiz_answered', { kind, correct, day: todayKey, type: question.type })
    setPhase('feedback')
  }

  function handleChoice(i) {
    const question = questions[index]
    if (!question || feedback) return
    const { correct } = gradeAnswer(question, i)
    submitAnswer(question, i, correct)
  }

  function handleSortTap(itemId) {
    const question = questions[index]
    if (!question || feedback) return
    if (sortPick.includes(itemId)) return
    const next = [...sortPick, itemId]
    setSortPick(next)
    if (next.length === (question.answerIds || []).length) {
      const { correct } = gradeAnswer(question, next)
      submitAnswer(question, next, correct)
    }
  }

  function handleNext() {
    if (index + 1 < questions.length) {
      setIndex(index + 1)
      setFeedback(null)
      setSortPick([])
      setPhase('question')
      return
    }
    // Last question answered → record the day + streak + XP in the ledger.
    const correct = score
    const total = questions.length
    const recorded = recordQuizResult(kind, { day: todayKey, correct, total })
    const streak = currentStreak(recorded.quizDays, { today: now }).streak
    setSummary({ score: correct, total, streak, perfect: total > 0 && correct === total, alreadyPlayed: false })
    track('gamif_quiz_streak', { kind, streak, day: todayKey })
    setPhase('done')
  }

  // --- render helpers --------------------------------------------------------

  /** The wrong-answer teaching reveal (never fabricates notes or dates). */
  function revealLine(question) {
    const reveal = question?.reveal || {}
    const title = reveal.title || ''
    const date = revealDate(reveal.dateAdded)
    const notes = String(reveal.notes || '').trim()

    if (date && notes) return interpolate(quizCopy.wrongReveal, { title, date, notes })
    if (date) return interpolate(quizCopy.wrongRevealNoNotes, { title, date })
    if (notes) return interpolate(quizCopy.wrongRevealNotesOnly, { title, notes })
    return interpolate(quizCopy.wrongRevealNoDate, { title })
  }

  function correctLine(questionIndex) {
    const lines = Array.isArray(quizCopy.correct) ? quizCopy.correct : []
    if (lines.length === 0) return 'Correct.'
    return lines[questionIndex % lines.length] || 'Correct.'
  }

  function optionClass(question, i) {
    const classes = ['quiz-option']
    if (!feedback) return classes.join(' ')
    if (i === question.answerIndex) classes.push('correct')
    else if (i === feedback.selection && !feedback.correct) classes.push('wrong')
    return classes.join(' ')
  }

  function renderIntro() {
    return (
      <div className="quiz-stage quiz-intro">
        <h3 className="quiz-title">{quizCopy.title || 'The Crate Quiz'}</h3>
        <p className="quiz-intro-copy">{quizCopy.intro || 'A quiz from your own collection.'}</p>
        {teaserStreak > 0 && (
          <output className="quiz-teaser">
            {interpolate(quizCopy.teaserStreak, { n: String(teaserStreak) })}
          </output>
        )}
        <button type="button" className="btn btn-primary quiz-start" onClick={startQuiz}>
          {quizCopy.start || 'Start the quiz'}
        </button>
      </div>
    )
  }

  function renderLocked() {
    return (
      <div className="quiz-stage quiz-locked">
        <p className="quiz-locked-title">{quizCopy.lockedTitle || 'Not enough items yet'}</p>
        <p className="quiz-locked-sub">{quizCopy.lockedSub || 'Scan a few more items first — the quiz needs at least three.'}</p>
      </div>
    )
  }

  function renderOption(question, i) {
    if (question.type === 'sortShelf') {
      const option = question.options[i]
      const pickIndex = sortPick.indexOf(option.itemId)
      return (
        <button
          key={option.itemId}
          type="button"
          className={`quiz-sort-option${pickIndex !== -1 ? ' picked' : ''}${feedback && option.itemId === question.answerIds[0] ? ' correct' : ''}`}
          onClick={() => handleSortTap(option.itemId)}
          disabled={Boolean(feedback)}
          aria-pressed={pickIndex !== -1}
        >
          {pickIndex !== -1 && <span className="quiz-sort-rank" aria-hidden="true">{pickIndex + 1}</span>}
          {option.cover && <img className="quiz-sort-cover" src={option.cover} alt="" loading="lazy" />}
          <span className="quiz-sort-title">{option.title}</span>
        </button>
      )
    }

    const label = question.options[i]
    const pressed = feedback ? i === feedback.selection : null
    return (
      <button
        key={`${question.type}-${i}`}
        type="button"
        className={optionClass(question, i)}
        onClick={() => handleChoice(i)}
        disabled={Boolean(feedback)}
        aria-pressed={Boolean(pressed)}
      >
        {label}
      </button>
    )
  }

  function renderQuestion() {
    const question = questions[index]
    if (!question) return renderLocked()
    const isSort = question.type === 'sortShelf'

    return (
      <div className="quiz-stage">
        <p className="quiz-counter" aria-live="polite">
          {interpolate(quizCopy.questionCount, { n: String(index + 1), total: String(questions.length) })}
        </p>
        <h3 className="quiz-prompt">{question.prompt}</h3>

        {question.cover && !isSort && (
          <img className="quiz-cover" src={question.cover} alt="" loading="lazy" />
        )}

        {isSort && <p className="quiz-sort-hint">{quizCopy.tapOrder || 'Tap them oldest to newest'}</p>}

        <div className={`quiz-options${isSort ? ' sort' : ''}`}>
          {question.options.map((_, i) => renderOption(question, i))}
        </div>

        {feedback && (
          <div className={`quiz-feedback${feedback.correct ? ' right' : ' wrong'}`} role="status" aria-live="polite">
            {feedback.correct ? (
              <p className="quiz-feedback-line">{correctLine(index)}</p>
            ) : (
              <>
                <p className="quiz-feedback-line">{revealLine(question)}</p>
                {isSort && (
                  <p className="quiz-feedback-order">
                    {interpolate(quizCopy.correctOrder, { order: (question.reveal?.ordered || []).map((o) => `${o.title} (${o.year})`).join(' · ') })}
                  </p>
                )}
              </>
            )}
            <button type="button" className="btn btn-primary quiz-next" onClick={handleNext}>
              {index + 1 < questions.length ? (quizCopy.next || 'Next question') : (quizCopy.done || 'Day complete!')}
            </button>
          </div>
        )}
      </div>
    )
  }

  function renderDone() {
    const s = summary || {}
    const streakLine = s.streak > 0 ? interpolate(quizCopy.streak, { n: String(s.streak) }) : ''
    return (
      <div className="quiz-stage quiz-done">
        <h3 className="quiz-title">{quizCopy.done || 'Day complete!'}</h3>
        {s.alreadyPlayed ? (
          <p className="quiz-done-copy">{quizCopy.alreadyPlayed || "You've done today's quiz."}</p>
        ) : (
          <>
            {s.perfect && <p className="quiz-perfect">{quizCopy.perfect || 'Perfect round!'}</p>}
            <p className="quiz-done-copy">{interpolate(quizCopy.score, { correct: String(s.score ?? 0), total: String(s.total ?? 0) })}</p>
          </>
        )}
        {streakLine && <output className="quiz-streak">{streakLine}</output>}
      </div>
    )
  }

  function renderStage() {
    if (locked) return renderLocked()
    if (phase === 'intro') return renderIntro()
    if (phase === 'done') return renderDone()
    return renderQuestion()
  }

  return (
    <div className="quiz-panel">
      {renderStage()}
    </div>
  )
}

/** Interpolate {token} placeholders; non-string templates yield ''. */
function interpolate(template, tokens) {
  if (typeof template !== 'string') return ''
  let out = template
  for (const [k, v] of Object.entries(tokens || {})) {
    out = out.split(`{${k}}`).join(String(v ?? ''))
  }
  return out
}
