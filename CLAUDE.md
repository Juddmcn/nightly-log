# Nightly Log app — notes for Claude

J's personal to-do / nightly log PWA, installed on his iPhone from Safari ("Add to Home Screen").
Live at https://juddmcn.github.io/nightly-log/ (GitHub Pages, branch `main`, root). Pushing to `main` deploys; the phone picks up changes on its next open (service worker is network-first).

## Files
- `index.html` — markup: Log / To-do / Stats tabs, setup screen (GitHub token), PWA meta tags.
- `style.css` — design tokens on `:root` with dark-mode overrides; keep colors as tokens.
- `app.js` — all UI logic (log form, tasks, Canvas sections, grade-impact ranking, streaks, charts).
- `store.js` — data layer. Reads/writes JSON files in the PRIVATE repo `Juddmcn/nightly-log-data` via the GitHub Contents API using a fine-grained token stored in the phone's localStorage. Exposes a Firestore-like `NL.db` (collection/doc, set/update/delete/add, onSnapshot). Offline writes queue in localStorage and flush with sha-based conflict retry.
- `sw.js` — service worker. Bump `CACHE` when adding new shell files.
- `manifest.webmanifest`, `icons/` — install metadata.

## Data
Never commit personal data here (this repo is public). Data schema is documented in `Juddmcn/nightly-log-data/README.md`.

## Making changes J asks for
1. Edit, then sanity-check: `node --check app.js store.js sw.js`.
2. Commit and push to `main`. Pages redeploys in ~1 minute.
3. If the data shape changes, update the data repo README and the nightly check-in scheduled task prompt.
