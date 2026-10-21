# Installing HR & Payroll on a phone (PWA)

The web app is a Progressive Web App: it can be added to a phone's home screen and then opens full screen like an
app, with the company mark as its icon. There is no Play Store or App Store listing and no separate mobile codebase.

## For users

- **Android (Chrome):** open the site, then menu (three dots) > **Install app** (or **Add to Home screen**).
- **iPhone (Safari):** open the site, tap **Share** > **Add to Home Screen**. It must be Safari; other iOS browsers
  cannot install web apps.

If the phone has no signal, the app shows an "offline" page with a **Try again** button. The app itself needs an
internet connection: attendance, payroll and wages are never stored on the phone by the service worker.

## What is in the code

| File | Purpose |
| --- | --- |
| `apps/web/public/manifest.webmanifest` | App name, colours and icons the phone reads when installing |
| `apps/web/public/icons/` | 192/512 px icons, a maskable icon for Android's round and squircle crops, the iOS icon and the favicon |
| `apps/web/public/sw.js` | Minimal service worker: offline page only, caches nothing else |
| `apps/web/public/offline.html` | Page shown when a navigation fails for lack of signal |
| `apps/web/src/registerServiceWorker.ts` | Registers the worker in production builds only |
| `apps/web/index.html` | Manifest link, theme colour and iOS home-screen tags |

The icons are cut from the client's transparent logo (`apps/api/Pdf/Assets/logo.png`): the mark only, because the
company name is unreadable at icon size. Regenerate them if the logo changes.

## Hosting requirements

- **HTTPS is mandatory.** Phones only offer to install a PWA from a secure address (`localhost` is the one exception).
- Serve the app from the **site root** (`/`). The worker's scope and the manifest's `start_url` are `/`.
- Serve `sw.js` with `Cache-Control: no-cache` so a changed worker reaches phones promptly. Hashed files under
  `/assets/` can be cached for a long time.
- Serve `/api/*` from the same origin as the web app (as the dev proxy does), so no CORS rules are needed.

## Testing locally

The worker only registers in a production build:

```bash
cd apps/web
npm run build
npx vite preview --port 4173
```

Open `http://localhost:4173` in Chrome and check DevTools > Application > Manifest and Service Workers. The preview
uses the same `/api` proxy as the dev server, so the API must be running on port 5210.
