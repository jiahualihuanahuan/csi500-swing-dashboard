#!/usr/bin/env python3
"""Fetch CSI 500 index + 510500/159922 ETF daily bars via akshare, 1 req/s."""
import os, time, datetime as dt
import akshare as ak
import pandas as pd
import psycopg2
from psycopg2.extras import execute_values

DB = os.environ["DATABASE_URL"]
INTERVAL = int(os.environ.get("FETCH_INTERVAL_SEC", "60"))
SYMBOLS = {
    "sh000905": "csi500_index",   # CSI 500 index
    "sh510500": "etf_510500",    # Southern CSI 500 ETF
    "sz159922": "etf_159922",    # Jiashi CSI 500 ETF
}

DDL = """
CREATE TABLE IF NOT EXISTS bars (
    symbol TEXT NOT NULL,
    trade_date DATE NOT NULL,
    open DOUBLE PRECISION, high DOUBLE PRECISION,
    low DOUBLE PRECISION, close DOUBLE PRECISION,
    volume DOUBLE PRECISION,
    PRIMARY KEY (symbol, trade_date)
);
"""

def conn():
    return psycopg2.connect(DB)

def init():
    with conn() as c:
        c.execute(DDL)
        c.commit()

def upsert(symbol, df):
    if df is None or df.empty:
        return 0
    rows = [(symbol, r.date, r.open, r.high, r.low, r.close, r.volume) for r in df.itertuples()]
    with conn() as c:
        execute_values(c.cursor(),
            "INSERT INTO bars VALUES %s ON CONFLICT (symbol, trade_date) DO UPDATE SET open=EXCLUDED.open, high=EXCLUDED.high, low=EXCLUDED.low, close=EXCLUDED.close, volume=EXCLUDED.volume",
            rows)
        c.commit()
    return len(rows)

def fetch_index(code):
    df = ak.index_zh_a_hist(symbol=code, period="daily", start_date="20150101", end_date=dt.date.today().strftime("%Y%m%d"))
    df = df.rename(columns={"日期":"date","开盘":"open","最高":"high","最低":"low","收盘":"close","成交量":"volume"})
    df["date"] = pd.to_datetime(df["date"]).dt.date
    return df[["date","open","high","low","close","volume"]]

def fetch_etf(code):
    df = ak.fund_etf_hist_em(symbol=code, period="daily", start_date="20150101", end_date=dt.date.today().strftime("%Y%m%d"), adjust="qfq")
    df = df.rename(columns={"日期":"date","开盘":"open","最高":"high","最低":"low","收盘":"close","成交量":"volume"})
    df["date"] = pd.to_datetime(df["date"]).dt.date
    return df[["date","open","high","low","close","volume"]]

def main():
    init()
    while True:
        for code, name in SYMBOLS.items():
            try:
                df = fetch_index(code) if name.endswith("index") else fetch_etf(code)
                n = upsert(name, df)
                print(f"{dt.datetime.now():%H:%M:%S} {name}: {n} rows", flush=True)
            except Exception as e:
                print(f"{name} error: {e}", flush=True)
            time.sleep(1)  # akshare polite limit
        time.sleep(INTERVAL)

if __name__ == "__main__":
    main()
