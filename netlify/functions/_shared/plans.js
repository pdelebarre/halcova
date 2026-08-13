// Free-tier plan model for Runout collections. Limits are config-driven so a
// future tier is a one-line config change, not a code change. Enforced
// server-side in netlify/functions/collection.js on POST only (see the
// netlify-collection skill).

export const PLAN_LIMITS = {
  free: 10,
  unlimited: null,
}

// The item cap for a user, or `null` when they are NOT capped:
//   - the owner (role 'admin' / id 'owner') is never capped,
//   - the `unlimited` plan is never capped (PLAN_LIMITS.unlimited is null),
//   - any user without a recognized plan is defensively uncapped too — the
//     cap only ever bites a known `free` plan.
export function planLimitFor(user) {
  if (!user) return null
  if (user.role === 'admin' || user.id === 'owner') return null
  const limit = PLAN_LIMITS[user.plan]
  return limit ?? null
}
