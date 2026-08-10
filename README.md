# Runout — your record collection, cataloged

A PWA for cataloging your LP/EP/CD collection. Scan a barcode with your
iPhone's camera, it looks the release up on Discogs, you confirm the match,
and it's saved to your crate. Install it to your home screen and it runs
full-screen, like a native app.

## How it works

- **Scanning**: uses your phone's camera in the browser (no app install
  needed) to read the barcode, then queries the Discogs database for a match.
- **Storage**: your collection lives server-side via Netlify Blobs, so it's
  not tied to one browser or device — reinstalling or clearing Safari's data
  won't lose it.
- **Offline shell**: the app itself (not your data) is cached so it opens
  instantly even on a flaky connection.

## One-time setup

### 1. Get a free Discogs token

The app needs this to look up barcodes. It's free, no app review, just a
personal token:

1. Create a Discogs account at discogs.com if you don't have one.
2. Go to **Settings → Developers → Generate new token**.
3. Copy the token — you'll paste it into the app's Settings screen once it's
   deployed (stored only in your phone's browser, never sent anywhere but
   Discogs).

### 2. Deploy to Netlify

You already use Netlify, so the easiest path:

**Option A — Netlify CLI** (fastest if you have Node installed locally):
```bash
npm install
npm install -g netlify-cli   # if you don't have it already
netlify deploy --build --prod
```
Follow the prompts to link or create a site. Netlify Blobs works
automatically — no database to provision.

**Option B — drag and drop**: run `npm install && npm run build` locally,
then drag the resulting `dist` folder onto
[app.netlify.com/drop](https://app.netlify.com/drop). Note: this skips the
`netlify/functions` folder, so the collection API won't work — Option A or a
Git-connected site (Option C) is recommended instead.

**Option C — connect the Git repo**: push this folder to a GitHub repo, then
in Netlify: **Add new site → Import an existing project**, point it at the
repo. Build command `npm run build`, publish directory `dist` — both are
already set in `netlify.toml`, so Netlify should pick them up automatically.

### 3. Install it on your iPhone

1. Open your deployed `https://your-site.netlify.app` URL in **Safari** (has
   to be Safari, not Chrome, for the install step).
2. Tap the Share icon → **Add to Home Screen**.
3. Open it from the home screen icon — it now runs full-screen.
4. Tap the settings (gear) icon and paste in your Discogs token.
5. Tap **Scan** and point the camera at a barcode.

## Local development

```bash
npm install
npm run dev          # frontend only, on http://localhost:5173
```

The collection API (`/.netlify/functions/collection`) only runs under
Netlify's own dev server, which also serves the frontend with the same
proxying `netlify.toml` sets up in production:

```bash
npm install -g netlify-cli
netlify dev           # serves frontend + functions together, usually :8888
```

Camera access requires HTTPS or `localhost` — both `netlify dev` and
`vite dev` satisfy that on your own machine, but scanning on an iPhone
during development means using the deployed HTTPS URL, not a local IP.

## Notes on Discogs' barcode search

Discogs' barcode index isn't perfect — some releases (especially older or
regional pressings) aren't tagged with a barcode even if the record has one
printed on it. When a scan comes back empty, the app offers a title/artist
search as a fallback, or manual entry if it's not on Discogs at all.

## Project structure

```
src/
  api/            Discogs + collection (Netlify function) API clients
  components/     UI: scanner, match picker, grid, detail sheet, settings
  hooks/          useCollection — collection state + optimistic updates
netlify/functions/collection.js   CRUD API backed by Netlify Blobs
```
