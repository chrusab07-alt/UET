# UET Bus Route Info

## Search and deployment

Homepage autocomplete uses the local UET stop dataset. GPS uses browser geolocation; Google Maps directions remain ordinary coordinate-based links. No Google API key or loader is needed. Route Schedules searches numbers, labels, names, start areas, campuses, stops, and aliases through one normalization helper, including Govt./Government spelling equivalence. Official display names are unchanged.

Select GitHub Actions in Settings → Pages and run the Deploy GitHub Pages workflow. For local builds, run `node scripts/build-pages.cjs` and serve `_site` over HTTP. The build preserves an existing CNAME.

Run `node --test tests/*.test.cjs`, `node tests/places-browser.cjs` (current local-search/GPS browser regression), and `node tests/responsive-accessibility.cjs` with Playwright available. Set CHROMIUM_PATH if needed.

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

`NEARBY_ROUTE_CONFIG` in `js/app.js` controls the nearby search radius (1.5 km). Distances are straight-line estimates, not walking routes.

The finder sorts all individual pickup stops for the selected campus and calculates straight-line distance to every valid pickup stop. It returns every valid stop that is within 1.5 km of the user's location, sorted from nearest to farthest. Multiple nearby stops on the same route and across different routes within 1.5 km are preserved. If no stop is found within 1.5 km, the interface indicates that no nearby UET bus stop was found within 1.5 km.

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
## Responsive layout and keyboard checks

Targeted rules in `css/styles.css` align `.search-input-group` controls at 1024 px and below, stabilize `.header-container` / `.header-actions`, stack `.campus-toggle-wrapper` on phones, and keep `.stats-grid` in two columns on normal phone widths. `.search-field-wrapper` positions both original icon elements and Lucide-generated SVGs so icons cannot shrink the input. Both search-result and full-route `.stops-timeline` views use a dedicated marker column with connected half-lines that stop at the first and last marker centers. Existing theme color variables and route data are unchanged.

`index.html` groups the theme and menu buttons and provides dialog semantics. `js/app.js` adds keyboard-operable FAQ/pickup buttons, selected-state attributes, modal/drawer focus containment, Escape dismissal, and focus restoration. Full-route focus moves to its Back button after the section becomes visible.

Run `node tests/responsive-accessibility.cjs` with Playwright available and `CHROMIUM_PATH` pointing to Chrome if needed. Set `TEST_EXTERNAL_ASSETS=1` to include the deployed fonts and icons. The script checks 360x800, 390x844, 412x915, 768x1024, 820x1180, 1024x768, and 1366x768 in both themes, and saves screenshots under ignored `test-results/`. Checks include actual input/button geometry, campus dimensions, stats rows, timeline axes, full-route isolation, FAQ keyboard activation, print-dialog focus trapping/restoration, drawer dismissal, and document overflow.


Timeline regression coverage also renders the Flat Stop search result, including origin, nearest-pickup, intermediate and destination markers. Each dot is checked against the line center at every target size/theme, including hover; marker diameter, continuous row connections and first/last line endpoints are checked. The centered CSS is shared by both timeline views.
