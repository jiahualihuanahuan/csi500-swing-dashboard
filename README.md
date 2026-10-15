# CSI 500 Swing Dashboard

Swing-trading dashboard for CSI 500 index and ETFs (510500 / 159922).

## Stack

- **Data fetch**: Python + akshare (index + ETF daily bars, rate-limited to 1 req/s)
- **Storage**: PostgreSQL (fast SQL, indexed on symbol/date)
- **API**: FastAPI (signals, positions, backtest, limit-order suggestions)
- **Frontend**: Next.js + lightweight-charts (K-line + RSI/KDJ/MACD)
- **Backtest**: grid search over RSI/KDJ/Bollinger trigger combos, win-rate table
- **Deploy**: Docker Compose (optional Ollama news-digest sidecar, off by default)

## Quick start

```bash
docker compose up -d
```

- Dashboard: http://localhost:3000
- API docs: http://localhost:8000/docs

## Position state machine

Four tiers: full / half / light / flat. Entries step in on RSI < 30 (half), RSI < 20 (to 70%), exits on RSI > 70 or MACD histogram flip.

## Backtest

`GET /api/backtest?symbol=510500&start=2022-01-01&end=2026-10-15`
returns a comparison table of trigger parameter sets sorted by win rate.

## Limit-order helper

`GET /api/orders/suggest?symbol=510500` computes the price at which RSI would hit the next buy trigger given today's close, so you can place a limit order directly.

## News digest (optional)

Set `OLLAMA_URL` in `.env` to enable. Sidecar summarizes CN market headlines daily for the 9B Qwen model on your server. Not required.
