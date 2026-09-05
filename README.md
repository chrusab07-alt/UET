# UET Bus Route Finder

## Google Places and GitHub Pages deployment

The location box uses Google's supported `PlaceAutocompleteElement` via `importLibrary('places')`, not legacy `Autocomplete`. Results are restricted to Pakistan and softly biased within 50 km of Lahore (31.5204, 74.3587). No place-type filter excludes roads, markets, universities, colleges, landmarks, or housing societies. Popular area chips remain optional shortcuts, separate from Google suggestions.

Selecting a suggestion calls `placePrediction.toPlace()` and `fetchFields` for `displayName`, `formattedAddress`, `location`, and `id`. Only validated selected-place coordinates enter the existing shared route finder. Editing the field invalidates its selection and pending detail requests. Raw text is never geocoded or matched to routes. GPS and campus/distance matching retain their existing behavior.

### Required outside this repository

1. Create a Google Cloud project, link an active billing account, and enable **Maps JavaScript API** and **Places API (New)**. The legacy Places API and Geocoding API are not required.
2. Create a browser API key. Set **Application restrictions → Websites (HTTP referrers)** to `https://rusabch07.github.io/*`. If using a custom domain, add its exact HTTPS hostname and `/*` (and the `www` hostname only if used). Do not allow all `*.github.io` sites. Avoid restricting only to `/UET/*`: browsers can strip paths from cross-origin referrers.
3. Set **API restrictions → Restrict key** to **Maps JavaScript API** and **Places API (New)**. Configure suitable quotas/budget alerts in Google Cloud.
4. In GitHub repository **Settings → Secrets and variables → Actions**, add a repository secret named **GOOGLE_MAPS_BROWSER_KEY** containing that restricted key.
5. In **Settings → Pages → Build and deployment**, select **GitHub Actions**. Push these changes to `main`, or run **Deploy GitHub Pages** from Actions after the workflow is available. The workflow runs regression tests, creates `_site`, injects `js/config.js` only into the deployed artifact, and deploys it. A missing key fails the build instead of replacing production with an unconfigured search.
6. Open the deployment URL reported by the workflow (expected default: `https://rusabch07.github.io/UET/`). Test real suggestions and selection on desktop and mobile. A custom domain also needs GitHub Pages domain/DNS configuration; an existing `CNAME` file is preserved by the build.

The committed `js/config.js` intentionally contains no key. Browser keys are visible in downloaded JavaScript even when supplied as GitHub secrets; HTTP-referrer and API restrictions are essential. Never commit an unrestricted key. This repository cannot enable billing, create credentials, or change account settings for you.

### Local or branch-based hosting

Use an HTTP development server rather than opening `index.html` through `file://`. To build locally, supply a separately restricted development key as the `GOOGLE_MAPS_BROWSER_KEY` environment variable and run `node scripts/build-pages.cjs`, then serve `_site`. Allow only the actual development origin (for example `http://localhost:8080/*`) on the development key. For branch-based Pages instead of Actions, `js/config.js` must be populated with a restricted browser key; the Actions approach avoids committing it.

### Failure behavior and verification

Without a key, the page states that Google search is not configured and points to Detect My Area. Script/network failure, timeout, authorization failure, prediction failure, and unavailable place details have explicit messages. No error path fabricates a selected location.

Run `node --test tests/nearby-routes.test.cjs` for GPS/Places parity across both campuses, input validation, and async selection tests. `node tests/places-browser.cjs` runs Chromium desktop/mobile smoke tests when Playwright and a Chromium browser are installed (set `CHROMIUM_PATH` if needed). Its Places responses are mocked: it tests application wiring and responsive layout, not Google's live suggestions or key authorization.

Live acceptance after configuration: type Johar Town, a road, a university, and a landmark; confirm Google suggestions; select one and confirm pickup results; edit the input and confirm Find Bus Route rejects it until reselection; compare GPS and Places at the same coordinates for Main and KSK; repeat at a phone viewport in light and dark themes. If unavailable, check browser console for `RefererNotAllowedMapError`, `ApiNotActivatedMapError`, billing, or quota errors and correct Cloud settings.

