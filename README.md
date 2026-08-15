# Halcova

Halcova is a progressive web app for cataloguing personal records and books.

The application is built with React and Vite and is deployed through Netlify Functions. It supports barcode scanning, catalogue lookup, collection management, lending and offline-capable PWA workflows.

## Development

```bash
npm install
npm run dev
```

Run the Netlify development environment when testing serverless functions:

```bash
netlify dev
```

## Environment

Copy `.env.example` to `.env` and provide local development values. Keep secrets out of source control.

The legacy `RUNOUT_*` environment variables and storage identifiers are retained for compatibility; they are not public application branding.

## Checks

```bash
npm test
npm run build
npm run lint
```
