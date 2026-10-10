# EquiLens architecture

```
Browser (desktop) ─▶ EquiLens Nexus  (Node, 127.0.0.1:4330) ─▶ data sources (TWSE/TPEx, FinMind, Fugle, Twelve Data, Alpha Vantage)
                         │  .local/ (config, groups, prices, records)          ─▶ AI service (Claude, OpenAI, Gemini, OpenAI-compatible)
Phone (PWA) ─▶ Cloudflare Tunnel ─▶ EquiLens Pocket (127.0.0.1:4340) ─▶ Nexus API (Pocket never touches data files)
```

Nexus is the only process that fetches or writes market data. Pocket is a thin, password-protected proxy with its own
mobile UI and Web Push relay. There is no database and no build step: plain ES modules on Node 22+ and in the browser.

## Nexus (`EquiLens-Nexus/`)

| Module | Role |
|---|---|
| `server.mjs` | HTTP server, API routes, schedulers (intraday monitor, close records, news push, AI report, daily update), market switching |
| `lib/config.mjs` | `.local/config.json`: market, language, enabled data sources and preferences, AI model, public URL, up/down colors. Legacy single-market installs are migrated automatically |
| `lib/markets.mjs` | Market profiles: time zone, sessions (with lunch breaks), settle minutes, lot size, tick tables, price limits, symbol format, replay scales. All time / price rules come from here |
| `lib/secrets.mjs` | API keys via Windows DPAPI, macOS Keychain or Secret Service (file fallback); environment variables take priority |
| `lib/i18n.mjs` | Server-side translation with the same dictionaries as the UI; `UserError` marks messages safe to show |
| `lib/providers/` | Data sources and the capability router (see below) |
| `lib/research.mjs` | Per-stock research updates through the router (resumable, keeps old data on empty responses); bulk institutional data for sources that only offer whole-market days |
| `lib/engine.mjs` | Four-factor scoring; factors the current sources can't provide are excluded and weights renormalized |
| `lib/heatmap.mjs` | Sector heatmap from whole-market daily data, live snapshots or local research data |
| `lib/radar.mjs`, `lib/replay.mjs` | Intraday alerts and the per-minute time-machine recorder |
| `lib/patterns.mjs`, `lib/pattern-service.mjs` | Pattern detection and the whole-market pattern snapshot |
| `lib/grouprank.mjs` | Research-group ranking (turnover-weighted gain) |
| `lib/llm.mjs`, `lib/report.mjs` | AI providers (structured JSON output) and the after-market report |
| `lib/flows.mjs`, `lib/market-card.mjs`, `lib/insight.mjs` | Taiwan-specific modules built on FinMind datasets (institutional/options overview, report card, brokers, shareholding) |
| `lib/briefing.mjs`, `lib/newswatch.mjs` | Today's Brief (news, economic and earnings calendars) and news push |
| `lib/scope.mjs`, `lib/watchgroups.mjs`, `lib/access.mjs` | Research groups, watchlist groups, Cloudflare Access JWT verification |

Front end (`public/`): `app.js` (shell and pages), `setup.js` (setup wizard and system settings), `market.js`
(client-side market clock, colors and units), `i18n.js` (translation), plus page modules. `i18n.js`, `market.js`,
`insight-ui.js`, `report-card.js`, `flow-cards.js` and `save-image.js` are shared with Pocket as identical copies;
a test fails if they drift apart.

### Data source router

Every provider module (`lib/providers/*.mjs`) exports an object:

```js
{
  id, name, site, docs,
  markets: ['TW', ...],              // markets it covers
  key: 'required' | 'none', keyEnv,  // key requirement and environment-variable override
  interval,                          // minimum milliseconds between requests
  caps: { daily: 1, snapshot: 'paid', universe: ['US'], institutional: 'bulk', ... },
  snapshotMode: 'market' | 'symbols',// whole-market snapshot or per-symbol quotes
  async validate(key) { return { plan, tier: 'free' | 'paid' | 'sponsor', ... } },
  daily(id, from, to, ctx), snapshot(ids, ctx), ...   // one function per capability
}
```

