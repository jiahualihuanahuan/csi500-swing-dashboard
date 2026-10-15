#!/usr/bin/env python3
"""CSI 500 daily bars.

ETFs come from Yahoo Finance (one request, years of history).
The CSI 500 index (000905.SS) is listed on Yahoo but only offers 1d/5d,
so the index uses Sina's daily kline, also one request back to 2005.
两只 ETF 走 Yahoo；中证500指数 Yahoo 不给长历史，改走新浪一次性日线。
"""
import json, os, time, urllib.request, datetime as dt
import pandas as pd
import psycopg2
import yfinance as yf
from psycopg2.extras import execute_values

DB = os.environ["DATABASE_URL"]
INTERVAL = int(os.environ.get("FETCH_INTERVAL_SEC", "60"))
# name -> (yahoo ticker or None, sina symbol)
SOURCES = {
    "csi500_index": (None, "sh000905"),
    "etf_510500": ("510500.SS", "sh510500"),
    "etf_159922": ("159922.SZ", "sz159922"),
}

DDL = """
CREATE TABLE IF NOT EXISTS bars (
    symbol TEXT NOT NULL,
    trade_date DATE NOT NULL,
    open DOUBLE PRECISION,
    high DOUBLE PRECISION,
    low DOUBLE PRECISION,
    close DOUBLE PRECISION,
    volume DOUBLE PRECISION,
    PRIMARY KEY (symbol, trade_date)
);
"""

def conn():
    return psycopg2.connect(DB)

def init():
    c = conn()
    try:
        with c.cursor() as cur:
            cur.execute(DDL)
        c.commit()
    finally:
        c.close()

def upsert(symbol, df):
    if df is None or df.empty:
        return 0
    rows = [
        (symbol, r.date, r.open, r.high, r.low, r.close, r.volume)
        for r in df.itertuples(index=False)
    ]
    c = conn()
    try:
        with c.cursor() as cur:
            execute_values(
                cur,
                "INSERT INTO bars VALUES %s ON CONFLICT (symbol, trade_date) DO UPDATE SET open=EXCLUDED.open, high=EXCLUDED.high, low=EXCLUDED.low, close=EXCLUDED.close, volume=EXCLUDED.volume",
                rows,
            )
        c.commit()
    finally:
        c.close()
    return len(rows)

def _ohlcv(df):
    df = df.copy()
    df["date"] = pd.to_datetime(df["date"]).dt.date
    for col in ("open", "high", "low", "close", "volume"):
        df[col] = pd.to_numeric(df[col], errors="coerce")
    # The newest Yahoo bar is often an unfinished session with a null close.
    # Keeping it makes RSI NaN and the signals endpoint returns HTTP 500.
    return df[["date", "open", "high", "low", "close", "volume"]].dropna(subset=["open", "high", "low", "close"])

def fetch_yahoo(ticker, start):
    df = yf.download(ticker, start=start, auto_adjust=True, progress=False, threads=False)
    if df is None or df.empty:
        raise RuntimeError(f"yfinance empty {ticker}")
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)
    df = df.reset_index().rename(columns=str.lower)
    return _ohlcv(df)

def fetch_sina(symbol, datalen):
    url = (
        "https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/"
        f"CN_MarketData.getKLineData?symbol={symbol}&scale=240&ma=no&datalen={datalen}"
    )
    req = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0",
        "Referer": "https://finance.sina.com.cn",
    })
    with urllib.request.urlopen(req, timeout=30) as r:
        data = json.loads(r.read().decode())
    if not data:
        raise RuntimeError(f"sina empty {symbol}")
    df = pd.DataFrame(data).rename(columns={"day": "date"})
    return _ohlcv(df)

def fetch(name, full):
    yahoo, sina = SOURCES[name]
    start = "2015-01-01" if full else (dt.date.today() - dt.timedelta(days=45)).isoformat()
    datalen = 8000 if full else 80
    if yahoo:
        try:
            return fetch_yahoo(yahoo, start), "yfinance"
        except Exception as e:
            print(f"{name} yfinance failed, sina fallback: {e}", flush=True)
    return fetch_sina(sina, datalen), "sina"

def main():
    init()
    loaded = set()
    while True:
        for name in SOURCES:
            try:
                df, src = fetch(name, full=name not in loaded)
                n = upsert(name, df)
                loaded.add(name)
                print(f"{dt.datetime.now():%H:%M:%S} {name}: {n} rows via {src}", flush=True)
            except Exception as e:
                print(f"{name} error: {e}", flush=True)
            time.sleep(1)
        time.sleep(INTERVAL)

if __name__ == "__main__":
    main()
