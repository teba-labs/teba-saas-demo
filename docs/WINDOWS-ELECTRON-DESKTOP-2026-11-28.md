# Taiba Smart Lab — Windows desktop wrapper

## Architecture
- Electron opens the existing `app/index.html` from the installed application directory through the local `taiba://app/` secure custom scheme.
- No GitHub Pages URL is used as the renderer entry point.
- Existing HTML, CSS, JavaScript modules, offline IndexedDB/outbox, service worker and Supabase client remain the application runtime; this package adds a desktop host only.
- Supabase remains the existing primary project `hgqwpykeazuzceeiumjg`. The desktop wrapper does not create a database, migrate schemas, or use the historical project.
- Renderer security: sandbox, context isolation, web security and disabled Node integration. The preload exposes only non-sensitive desktop diagnostics. Permission prompts are denied by default.
- External links are opened outside the app only for HTTPS, mailto and tel URLs.

## Build on Windows
1. Install Node.js 22 LTS.
2. Clone this repository and checkout `feature/windows-electron-desktop-2026-11-28`.
3. Run `npm install`.
4. Run `npm run build:win`.
5. Install `dist/Taiba-Smart-Lab-Setup-1.0.0-x64.exe`.

The icon is generated from `build/taiba-icon.svg` during the build. The NSIS installer creates Start Menu and Desktop shortcuts and preserves application data on uninstall.

## First launch and connectivity
The UI is packaged locally. The web workspace now includes an installable `app/manifest.webmanifest` with local SVG icons, standalone display mode, and Service Worker shell caching (v104). The home and reception entry pages expose the manifest and mobile web-app metadata, plus an embedded local 180×180 PNG Apple touch icon so the iOS home-screen artwork does not require a remote request. Primary Cairo Google Fonts imports/preconnects were removed from the workspace, reception, settings, and data-import styles; these views use local system font stacks (Tahoma/Arial) rather than waiting for a remote font download. Supabase authentication and cloud operations still require internet. Existing supported offline features continue to use the application's IndexedDB, service worker and offline queue; an initial online sign-in/cache preparation is required before relying on offline use. Remote ES modules may still require an initial network connection and successful service-worker cache warm-up.

## Cross-device validation added in cycle 2
A branch-scoped Playwright/Chromium workflow checks 15 primary app routes (home, reception, workday, results, result entry, sync, catalog, dashboard, settings, CMS, site management, site preview, data import, platform administration and patient portal) at six emulated viewport profiles: compact Android, Pixel-sized Android, iPhone SE-sized, large iPhone-sized, tablet and desktop. It checks viewport metadata, document horizontal overflow, visible controls outside the viewport, login-field input, PWA manifest reachability, Service Worker installation/cache entries and cached reception navigation while offline. These are Chromium browser emulation checks, not physical-device or Safari certification. The existing `windows-desktop-build.yml` remains responsible for rebuilding the NSIS installer, silently installing it, launching the installed executable and uploading the installer artifact.

## Validation boundary
The source contract tests verify packaging configuration, local entry-point routing, renderer isolation, local-protocol traversal and method guards, external-navigation allow-listing, and the unchanged primary Supabase target. GitHub Actions builds the Windows NSIS installer on a Windows runner, silently installs it, launches the installed executable with a temporary local debugging endpoint, verifies that the `taiba://app/app/index.html` renderer target loads with the expected application title, then uploads the installer artifact. This smoke test does not exercise authenticated user workflows. Login with a real account, live Supabase RLS, reception/visit/result workflows, report preview, printer drivers and physical printer output still require a Windows machine and authorized test account; do not report these as passed unless executed.
