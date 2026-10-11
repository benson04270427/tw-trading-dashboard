# EquiLens (衡析)

**A self-hosted stock research desk.** EquiLens runs on your own computer: it ranks the companies you choose to
research, shows where money is flowing, watches the market during the session, recognizes chart patterns and
writes an after-market report with the AI model of your choice. You bring your own data sources and API keys;
nothing is sent to anyone else.

[繁體中文說明](README.zh-TW.md) · [Architecture](docs/ARCHITECTURE.md)

> EquiLens is a research tool. Scores rank research, they are not trading signals, price targets or return
> predictions. Nothing here is investment advice.

---

## What's inside

| Component | What it is | Default address |
|---|---|---|
| **EquiLens Nexus** (`EquiLens-Nexus/`) | The desktop app and the only data engine: research scores, sector heatmap, intraday radar, pattern scanner, AI report, settings | http://127.0.0.1:4330 |
| **EquiLens Pocket** (`EquiLens-Pocket/`) | Optional mobile web app (PWA) that reads from Nexus, protected by a password, reachable from your phone through a Cloudflare Tunnel; supports push notifications | http://127.0.0.1:4340 |

Both servers bind to `127.0.0.1` only. Your settings, research groups and cached market data live in each
component's `.local/` folder; API keys are encrypted by the operating system (see [Security](#security)).

### Features

- **Research overview** – a four-factor score (technical, institutional flows, topic evidence, industry trend) for every
  stock in *your* research groups, with transparent reasons, missing-data handling and an effective-weight disclosure.
- **Sector heatmap** – turnover-sized, change-colored treemap of the whole market (or of your research groups when the
  data source has no whole-market data), live during the session, with a per-minute **time machine** replay.
- **Intraday radar** – volume spikes, surges and plunges, price-limit touches, pattern entries and stop breaks for your
  watchlist and research groups, plus a live board with daily / 5-minute candles.
- **Group ranking** – your research groups ranked by turnover-weighted gain, with daily close records.
- **Pattern scanner** – 10 classic patterns over 90 sessions with conditional entry and stop levels.
- **AI after-market report** – written by Claude, OpenAI, Gemini or any OpenAI-compatible endpoint (including local
  models), with a downloadable 9:16 summary card.
- **Market-specific modules** – for Taiwan with FinMind: broker branches, shareholding distribution, institutional
  and futures/options flows.
- **Interface languages** – Traditional Chinese and English.

## Markets and data sources

One EquiLens instance researches one market at a time. Trading hours (including lunch breaks), time zone, tick
sizes, price limits, up/down colors, volume units and symbol formats all come from the market profile. When you
switch markets, each market's groups, watchlist and records are stored separately and restored when you switch back.

Supported markets: **Taiwan, United States, Japan, Hong Kong, South Korea, United Kingdom, Germany, France, Canada,
Australia, Singapore, India.**

