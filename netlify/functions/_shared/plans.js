// Plan model for Runout collections (ADR-0001 free tier, ADR-0003 §2.3 S2
// entitlement model). Limits are config-driven so a future tier is a one-line
// config change, not a code change. Enforced server-side in
// netlify/functions/collection.js on POST only (see the netlify-collection
// skill).
//
// Plan enum: 'free' (the ONLY capped plan) | 'premium' (subscription) |
// 'lifetime' (one-time) | 'unlimited' (grandfathered private-test value).
// Every paid plan is uncapped (null). The free cap is config-driven via
// RUNOUT_FREE_LIMIT (default 10).

export const PLAN_LIMITS = {
  free: Number(process.env.RUNOUT_FREE_LIMIT ?? 10),
  premium: null,
  lifetime: null,
  unlimited: null,
}

// The item cap for a user, or `null` when they are NOT capped:
//   - the owner (role 'admin' / id 'owner') is never capped,
//   - any paid plan (premium / lifetime / unlimited) is never capped
//     (PLAN_LIMITS[plan] is null),
//   - any user without a recognized plan is defensively uncapped too — the
//     cap only ever bites a known `free` plan.
export function planLimitFor(user) {
  if (!user) return null
  if (user.role === 'admin' || user.id === 'owner') return null
  const limit = PLAN_LIMITS[user.plan]
  return limit ?? null
}
