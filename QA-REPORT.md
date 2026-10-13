# QA report — «Выдох» 1.2.0

## Автоматические проверки

- `npm run check`: passed (JavaScript modules, Service Worker syntax, JSON manifest).
- `npm test`: 31 passed, 0 failed.
- CSS parsed with `tinycss2`: passed, no syntax errors.
- Service Worker precache: 14 declared entries, all referenced files exist.
- Static HTTP smoke test on a local HTTP server: 11/11 key paths returned HTTP 200 (entry HTML, manifest, Service Worker, JS/CSS modules and legacy entry).
- Release ZIP integrity checked with `unzip -t`; archive extracted successfully and tests rerun from the extracted package.

## Test coverage includes

- Breathing modes and comfort-first instructions.
- Official source references, including the WHO 2026 step-by-step guide and WHO information specifically about quitting e-cigarettes.
- Legacy `vydokh.v1`/`vydokh.v2` migration and preservation of original keys.
- Unknown values versus explicit zero-use days.
- Period-based analytics, personal baseline comparisons, practice history, favorites and feedback.
- Honest savings estimates when measurements are missing or use has been reported.
- Backup import sanitation and compatibility.

## Remaining release checks

The full interactive Chromium UI walkthrough could not be completed in this execution environment because browser automation blocks navigation to the local development URL. Consequently, automatic syntax/data tests and HTTP smoke checks do not prove that all interactions render correctly on every browser. Before a public release, manually verify the complete first-run, practice, favorites, post-session feedback, analytics and help-library flows in a regular browser, then test PWA installation, Service Worker update/offline behavior, audio, vibration and notification behavior on physical iPhone and Android devices.

## Medical-content scope

The help library links to official WHO, CDC and NHS resources. The WHO adult tobacco cessation clinical guideline is described as adult tobacco guidance, not individualized treatment for vaping. Breathing practices are described as an optional stress/attention tool and not as treatment for nicotine dependence.
