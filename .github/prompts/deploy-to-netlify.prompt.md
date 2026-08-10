---
description: "Build and deploy Runout to Netlify (netlify deploy). Triggers: 'deploy', 'ship it', 'publish to netlify', 'update the live site', 'go live'."
name: "Deploy to Netlify"
argument-hint: "Production deploy or a preview (add --alias for a draft URL)?"
agent: "Runout Engineer"
---
Build Runout and deploy it to Netlify.

## Steps
1. `npm install --cache "$TMPDIR/npm-cache"` if dependencies are missing
   (sandbox needs a temp npm cache).
2. `npm run lint` and `npm test` — don't deploy a red build.
3. `npm run build` (outputs `dist`).
4. Deploy with the Netlify CLI so `netlify/functions` ships — drag-and-drop of
   `dist` skips functions and breaks the collection API:
   - Production: `netlify deploy --build --prod`
   - Preview: `netlify deploy --build`
5. Confirm `RUNOUT_ADMIN_KEY` is set in the Netlify environment (never the
   dev fallback `runout-dev-admin-key`); the site owner signs in with it.
6. Smoke-test the live site: open it, add an item, reload — data must persist
   (proves Blobs + the function work), and sign-in still works with an access
   code.

## Gotchas
- Camera scanning needs HTTPS — the deployed site is fine; a local IP is not.
- The Discogs token is per-browser (`localStorage`), not set at deploy time.
- Never log or commit the admin key or member access codes.
