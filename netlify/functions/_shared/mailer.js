// Thin email-provider wrapper for transactional signup mail (ADR-0003, S1).
// Resend is the default provider (simple REST API); a future provider is a
// drop-in replacement behind sendMagicLink(). The API key is server-only —
// read from RUNOUT_MAIL_API_KEY, never logged, never sent to the client.
//
// When the key is absent in DEV (NODE_ENV !== 'production', or an explicit
// RUNOUT_DEV_EMAIL=1 opt-in) the mailer is a NO-OP: it returns { sent: false }
// and logs the magic-link URL so a developer can still click through. NEVER
// log the access code — only the link (acceptable per the S1 spec). The access
// code is never even known in this module.
//
// S8 (#54, M3): in PRODUCTION a missing key FAILS CLOSED — sendMagicLink
// throws (code MAIL_NOT_CONFIGURED) and no link is ever minted or logged. A
// prod misconfiguration must not let an attacker mint sign-in links for any
// email (and thereby rotate a member's code) — it surfaces as a 5xx instead.

const RESEND_API = 'https://api.resend.com/emails'

export function mailApiKey() {
  return process.env.RUNOUT_MAIL_API_KEY || ''
}

export function mailFrom() {
  return process.env.RUNOUT_MAIL_FROM || 'Halcova <no-reply@halcova.app>'
}

// True when the transactional mail provider is configured.
export function isMailConfigured() {
  return !!mailApiKey()
}

// "Dev email mode": emit/log the magic-link URL only outside production, or
// with an explicit RUNOUT_DEV_EMAIL=1 override (e.g. a preview branch). In
// production the key is required and the link is never echoed to the client.
export function isDevEmailMode() {
  return process.env.NODE_ENV !== 'production' || process.env.RUNOUT_DEV_EMAIL === '1'
}

// Send a one-time sign-in link. Returns { sent: true } on success or
// { sent: false } in dev no-op mode. Throws on a real provider error (the
// caller surfaces a 502) — and, in production, when the key is missing (the
// caller surfaces a 5xx instead of issuing/logging a link).
export async function sendMagicLink({ email, link }) {
  const key = mailApiKey()
  if (!key) {
    if (!isDevEmailMode()) {
      // Production with no mail key: FAIL CLOSED — never mint or log a link.
      const err = new Error('Mail is not configured (RUNOUT_MAIL_API_KEY missing).')
      err.code = 'MAIL_NOT_CONFIGURED'
      throw err
    }
    // Dev no-op. The link is safe to log (expires ≤ 30 min, single-use); the
    // access code it eventually mints is never logged anywhere.
    console.log(`[mailer:dev] magic-link for ${email}: ${link}`)
    return { sent: false }
  }

  const res = await fetch(RESEND_API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: mailFrom(),
      to: [email],
      subject: 'Your Halcova sign-in link',
      html: `<p>Open this link to sign in to Halcova. It expires in 30 minutes and can only be used once.</p><p><a href="${link}">${link}</a></p>`,
    }),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Mail send failed (${res.status}): ${text.slice(0, 200)}`)
  }
  return { sent: true }
}
