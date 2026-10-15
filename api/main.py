from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
import os, pandas as pd, numpy as np
import psycopg2

app = FastAPI(title="CSI500 API")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
DB = os.environ["DATABASE_URL"]

def q(sql, params=None):
    with psycopg2.connect(DB) as c:
        return pd.read_sql(sql, c, params=params)

@app.get("/health")
def health():
    return {"ok": True}

@app.get("/api/bars/{symbol}")
def bars(symbol: str, start: str | None = None, end: str | None = None):
    sql = "SELECT trade_date AS date, open, high, low, close, volume FROM bars WHERE symbol=%s"
    p = [symbol]
    if start:
        sql += " AND trade_date>=%s"; p.append(start)
    if end:
        sql += " AND trade_date<=%s"; p.append(end)
    sql += " ORDER BY trade_date"
    df = q(sql, p)
    df["date"] = df["date"].astype(str)
    return df.to_dict(orient="records")

# ---------- indicators ----------
def rsi(s, n=14):
    d = s.diff(); up = d.clip(lower=0).rolling(n).mean(); down = (-d.clip(upper=0)).rolling(n).mean()
    return 100 - 100 / (1 + up / down.replace(0, np.nan))

def kdj(df, n=9):
    ll = df["low"].rolling(n).min(); hh = df["high"].rolling(n).max()
    rsv = (df["close"] - ll) / (hh - ll).replace(0, np.nan) * 100
    k = rsv.ewm(alpha=1/3).mean(); d = k.ewm(alpha=1/3).mean()
    return k, d, 3 * k - 2 * d

def macd(s, fast=12, slow=26, sig=9):
    ef, es = s.ewm(span=fast).mean(), s.ewm(span=slow).mean()
    line = ef - es; signal = line.ewm(span=sig).mean()
    return line, signal, line - signal

def bollinger(s, n=20, k=2):
    mid = s.rolling(n).mean(); std = s.rolling(n).std()
    return mid - k * std, mid, mid + k * std

def add_indicators(df):
    df = df.copy()
    df["rsi"] = rsi(df["close"])
    df["k"], df["d"], df["j"] = kdj(df)
    df["macd"], df["signal"], df["hist"] = macd(df["close"])
    df["bb_low"], df["bb_mid"], df["bb_up"] = bollinger(df["close"])
    df["ma50"] = df["close"].rolling(50).mean()
    return df

# ---------- signals / position state machine ----------
TIERS = [("full", 1.0), ("half", 0.5), ("light", 0.25), ("flat", 0.0)]

def simulate(df, rsi_buy=30, rsi_buy2=20, rsi_sell=70, macd_exit=True, trend_filter=True):
    df = add_indicators(df)
    pos = 0.0; entry = None; trades = []
    for r in df.itertuples():
        if trend_filter and pd.notna(r.ma50) and r.close < r.ma50:
            if pos > 0:
                trades.append((r.date, entry, r.close, pos, "trend-exit")); pos = 0.0; entry = None
            continue
        if pos == 0 and r.rsi < rsi_buy:
            pos = 0.5; entry = r.close
        elif pos == 0.5 and r.rsi < rsi_buy2:
            pos = 0.7; entry = (entry + r.close) / 2
        elif pos > 0 and (r.rsi > rsi_sell or (macd_exit and r.hist < 0 and getattr(r, "hist_prev", 0) >= 0)):
            trades.append((r.date, entry, r.close, pos, "signal-exit")); pos = 0.0; entry = None
    if pos > 0:
        trades.append((df.iloc[-1].date, entry, df.iloc[-1].close, pos, "open"))
    return trades