References: [Google autocomplete widget](https://developers.google.com/maps/documentation/javascript/place-autocomplete-new), [widget properties and events](https://developers.google.com/maps/documentation/javascript/reference/places-widget), [Google key security](https://developers.google.com/maps/api-security-best-practices), [GitHub Pages workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).
## Stop coordinate metadata and audit

Every route stop now explicitly includes `coordinateStatus`, `placeId`, `source`, and `aliases`. Existing coordinates have not been independently verified, so all are marked `unverified`; `placeId` and `source` are `null`, and `aliases` contain curated spelling variants where available. No coordinates, route IDs/names, timings, or campus assignments were changed.

- `unverified`: no exact coordinate verification is recorded.
- `approximate`: evidence establishes only an approximate position.
- `verified`: an exact pickup location has been checked; supply a nonempty `source` citation (URL or verification notes, preferably including date).
- `placeId`: a Google Place ID string when confirmed, otherwise `null`. A Place ID alone does not establish that a general place entrance is the exact bus pickup location.
- `source`: a citation string or `null`.
- `aliases`: additional known stop-name strings used by schedule/header search; they never affect coordinate-based recommendations.

Run `node scripts/audit-stop-coordinates.cjs` to validate numeric lat/lng ranges and metadata without modifying data. Invalid records fail the audit/CI. Duplicate coordinates are reported for manual review, not rejected or merged. Run with `--write` to regenerate [the full review report](docs/stop-coordinate-audit.md). Do not resolve a warning by guessing coordinates.

Run `node --test tests/*.test.cjs` for all regression tests, including rendered route labels and dataset preservation. The dataset baseline hash intentionally guards existing values; update it only after an explicitly authorized dataset revision. Coordinate status currently does not filter, rank, or otherwise affect pickup recommendations.
## Stop navigation

`getStopNavigationUrl(stop)` validates finite numeric lat/lng ranges and uses `destination=LATITUDE,LONGITUDE`. Invalid or missing coordinates produce no link and show `Navigation location not available`. Stop names never populate `destination_place_id`.

All current stops use coordinates. Future verified Google Place IDs may be used only by explicitly setting `placeIdVerified: true` alongside a nonempty `placeId`; coordinate verification status alone is not sufficient. Coordinates are still required as the destination/fallback. This optional flag affects only navigation, never route recommendations. See [Google Maps URL directions documentation](https://developers.google.com/maps/documentation/urls/get-started#directions-action).
## Nearby pickup selection policy

`NEARBY_ROUTE_CONFIG` in `js/app.js` controls the normal radius (500 m), fallback distance gap (150 m farther than the nearest stop), and maximum recommended pickup distance (1 km). Distances are straight-line estimates, not walking routes.

The finder sorts all individual pickup stops for the selected campus and records the nearest stop. It returns every stop within the normal radius when any qualify. Otherwise it returns the nearest stop and candidates no more than 150 m farther away, capped at 1 km. If the nearest stop exceeds the maximum, no pickup is recommended. `nearestStop` still identifies the nearest candidate for callers, but is not rendered as a recommendation. Multiple stops from one route remain separate. `matchingRoutes` and `allNearby` contain only the selected reasonable candidates; there is no separate 5 km suggestions list.

For example, 550 m and 610 m are offered together; 1.8 km is excluded. The optional fourth finder argument accepts a complete configuration object for tests or other callers; the UI uses the shared defaults.
## Homepage statistics

`calculateRouteStats`, `calculateCampusStats`, and `countUniqueStops` derive homepage statistics from the current database whenever Home renders. Total routes count route records (including separately listed variants and grouped shuttle entries), not individual buses. Unique stop names are deduplicated across all routes using lowercase names with trimmed/collapsed whitespace; campus terminals are included. Differently named stops are not merged based on unverified coordinates, Place IDs, or aliases. Campus counts may overlap in their stop-name totals.

Scheduled arrivals are the distinct `arrivalTime` values recorded for each campus, not an on-time performance claim or a universal start time. Missing times are omitted. No daily commuter statistic is displayed because the repository provides no verified source for it.
## Stop search aliases

`normalizeStopSearchText` lowercases text, trims/collapses whitespace, and converts punctuation to word separators while preserving Unicode letters and numbers. `stopMatchesSearch` checks the official name and aliases, with a compact spacing-insensitive comparison to preserve existing searches such as Mughalpura/Mughal Pura. No fuzzy geocoding or raw-text location resolution is involved.

Header exact lookup still prefers matches in the selected campus, falling back to another campus only when no exact match exists there. Route Schedules partial search stays within the selected campus. Official names are displayed unchanged. See [spelling review candidates and added aliases](docs/stop-spelling-review.md).

Aliases are now intentionally functional for text search. Verification status, Place ID, and coordinate-source metadata remain informational for search; recommendation-invariance tests still vary all of these fields, including aliases, to guard coordinate-based pickup ranking.
## Client-side navigation

Route lists use `#routes`; individual routes use `#routes/<route-id>` (for example `#routes/main-19`). Internal navigation uses browser history without reloading the document. Browser Back/Forward restores each entry's campus, search query, and saved list scroll position. Opening details from a card creates a route-list entry first when needed; the on-page Back button uses that entry. Direct detail URLs restore the route's own campus on load/refresh, and unknown or malformed route IDs are replaced with `#routes`. No GitHub Pages server rewrite is required.