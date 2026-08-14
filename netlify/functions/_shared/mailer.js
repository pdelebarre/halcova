// Thin email-provider wrapper for transactional signup mail (ADR-0003, S1).
// Resend is the default provider (simple REST API); a future provider is a
// drop-in replacement behind sendMagicLink(). The API key is server-only —
// read from RUNOUT_MAIL_API_KEY, never logged, never sent to the client.
//
// When the key is absent (local dev / preview) the mailer is a NO-OP: it
// returns { sent: false } and logs the magic-link URL so a developer can still
// click through. NEVER log the access code — only the link (acceptable per the
// S1 spec). The access code is never even known in this module.

const RESEND_API = 'https://api.resend.com/emails'

export function mailApiKey() {
  return process.env.RUNOUT_MAIL_API_KEY || ''
}

export function mailFrom() {
  return process.env.RUNOUT_MAIL_FROM || 'Halcova <no-reply@halcova.app>'
}

// Send a one-time sign-in link. Returns { sent: true } on success or
// { sent: false } in dev no-op mode. Throws only on a real provider error so
// the caller can surface a 502 — a missing key is NOT an error.
export async function sendMagicLink({ email, link }) {
  const key = mailApiKey()
  if (!key) {
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
