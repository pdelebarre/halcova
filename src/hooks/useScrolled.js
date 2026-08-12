import { useEffect, useState } from 'react'

/**
 * True once the window is scrolled past `threshold` px. Used for the subtle
 * bottom border + backdrop blur on the sticky header and toolbar (§4.1).
 */
export function useScrolled(threshold = 4) {
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled((window.scrollY || window.pageYOffset) > threshold)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [threshold])

  return scrolled
}
