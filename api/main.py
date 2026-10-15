"""CSI500 API — 中证500波段交易后端 / Backend for CSI 500 swing dashboard."""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import os, datetime as dt
import pandas as pd
import numpy as np
import psycopg2

app = FastAPI(title="CSI500 API 中证500 API", description="中证500指数与ETF波段交易信号、仓位、回测接口")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
DB = os.environ["DATABASE_URL"]

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

@app.on_event("startup")
def init_db():
    c = psycopg2.connect(DB)
    try:
        with c.cursor() as cur:
            cur.execute(DDL)
        c.commit()
    finally:
        c.close()

def q(sql, params=None):
    with psycopg2.connect(DB) as c:
        return pd.read_sql(sql, c, params=params)

def sanitize(df):
    """Drop unfinished bars. A null close becomes NaN RSI and breaks JSON."""
    if df is None or df.empty:
        return df
    df = df.copy()
    for col in ("open", "high", "low", "close", "volume"):
        if col in df:
            df[col] = pd.to_numeric(df[col], errors="coerce")
    return df.dropna(subset=["open", "high", "low", "close"]).reset_index(drop=True)

def num(x, nd=3):
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    if not np.isfinite(v):
        return None
    return round(v, nd)

@app.get("/health")
def health():
    return {"ok": True, "status": "正常 healthy"}

@app.get("/api/bars/{symbol}", summary="K线数据 / OHLCV bars")
def bars(symbol: str, start: str | None = None, end: str | None = None):
    sql = "SELECT trade_date AS date, open, high, low, close, volume FROM bars WHERE symbol=%s"
    p = [symbol]
    if start:
        sql += " AND trade_date>=%s"; p.append(start)
    if end:
        sql += " AND trade_date<=%s"; p.append(end)
    sql += " ORDER BY trade_date"
    df = sanitize(q(sql, p))
    df["date"] = df["date"].astype(str)
    return df.to_dict(orient="records")

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
    for n in (5, 10, 20, 50, 200):
        df[f"ma{n}"] = df["close"].rolling(n).mean()
    std20 = df["close"].rolling(20).std()
    df["zscore"] = (df["close"] - df["ma20"]) / std20.replace(0, np.nan)
    return df

CHART_FIELDS = (
    "open", "high", "low", "close", "volume",
    "ma5", "ma10", "ma20", "ma50", "ma200", "bb_up", "bb_low",
    "rsi", "k", "d", "j", "macd", "signal", "hist", "zscore",
)

@app.get("/api/chart/{symbol}", summary="日线加指标 / Daily bars with indicators")
def chart(symbol: str):
    """全历史计算后返回。前端再按 6个月/年截取，避免窗口左边指标是空的。"""
    df = sanitize(q(
        "SELECT trade_date AS date, open, high, low, close, volume FROM bars WHERE symbol=%s ORDER BY trade_date",
        [symbol],
    ))
    if df.empty:
        return {"error": "no data 无数据"}
    df = add_indicators(df)
    df["date"] = pd.to_datetime(df["date"]).dt.strftime("%Y-%m-%d")
    nd = {"volume": 0, "rsi": 1, "k": 1, "d": 1, "j": 1, "macd": 4, "signal": 4, "hist": 4, "zscore": 2}
    out = []
    for rec in df[["date", *CHART_FIELDS]].to_dict(orient="records"):
        for f in CHART_FIELDS:
            rec[f] = num(rec[f], nd.get(f, 3))
        out.append(rec)
    return out

def simulate(df, rsi_buy=30, rsi_buy2=20, rsi_sell=70, macd_exit=True, trend_filter=True):
    df = add_indicators(df)
    df["hist_prev"] = df["hist"].shift(1)
    pos = 0.0; entry = None; trades = []
    for r in df.itertuples():
        if trend_filter and pd.notna(r.ma50) and r.close < r.ma50:
            if pos > 0:
                trades.append((r.date, entry, r.close, pos, "trend-exit 趋势出场")); pos = 0.0; entry = None
            continue
        if not pd.notna(r.rsi):
            continue
        if pos == 0 and r.rsi < rsi_buy:
            pos = 0.5; entry = r.close
        elif pos == 0.5 and r.rsi < rsi_buy2:
            pos = 0.7; entry = (entry + r.close) / 2
        elif pos > 0 and (
            r.rsi > rsi_sell
            or (macd_exit and pd.notna(r.hist) and pd.notna(r.hist_prev) and r.hist < 0 <= r.hist_prev)
        ):
            trades.append((r.date, entry, r.close, pos, "signal-exit 信号出场")); pos = 0.0; entry = None
    if pos > 0:
        trades.append((df.iloc[-1].date, entry, df.iloc[-1].close, pos, "open 未平仓"))
    return trades

