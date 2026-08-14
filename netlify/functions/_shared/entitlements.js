// Entitlement resolution (ADR-0003 §2.3, S2). Lending is DERIVED from the plan:
// any paid plan includes it, and the owner/admin role is always entitled — while
// the admin keeps a manual per-account override via `features.lending`.
//
// Games stays EXACTLY as the merged games-entitlement work defined it: an
// admin-granted per-account flag (`user.features.games`), NOT derived from the
// plan. This module deliberately does not rebuild the raw `features` map, so
// that integration is untouched — `effectiveFeatures` only resolves `lending`
// today. The client still reads the raw flag at session.user.features.games.
//
// `paid` = any of the uncapped plans: 'premium' (subscription), 'lifetime'
// (one-time), 'unlimited' (grandfathered private-test value).

export const PAID_PLANS = ['premium', 'lifetime', 'unlimited']

export function isPaidPlan(user) {
  return !!user && PAID_PLANS.includes(user.plan)
}

// The effective per-account capability set (currently just `lending`):
//   lending = features.lending            (admin's manual per-account override)
//           || plan ∈ {premium,lifetime,unlimited}   (any paid plan)
//           || role === 'admin'           (owner/owner-style identities)
// Defensive for null/unknown users (returns { lending: false }).
export function effectiveFeatures(user) {
  const paid = isPaidPlan(user)
  const lending = !!(user?.features?.lending || paid || user?.role === 'admin')
  return { lending }
}
