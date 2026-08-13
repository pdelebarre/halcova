# Halcova — your crate and shelf, cataloged

**Scan a barcode, catalog the thing.** Halcova is a progressive web app (PWA) for
cataloging your record and book collections. Point your phone's camera at a
barcode, Halcova looks the release up on **Discogs** (records) or **Google Books**
(books), you confirm the match, and it's saved. Install it to your home screen
and it runs full-screen, like a native app — no app store, no account.

Halcova supports **multiple users**: you (the site owner) approve who gets in,
and each member's collections are stored separately and protected by an access
code. See [Multi-user access](#multi-user-access--admin) below.

```
┌─────────────────────────────────────┐
│  Halcova — your crate, cataloged    │
│  [Records] [Books]            ⚙     │
│  ┌─────────────────────────────────┐│
│  │  ⌕ Search your crate…     ( 42 )││
│  │  [LP][EP][CD][7"][12"]   Sort ▾ ││
│  │  Genre: [Jazz][Soul]  Artist ▾  ││
│  ├─────────────────────────────────┤│
│  │  ⬤  Kind of Blue        Miles   ││
│  │  ⬤  Blue Train          Coltrane││
│  │  ⬤  …                           ││
│  └─────────────────────────────────┘│
│                     ( 📷 Scan )      │
└─────────────────────────────────────┘
```

## Features

- **Barcode scanning** — reads EAN-13, EAN-8, UPC-A, UPC-E and Code 128
  (retail codes printed on sleeves and book covers) straight from your phone's
  camera, using a WASM port of ZXing for reliable decoding on iOS Safari.
- **Records via Discogs** — scan looks up the Discogs database; browse matching
  pressings, view tracklists, and jump out to the Discogs release page.
- **Books via Google Books** — scan an ISBN (or ISBN-10) and get the edition
  back, with publisher, page count, categories, description and a Google Books
  link. No token needed.
- **Duplicate detection** — before anything is added, Halcova tells you whether
  you already own the exact release, a different pressing of the same album, or
  other albums by the same artist.
- **Two catalogs, one flow** — Records and Books tabs share a single collection
  engine (search, filters, sort, detail, notes) with per-type copy and layout.
- **Multi-user with per-user plans** — visitors request access; you approve them
  from an **admin screen**, granting each member **Records and/or Books**. Their
  collections are isolated and every API call is authenticated with their access
  code.
- **Search & manual entry** — when a scan comes up empty, search by
  title/artist/author, or add the item by hand.
- **Your data, server-side** — collections are stored in Netlify Blobs, so
  they're tied to your site, not one browser or device. Reinstalling or
  clearing Safari's data won't lose them.
- **Offline shell** — the app shell and cached Discogs/Google results are
  precached by a service worker, so it opens instantly on a flaky connection.
- **PWA installable** — add to your home screen and it runs standalone in its
  own window, portrait, with its own icon.

## How it works

0. **Sign in** — members sign in with an access code (or request one). The admin
   signs in with the site's admin key.
1. **Scanning**: uses your phone's camera in the browser (no app install
   needed) to read the barcode, then queries Discogs (records) or Google Books
   (books) for a match.
2. **Confirm**: if there's a single match you land straight on the result; if
   several pressings/editions match, pick the right one. Halcova flags anything
   you already own before you add.
3. **Storage**: your collection lives server-side via Netlify Blobs, isolated
   per user, so it's not tied to one browser or device.
4. **Offline shell**: the app itself (not your data) is cached so it opens
   instantly even on a flaky connection. Already-seen barcodes resolve from
   your local collection with no network round-trip.

## Multi-user access & admin

Halcova has no passwords — access is granted by you. The flow is:

1. **Visitor requests access** — the sign-in screen offers "Request access"
   (name + email), which creates a pending request.
2. **You approve from the admin panel** — signed in with your admin key, tap the
   shield in the header. Pending requests appear with **Approve / Reject**.
   On approve, choose which collections the member gets (**Records** and/or
   **Books**) and Halcova generates an `RU-XXXX-XXXX-XXXX` access code for you to
   share.
3. **The member signs in** with that code. The app only shows the tabs they were
   granted, and every collection read/write is authenticated with the code.
4. **You manage members** — change a member's collection access at any time,
   disable or delete an account (deleting also clears their stored
   collections), or re-reveal a lost code.

The **admin key** is the site owner's credential. Set it in your Netlify
environment so it's never in the repo:

```bash
# netlify env:set RUNOUT_ADMIN_KEY "<a long random string>"
# or in a local .env for `netlify dev`:
RUNOUT_ADMIN_KEY="$(openssl rand -hex 24)"
```

> ⚠️ The dev fallback `runout-dev-admin-key` is only for local testing. Set a
> real `RUNOUT_ADMIN_KEY` in production, or anyone can sign in as the admin.