def tier_of(trades):
    if trades and str(trades[-1][4]).startswith("open"):
        pos = trades[-1][3]
        return {0.5: "half 半仓", 0.7: "add 补仓"}.get(pos, str(pos))
    return "flat 空仓"

@app.get("/api/signals/{symbol}", summary="最新信号 / Latest signals")
def signals(symbol: str):
    df = sanitize(q("SELECT trade_date AS date, open, high, low, close, volume FROM bars WHERE symbol=%s ORDER BY trade_date", [symbol]))
    if df.empty:
        return {"error": "no data 无数据"}
    df = add_indicators(df)
    last = df.iloc[-1]
    pos = tier_of(simulate(df))
    return {
        "date": str(last.date), "close 收盘价": num(last.close),
        "rsi 相对强弱指数": num(last.rsi, 1), "k": num(last.k, 1), "d": num(last.d, 1), "j": num(last.j, 1),
        "macd_hist MACD柱状图": num(last.hist, 4), "ma50 50日均线": num(last.ma50),
        "bb_low 布林下轨": num(last.bb_low), "position_tier 建议仓位": pos,
    }

@app.get("/api/orders/suggest", summary="限价单建议 / Limit order suggestion")
def order_suggest(symbol: str = "etf_510500", target_rsi: float = 30.0):
    df = sanitize(q("SELECT trade_date AS date, open, high, low, close, volume FROM bars WHERE symbol=%s ORDER BY trade_date DESC LIMIT 20", [symbol]))
    if len(df) < 3:
        return {"error": "not enough data 数据不足"}
    df = df.iloc[::-1].reset_index(drop=True)
    df = add_indicators(df)
    last, prev = df.iloc[-1], df.iloc[-2]
    if pd.isna(last.rsi):
        return {"error": "rsi not ready RSI未就绪"}
    pct_move = (last.close - prev.close) / prev.close
    rsi_move = last.rsi - prev.rsi if pd.notna(prev.rsi) else 0
    sens = rsi_move / pct_move if pct_move != 0 else -50
    pct_needed = (target_rsi - last.rsi) / sens if sens != 0 else 0
    limit_price = last.close * (1 + pct_needed)
    return {
        "symbol": symbol,
        "today_close 今日收盘价": num(last.close),
        "today_rsi 今日RSI": num(last.rsi, 1),
        "target_rsi 目标RSI": target_rsi,
        "suggested_limit_price 建议限价": num(max(limit_price, 0.01)),
        "pct_from_close 距收盘百分比": num(pct_needed * 100, 2),
        "note 说明": "线性近似，仅供参考，开盘时请复查 / Linear approx, for reference only. Not financial advice 非投资建议.",
    }

@app.get("/api/backtest", summary="回测胜率表 / Backtest win-rate table")
def backtest(symbol: str = "etf_510500", start: str = "2022-01-01", end: str | None = None):
    if not end:
        end = dt.date.today().isoformat()
    df = sanitize(q(
        "SELECT trade_date AS date, open, high, low, close, volume FROM bars WHERE symbol=%s AND trade_date BETWEEN %s AND %s ORDER BY trade_date",
        [symbol, start, end],
    ))
    if len(df) < 100:
        return {"error": f"only {len(df)} bars 仅{len(df)}根K线"}
    grid = []
    for rsi_buy in (25, 30, 35):
        for rsi_buy2 in (15, 20):
            for rsi_sell in (65, 70, 75):
                for macd_exit in (True, False):
                    for trend_filter in (True, False):
                        trades = simulate(df, rsi_buy, rsi_buy2, rsi_sell, macd_exit, trend_filter)
                        closed = [t for t in trades if not str(t[4]).startswith("open")]
                        if len(closed) < 5:
                            continue
                        wins = sum(1 for t in closed if t[2] > t[1])
                        rets = [(t[2] / t[1] - 1) * t[3] for t in closed]
                        grid.append({
                            "rsi_buy RSI买入线": rsi_buy, "rsi_buy2 二次补仓线": rsi_buy2, "rsi_sell RSI卖出线": rsi_sell,
                            "macd_exit MACD出场": macd_exit, "trend_filter 趋势过滤": trend_filter,
                            "trades 交易次数": len(closed), "win_rate 胜率%": round(wins / len(closed) * 100, 1),
                            "avg_return_pct 平均收益%": round(float(np.mean(rets)) * 100, 2),
                            "total_return_pct 总收益%": round((float(np.prod([1 + r for r in rets])) - 1) * 100, 1),
                        })
    grid.sort(key=lambda x: (-x["win_rate 胜率%"], -x["total_return_pct 总收益%"]))
    return {"symbol": symbol, "period 区间": f"{start} to {end}", "n_bars K线数": len(df), "results 结果": grid[:15]}