| Data source | Markets | Key | Provides |
|---|---|---|---|
| [TWSE / TPEx open data](https://openapi.twse.com.tw) | TW | none | stock list, trading calendar, daily bars, whole-market daily data, institutional flows (whole market by day), P/E, monthly revenue |
| [FinMind](https://finmindtrade.com) | TW | free / Sponsor | daily and adjusted bars, institutional flows, revenue, P/E, news, shareholding, futures, margin; **Sponsor** adds live snapshots, minute bars, whole-market data and broker branches |
| [Fugle](https://developer.fugle.tw) | TW | free / paid | daily (adjusted) and minute bars; paid plans add a whole-market live snapshot |
| [Twelve Data](https://twelvedata.com) | all 12 markets | free / paid | stock list, daily bars, live quotes, minute bars |
| [Alpha Vantage](https://www.alphavantage.co) | US, GB, CA, DE, IN | free / premium | daily bars, quotes, news sentiment, P/E, quarterly revenue |

Enable several sources and EquiLens picks a source per capability (in your order, or as you specify under
*Data & Settings → Data sources → Advanced*). Features a source can't support are hidden or fall back to your
research list's local data — the settings page shows exactly which features are available.

Free plans have tight quotas. EquiLens rate-limits every source, resumes interrupted updates and never assumes a higher
plan than the one detected when you saved the key.

## Requirements

- **Node.js 22 or newer** – https://nodejs.org
- Windows 10/11, macOS or Linux
- At least one data source that covers your market (TWSE/TPEx open data works for Taiwan without any key)
- Optional: an API key for an AI model; `cloudflared` for phone access

## Quick start

```bash
git clone https://github.com/wakin61043/equilens_nexus.git
cd equilens_nexus/EquiLens-Nexus
npm install --omit=dev
```

Start Nexus:

| Windows | macOS / Linux |
|---|---|
| double-click `EquiLens-Nexus\啟動衡析Nexus.cmd` (or `Start-Nexus.ps1`) | `./start.sh` |
| stop: `Stop-Nexus.ps1` | stop: `./stop.sh` |

Open http://127.0.0.1:4330. The first launch shows a **setup wizard**:

1. Interface language and the market to research
2. Data sources – tick the ones you want and paste their keys (each key is verified before it is saved)
3. AI model – service, key and model (optional; everything else works without it)
4. Research groups – create groups, load sample groups for your market, or import a settings file

Then press **Update** to download history for your research groups. Updates can be stopped and resumed.
Everything can be changed later under **Data & Settings**.

On Windows you can also double-click **安裝衡析.cmd** in the repository root: it checks Node.js, installs packages,
starts Nexus and opens the setup wizard (it also restores a `migration-data` folder exported from another computer).

### Phone access (optional)

```bash
cd EquiLens-Pocket
node scripts/set-password.mjs     # at least 10 characters
./start.sh                        # Windows: 啟動衡析手機版.cmd
```

`start.sh` starts Nexus if needed, starts Pocket and opens a temporary `https://….trycloudflare.com` address with
`cloudflared`. For a fixed address use a Cloudflare *named tunnel* (see `EquiLens-Pocket/README.md`) and set the
address under *Data & Settings → Market & language → Mobile public URL* so push notifications have a valid contact.
Add Pocket to your home screen to receive push notifications (iPhone: iOS 16.4+).

## Configuration

| Where | What |
|---|---|
| *Data & Settings* page | market, language, up/down colors, data sources and keys, AI model, research groups, update schedule, score weights, radar and news push |
| `EquiLens-Nexus/.local/` | all Nexus data (`config.json`, groups, watchlist, cached prices, records) – never commit it |
| `EquiLens-Pocket/.local/` | password hash, sessions, push subscriptions, tunnel settings – never commit it |
| Settings file | *Data & Settings → Settings file* exports groups, watchlist and settings **without keys** for another computer |

Environment variables (optional): `PORT`, `EQUITY_DATA_DIR` (Nexus data folder), `MOBILE_DATA_DIR`, `NEXUS_URL`
(Pocket), and key overrides `FINMIND_API_TOKEN`, `FUGLE_API_KEY`, `TWELVEDATA_API_KEY`, `ALPHAVANTAGE_API_KEY`,
`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `LLM_API_KEY`.

## Security

- Servers listen on `127.0.0.1` only; write APIs require a CSRF token and same-origin requests.
- API keys are stored with the operating system's protection: **Windows DPAPI**, **macOS Keychain**, or
  **Secret Service** on Linux (a file readable only by you as a fallback). The web pages never read keys back.
- Pocket uses a scrypt password hash, login rate limiting, HttpOnly/SameSite cookies, a host allow-list and a strict CSP.
- Optional remote access to the full desktop app goes through Cloudflare Access, and Nexus verifies every request's
  Access JWT itself (see `EquiLens-Nexus/README.md`).
- Your data stays on your computer. The only outbound requests go to the data sources and AI service you configure,
  plus public news and calendar feeds used by *Today's Brief*.

## Development

```bash
cd EquiLens-Nexus && npm test        # library, server and framework tests
cd EquiLens-Pocket && npm test
node EquiLens-Nexus/tools/i18n-keys.mjs --missing en   # interface strings without an English translation
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how markets, data sources, AI providers and languages plug in.

## Disclaimer

Market data belongs to its providers; respect each provider's terms and plan limits. EquiLens is provided as is,
without warranty, and is not investment advice.