Capability values: `1` available, `'paid'` / `'sponsor'` only when the verified tier allows it, an array limits it to
some markets, `'bulk'` (institutional) means research updates use whole-market days. `providers/index.mjs` picks a
provider per capability (preferred source first, then the enabled order), injects the key, interval and market into
`ctx`, and exposes `data.<capability>()` to the rest of the app. `capabilityMap()` tells the UI which features exist.

Capabilities: `universe, calendar, daily, adjusted, dailyAll, snapshot, intraday, news, marketNews, valuation, revenue,
institutional, institutionalAll, brokers, holders, flows, futures, margin`.

All providers return the internal row format (FinMind field names, so scoring and patterns work unchanged):

| Data | Row |
|---|---|
| Daily bar | `{ date, stock_id, open, max, min, close, Trading_Volume (shares), Trading_money, spread }` |
| Live snapshot | `{ stock_id, date 'YYYY-MM-DD HH:MM:SS' (market time), open, high, low, close, change_price, total_volume (display units), total_amount, yesterday_volume, buy_price, sell_price }` |
| Minute bar | `[HH:MM (start), open, high, low, close, volume (display units)]` |
| News | `{ date, stock_id, title, link, source }` |
| Valuation / revenue | `{ date, PER, PBR, dividend_yield }` / `{ date, revenue_year, revenue_month or revenue_quarter, revenue }` |

Errors are `DataError` with `code` `auth`, `quota` or `plan`, which the schedulers use to pause automatic requests.

### Storage

`EquiLens-Nexus/.local/` (or `EQUITY_DATA_DIR`): `config.json`, `settings.json`, `groups.json`, `watchlist.json`,
`universe.json`, `stocks/<symbol>.json`, `heatmap-*.json`, `replay/`, `alerts-*.json`, `reports/`, key files
(`*.dpapi` etc.). When the market is switched, the market-specific files move to `.local/markets/<MARKET>/` and the
target market's files move back.

## Pocket (`EquiLens-Pocket/`)

`server.mjs` serves the PWA and proxies `/m/api/*` to Nexus after password login (`lib/auth.mjs`). It relays new radar,
news and report events as Web Push notifications (`lib/push.mjs`, RFC 8291/8292 with Node's crypto). The interface
language, market profile and colors come from Nexus `/api/profile`; translations are served from Nexus `/locales/`.

## Extending

**Add a data source** – create `lib/providers/<id>.mjs` following the shape above, register it in `PROVIDERS` in
`lib/providers/index.mjs`, add a description in `public/setup.js` (`PROVIDER_NOTES`), add tests with mocked responses,
and translate any new strings.

**Add a market** – add an entry to `MARKETS` in `lib/markets.mjs` (time zone, sessions, lot, ticks, limits, symbol
regex, replay scales, liquidity threshold), map it in the providers that cover it (e.g. Twelve Data `VENUE`), and
optionally add `data/templates/<MARKET>.json` sample groups.

**Add an AI service** – add it to `LLM_INFO`, `generateJSON` and `listModels` in `lib/llm.mjs`, and to
`LLM_PROVIDERS` in `lib/config.mjs`.

**Add a language** – add `public/locales/<lang>.json` (keys are the Traditional Chinese source strings, `{name}` /
`{0}` placeholders must match), add the code to `LANGUAGES` in `lib/config.mjs` and the language pickers in
`public/setup.js`, then run `node tools/i18n-keys.mjs --missing <lang>` until it reports 0. The UI translates text
nodes and `placeholder` / `title` / `aria-label` automatically; mark user data with `translate="no"`.

## Tests

`npm test` in each component. Nexus tests cover scoring, patterns, heatmap, radar, replay, providers' row handling,
market rules, the setup and market-switch APIs (on a temporary data folder and port), secrets and translations.
