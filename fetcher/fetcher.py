#!/usr/bin/env python3
"""Fetch CSI 500 index + 510500/159922 ETF daily bars via akshare, 1 req/s.
通过 akshare 抓取中证500指数 + 510500/159922 ETF 日线，限速 1 次/秒。"""
import os, time, datetime as dt
import akshare as ak
import pandas as pd
import psycopg2
from psycopg2.extras import execute_values

DB = os.environ["DATABASE_URL"]
INTERVAL = int(os.environ.get("FETCH_INTERVAL_SEC", "60"))  # 抓取间隔（秒）
SYMBOLS = {
    "sh000905": "csi500_index",   # 中证500指数 CSI 500 index
    "sh510500": "etf_510500",    # 南方中证500ETF Southern CSI 500 ETF
    "sz159922": "etf_159922",    # 嘉实中证500ETF Jiashi CSI 500 ETF
}

DDL = """
CREATE TABLE IF NOT EXISTS bars (
    symbol TEXT NOT NULL,          -- 品种代码
    trade_date DATE NOT NULL,      -- 交易日期
    open DOUBLE PRECISION,         -- 开盘价
    high DOUBLE PRECISION,         -- 最高价
    low DOUBLE PRECISION,          -- 最低价
    close DOUBLE PRECISION,        -- 收盘价
    volume DOUBLE PRECISION,       -- 成交量
    PRIMARY KEY (symbol, trade_date)
);
"""

def conn():
    return psycopg2.connect(DB)

def init():
    """初始化数据库表 / Initialize DB table."""
    with conn() as c:
        c.execute(DDL)
        c.commit()

def upsert(symbol, df):
    """写入或更新K线数据 / Upsert OHLCV bars."""
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
    """抓取A股指数日线 / Fetch A-share index daily bars."""
    df = ak.index_zh_a_hist(symbol=code, period="daily", start_date="20150101", end_date=dt.date.today().strftime("%Y%m%d"))
    df = df.rename(columns={"日期":"date","开盘":"open","最高":"high","最低":"low","收盘":"close","成交量":"volume"})
    df["date"] = pd.to_datetime(df["date"]).dt.date
    return df[["date","open","high","low","close","volume"]]

def fetch_etf(code):
    """抓取ETF日线（前复权）/ Fetch ETF daily bars (forward-adjusted)."""
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
                print(f"{dt.datetime.now():%H:%M:%S} {name}: {n} rows 行", flush=True)
            except Exception as e:
                print(f"{name} error 错误: {e}", flush=True)
            time.sleep(1)  # akshare 礼貌限速 / polite rate limit
        time.sleep(INTERVAL)

if __name__ == "__main__":
    main()
