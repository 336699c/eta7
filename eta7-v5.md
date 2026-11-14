# eta7-v5

eta7 is an experimental copy of the original `eta` site. It keeps the original
pages, scripts, CSS, icons, URL parameters and features, and only replaces the
static data source with the eta6 dataset
(`https://github.com/336699c/eta6/tree/data/static`).

## 1. Changes and methodology

### 1.1 What was copied

The whole original tree was copied: `index.html`, `route2.html`, `route3.html`,
`bystop.html`, `README.md`, `script/*`, `v13/*`, `icon/*`. The only mechanical
change is that absolute paths `/eta/...` became `/eta7/...` (icons, iframes,
cookie path). Page markup, styles, feature logic, URL schemes and UI text are
unchanged.

### 1.2 Data adapter

One new file was added: `script/eta6-data.js`. It loads the eta6 static files
once per page and rebuilds the two legacy data shapes in memory:

| Legacy shape | Used by | Rebuilt from |
| --- | --- | --- |
| hkbus `routeFareList` (`routeList`, `stopList`, `stopMap`) | `index.html`, `route2.html`, `route3.html`, `hk-bus-crawling-converter.js` | `index.json`, `routeStop.json`, `stops.json`, `operator_map.json`, `nearby.json` |
| eta2 `_rtlist` / `_stoplist` | `v13/index`, `v13/route2`, `v13/route3`, `bystop.html`, `v13/bystop.html` | same files + `stop_routes.json` |

Only the data entry points were edited:

1. `script/hk-bus-crawling-converter.js` — `reload()` now calls
   `Eta6.routeFareList()` instead of fetching `routeFareList.min.json`.
2. `bystop.html` and `v13/bystop.html` — the two `_rtlist`/`_stoplist` requests
   became `Eta6.legacy()`.
3. `v13/route2.html`, `v13/route3.html`, `v13/index.html` — same replacement.
4. One `<script src=".../eta6-data.js">` tag was added to every page that loads
   the data.

No build step, no generated files, no persistent state and no stop-code
allocator are involved; everything is derived with the data already published on
the eta6 `data` branch.

### 1.3 Mapping rules

- `routeFareList.routeList` is keyed by the eta6 variant id (`CTB_10_I2`,
  `KMB_108_I1`, ...). `route2.html` naturally lists one row per variant/company.
- `co` is lower-case (`ctb`, `kmb`, `nlb`, `lrtfeeder`); `LWB` is treated as
  `kmb` (LWB shares KMB stops and the KMB ETA API), and GMB is excluded because
  the original site does not display it.
- Joint routes keep the canonical `KMB+CTB` company order (so the existing
  combined icon resolves), but their stop map is CTB-first. The original route3
  keys both companies' ETA results on the first stop list, and the CTB stop-eta
  API only accepts CTB stop ids.
- TD stop codes from eta6 are translated to operator stop ids through
  `operator_map.json`. When a code is unmatched, the nearest matched code
  within 80 m (`nearby.json`) is used; if that also fails, the TD code itself is
  kept so the page still renders.
- Fares are rebuilt per stop index from `fares.kind`:
  `flat`, `ladder` (`[first,last,priceIndex]`) and `matrix` (`rows[i]` per
  boarding stop, keeping every distinct price in the run list).
- Frequencies are rebuilt from `freq[serviceId]` plus
  `index.services[serviceId].days`, converted to the hkbus weekday bitmask
  (`1` = Mon ... `64` = Sun). `fixedDepartures` is used only when a variant has
  no frequency table.
- Circular variants are marked `OI` for CTB-led routes so the original
  duplicated-stop handling keeps working.
- NLB `nlbId` is resolved at runtime from the NLB route list and the variant
  destination.
- `_rtlist` keeps the legacy direction keys the live APIs ask for: `I`/`O` for
  CTB/NLB/LRT feeder, `I1`/`O1` for KMB, plus `I2`/`O2`... for extra patterns.
- `_stoplist` keeps the legacy `data`, `rt` (`CTB_10` style) and `alt` fields and
  is available under both operator stop ids and TD codes.

### 1.4 Validation

A local static server was used to exercise the real data end to end:

- `index.html` — renders, 6 eta6 files + NLB route list return 200, no console error.
- `route2.html` — list renders; typing `10` shows CTB route 10 variants.
- `route3.html?CTB_10_I2` — 36 stops, $4.8 fare, variant bar and tabs.
- `route3.html?KMB_108_I1` — 32 stops, $12.4 fare, live KMB ETAs.
- `route3.html?NLB_11A_I1` — 37 stops, NLB icon and fare.
- `route3.html?LRTFeeder_506_I1` — feeder stops, MTR stop ids, live ETAs.
- `route3.html?KMB_101X_I1` — joint KMB+CTB route, combined icon and fares.
- `bystop.html` and `v13/bystop.html?stops=001080` — stop name plus routes
  5B/5X/10 with live ETAs.
- `v13/route2.html` and `v13/route3.html?CTB+10+I` — legacy pages render from
  `_rtlist` / `_stoplist`.

## 2. Future improvements

- Publish a complete TD-code ↔ operator-stop-id mapping from the eta6 build so
  the 80 m nearby fallback can be removed.
- Pre-compute the hkbus `routeFareList` and eta2 `_rtlist` shapes in the eta6
  build and serve smaller per-page slices; the current page load is about 12 MB
  across six JSON files.
- Use a CTB route-level ETA endpoint instead of one request per stop.
- Map KMB `service_type` explicitly instead of reusing the variant ordinal.
- Apply `services.exceptions` and Hong Kong public holidays to the frequency
  masks; currently the weekday mask is exact but holiday swaps are not.
- Replace the legacy `CHG` overlay with an eta6-native change-bus dataset.
- Improve NLB/LRT feeder coverage and verify every mapped stop against the live
  ETA APIs.

## 3. Problems when switching from the original eta

- **No operator stop ids in eta6.** The live ETA APIs need KMB/CTB/NLB/MTR stop
  ids, while eta6 publishes TD codes. `operator_map.json` leaves roughly 4% of
  CTB/KMB stop instances unmatched (about 17% for NLB), so some stops fall back
  to an 80 m neighbour or to the TD code. At those stops the live ETA can be
  missing.
- **Route keys change.** route3 URLs and bookmarks now contain eta6 variant ids
  (`CTB_10_I2`) instead of hkbus keys. New bookmarks work; old hkbus links and
  old saved bookmarks that embed hkbus stop ids still work only while the
  operator id exists in `operator_map.json`.
- **`CHG.json` is not part of eta6.** The change-bus overlay is still fetched
  from the old eta2 repository, only when the `CHG` parameter is present, to
  preserve the original feature.
- **Fares are simplified.** eta6 has one adult fare table per variant; the
  original hkbus data could carry more fare categories. Joint routes display a
  single fare, taken from the eta6 variant.
- **Service patterns are approximated.** Public-holiday exceptions are not
  folded into the weekday masks, and there are no per-trip stop times, so the
  "next departure" indicators are frequency-based exactly as before.
- **Circular routes.** eta6 publishes one leg plus a `circular` flag, while the
  legacy UI expects `OI`/`IO` bounds. The adapter marks CTB-led circular routes
  as `OI`; some KMB circular routes therefore keep their normal direction and
  may show a shorter ETA list at the duplicated stops.
- **Larger initial payload.** Six JSON files (~12 MB uncompressed) are parsed on
  every page instead of a single minified hkbus file. Caching mitigates this
  after the first visit, but the first load is heavier.
