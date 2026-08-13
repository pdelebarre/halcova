import { useEffect, useState } from 'react'

/**
 * Subscribe to a CSS media query (e.g. '(min-width: 768px)') and return
 * whether it currently matches. Lets JSX pick responsive variants that pure
 * CSS can't (e.g. which A–Z index rail to render).
 */
export function useMedia(query) {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && !!window.matchMedia?.(query)?.matches,
  )
  useEffect(() => {
    const mql = window.matchMedia(query)
    const onChange = () => setMatches(mql.matches)
    onChange()
    mql.addEventListener?.('change', onChange)
    return () => mql.removeEventListener?.('change', onChange)
  }, [query])
  return matches
}