Each member's data lives in its own blob store (`collection-<userId>-<kind>`);
your own collections stay in the original `runout-collection` /
`runout-library` stores, so nothing needs migrating. Lookups run through
server-side proxies, so the Discogs token is owned by the site (a single
`RUNOUT_DISCOGS_TOKEN`), not by users — nobody pastes a token in Settings.

## Tech stack

| Layer | Choice |
| --- | --- |
| UI | React 19 + Vite 8 |
| Barcode decoding | `zxing-wasm` (WASM, self-hosted + precached) |
| Record lookup | Discogs API via server-side proxy (single `RUNOUT_DISCOGS_TOKEN`) |
| Book lookup | Google Books API (public, no key) |
| Persistence | Netlify Blobs via Netlify Functions (`collection`, `auth`, `admin`) |
| Auth | Access codes + admin key (`RUNOUT_ADMIN_KEY`) |
| PWA | `vite-plugin-pwa` (Workbox, auto-update) |
| Linting | oxlint |
| Testing | Vitest + Testing Library (jsdom) |

## One-time setup

### 1. Get a free Discogs token

The app needs this to look up record barcodes. It's free, no app review, just a
personal token:

1. Create a Discogs account at discogs.com if you don't have one.
2. Go to **Settings → Developers → Generate new token**.
3. Copy the token and set it as the site's `RUNOUT_DISCOGS_TOKEN` (see
   "Deploy to Netlify" below) — the token lives server-side on the lookup
   proxy, never in anyone's browser.

Books don't need a token — Google Books is a public API.

### 2. Deploy to Netlify

**Option A — Netlify CLI** (fastest if you have Node installed locally):

```bash
npm install
npm install -g netlify-cli   # if you don't have it already
netlify deploy --build --prod
```

Follow the prompts to link or create a site. Netlify Blobs works
automatically — no database to provision.

Before going live, set the admin key so you can sign in as the owner, plus the
Discogs lookup token the server-side proxy uses:

```bash
netlify env:set RUNOUT_ADMIN_KEY "$(openssl rand -hex 24)"
netlify env:set RUNOUT_DISCOGS_TOKEN "<your Discogs personal access token>"
```

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
4. No token to paste — lookups run through the server-side proxy, which owns
   the Discogs token.
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

The Vite dev server proxies `/.netlify/functions` to `localhost:8888` when
`netlify dev` is running, so both paths work locally.

Camera access requires HTTPS or `localhost` — both `netlify dev` and
`vite dev` satisfy that on your own machine, but scanning on an iPhone
during development means using the deployed HTTPS URL, not a local IP.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the Vite dev server (frontend only) |
| `npm run build` | Production build to `dist/` (includes PWA assets) |
| `npm run preview` | Preview the production build locally |
| `npm run lint` | Lint with oxlint |

## Notes on Discogs' barcode search

Discogs' barcode index isn't perfect — some releases (especially older or
regional pressings) aren't tagged with a barcode even if the record has one
printed on it. When a scan comes back empty, the app offers a title/artist
search as a fallback, or manual entry if it's not on Discogs at all.

## Documentation

- **[Functional documentation](docs/functional.md)** — what the app does:
  features, screens, user flows, states, and edge cases.
- **[Technical documentation](docs/technical.md)** — how it's built:
  architecture, data model, APIs, offline/PWA strategy, and the deployment
  pipeline.

## Project structure

```
├── inde├── collection.js      # CRUD API backed by Netlify Blobs (auth-gated)
│       ├── auth.js            # Request access / sign in / session validation
│       ├── admin.js           # Admin panel API (approve, manage members)
│       └── _shared/           # auth + users/blob-store helpers
└── src/
    ├── main.jsx               # React entry point
    ├── App.jsx                # Auth gate + tabs (records/books) + admin shell
    ├── AuthScreen.jsx         # Sign in / request access
    ├── AdminPanel.jsx         # Approve requests, manage member access
    ├── CollectionView.jsx     # One collection screen (scan/filter/sort/…)
    ├── catalog.js             # Per-kind config: records vs books
    ├── api/
    │   ├── discogs.js         # Discogs search/detail client (per-user token)
    │   ├── books.js           # Google Books client
    │   ├── auth.js            # Auth + admin API client
    │   └── collection.js      # Netlify function client (Bearer auth)
    ├── hooks/
    │   ├── useAuth.js         # Session state (login/logout/request access)
    │   └── useCollection.js   # Collection state + optimistic updates
    ├── utils/
    │   ├── match.js           # splitArtistTitle + duplicate detection
    │   └── session.js         # Persisted access-code sess
    │   ├── books.js           # Google Books client
    │   └── collection.js      # Netlify function client
    ├── hooks/
    │   └── useCollection.js   # Collection state + optimistic updates
    ├── utils/
    │   └── match.js           # splitArtistTitle + duplicate detection
    └── components/            # Scanner, match picker, cards, grids, detail,
                               # settings, toolbar, empty states
```