@app.get("/api/signals/{symbol}")
def signals(symbol: str):
    df = q("SELECT trade_date AS date, open, high, low, close, volume FROM bars WHERE symbol=%s ORDER BY trade_date", [symbol])
    if df.empty:
        return {"error": "no data"}
    df = add_indicators(df)
    last = df.iloc[-1]
    return {
        "date": str(last.date), "close": round(last.close, 3),
        "rsi": round(last.rsi, 1), "k": round(last.k, 1), "d": round(last.d, 1), "j": round(last.j, 1),
        "macd_hist": round(last.hist, 4), "ma50": round(last.ma50, 3) if pd.notna(last.ma50) else None,
        "bb_low": round(last.bb_low, 3), "position_tier": "half" if last.rsi < 30 else ("light" if last.rsi < 40 else "flat"),
    }

@app.get("/api/orders/suggest")
def order_suggest(symbol: str = "etf_510500", target_rsi: float = 30.0):
    """Given today's close and RSI, estimate the price where RSI hits target_rsi (simple linear approx on last bar's move)."""
    df = q("SELECT trade_date AS date, open, high, low, close FROM bars WHERE symbol=%s ORDER BY trade_date DESC LIMIT 20", [symbol])
    if len(df) < 3:
        return {"error": "not enough data"}
    df = df.iloc[::-1].reset_index(drop=True)
    df = add_indicators(df)
    last = df.iloc[-1]
    prev = df.iloc[-2]
    # approximate: RSI change per 1% price move over last 2 bars
    rsi_now = last.rsi
    if pd.isna(rsi_now):
        return {"error": "rsi not ready"}
    pct_move = (last.close - prev.close) / prev.close
    rsi_move = last.rsi - prev.rsi if pd.notna(prev.rsi) else 0
    sens = rsi_move / pct_move if pct_move != 0 else -50  # RSI points per 1% price move (negative)
    need = target_rsi - rsi_now
    pct_needed = need / sens if sens != 0 else 0
    limit_price = last.close * (1 + pct_needed)
    return {
        "symbol": symbol, "today_close": round(last.close, 3), "today_rsi": round(rsi_now, 1),
        "target_rsi": target_rsi,
        "suggested_limit_price": round(max(limit_price, 0.01), 3),
        "pct_from_close": round(pct_needed * 100, 2),
        "note": "Rough linear approximation; re-check at open. Not financial advice.",
    }

# ---------- backtest grid ----------
@app.get("/api/backtest")
def backtest(symbol: str = "etf_510500", start: str = "2022-01-01", end: str = "2026-10-15"):
    df = q("SELECT trade_date AS date, open, high, low, close, volume FROM bars WHERE symbol=%s AND trade_date BETWEEN %s AND %s ORDER BY trade_date", [symbol, start, end])
    if len(df) < 100:
        return {"error": f"only {len(df)} bars"}
    grid = []
    for rsi_buy in (25, 30, 35):
        for rsi_buy2 in (15, 20):
            for rsi_sell in (65, 70, 75):
                for macd_exit in (True, False):
                    for trend_filter in (True, False):
                        trades = simulate(df, rsi_buy, rsi_buy2, rsi_sell, macd_exit, trend_filter)
                        closed = [t for t in trades if t[4] != "open"]
                        if len(closed) < 5:
                            continue
                        wins = sum(1 for t in closed if t[2] > t[1])
                        rets = [(t[2] / t[1] - 1) * t[3] for t in closed]
                        grid.append({
                            "rsi_buy": rsi_buy, "rsi_buy2": rsi_buy2, "rsi_sell": rsi_sell,
                            "macd_exit": macd_exit, "trend_filter": trend_filter,
                            "trades": len(closed), "win_rate": round(wins / len(closed) * 100, 1),
                            "avg_return_pct": round(float(np.mean(rets)) * 100, 2),
                            "total_return_pct": round((float(np.prod([1 + r for r in rets])) - 1) * 100, 1),
                        })
    grid.sort(key=lambda x: (-x["win_rate"], -x["total_return_pct"]))
    return {"symbol": symbol, "period": f"{start} to {end}", "n_bars": len(df), "results": grid[:15]}
