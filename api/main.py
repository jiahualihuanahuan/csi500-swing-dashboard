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

def _buy_target(rsi):
    """越低买得越多。高于25不加仓，也不因此清仓。"""
    if rsi <= 10:
        return 0.60
    if rsi <= 15:
        return 0.40
    if rsi <= 20:
        return 0.30
    if rsi <= 25:
        return 0.10
    return 0.0

def _keep_ratio(rsi):
    """50以下全留。50到70慢慢减。高于70空仓。"""
    if rsi <= 50:
        return 1.0
    if rsi <= 55:
        return 0.8
    if rsi <= 60:
        return 0.5
    if rsi <= 65:
        return 0.2
    if rsi <= 70:
        return 0.1
    return 0.0

def _pct_label(pos):
    for value, name in ((0.10, "一成（10%）"), (0.30, "三成（30%）"), (0.40, "四成（40%）"), (0.60, "六成（60%）")):
        if abs(pos - value) < 0.015:
            return name
    return f"{round(pos * 100)}%"

def position_now(df):
    """从上一次高于70之后算。跌到过哪一档就拿到哪一档，50以下不减。"""
    base = 0.0
    pos = 0.0
    last_rsi = None
    for raw in df["rsi"]:
        if pd.isna(raw):
            continue
        last_rsi = float(raw)
        add = _buy_target(last_rsi)
        if add > base:
            base = add
        keep = _keep_ratio(last_rsi)
        if keep == 0.0:
            base = 0.0
            pos = 0.0
        elif keep < 1.0:
            pos = base * keep
        else:
            pos = base
    if last_rsi is None:
        return 0.0, "算不出来", "空仓"
    if pos <= 0.005:
        return 0.0, "空仓", "空仓"
    label = _pct_label(pos)
    if last_rsi > 50:
        return pos, label + "，正在减", "减仓"
    if last_rsi <= 25:
        return pos, label, "买入"
    return pos, label, "持有"

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

@app.get("/api/chart/{symbol}", summary="日线加指标")
def chart(symbol: str):
    df = sanitize(q(
        "SELECT trade_date AS date, open, high, low, close, volume FROM bars WHERE symbol=%s ORDER BY trade_date",
        [symbol],
    ))
    if df.empty:
        return {"error": "还没有数据"}
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

def _load(symbol):
    df = sanitize(q(
        "SELECT trade_date AS date, open, high, low, close, volume FROM bars WHERE symbol=%s ORDER BY trade_date",
        [symbol],
    ))
    if df.empty:
        return df
    return add_indicators(df)

@app.get("/api/signals/{symbol}", summary="最新信号")
def signals(symbol: str):
    df = _load(symbol)
    if df.empty:
        return {"error": "还没有数据"}
    last = df.iloc[-1]
    rsi_now = None if pd.isna(last.rsi) else float(last.rsi)
    _, label, _phase = position_now(df)
    ma = num(last.ma50)
    ma_txt = None
    if ma is not None:
        side = "下" if last.close < last.ma50 else "上"
        ma_txt = f"{ma}，价格在它{side}面"
    rsi_txt = None if rsi_now is None else f"{num(rsi_now, 1)}，越低越该买"
    return {
        "日期": pd.Timestamp(last.date).strftime("%Y-%m-%d"),
        "收盘价": num(last.close),
        "相对强弱": rsi_txt,
        "50日均线": ma_txt,
        "布林下轨": num(last.bb_low),
        "建议仓位": label,
    }

def _rsi_per_percent(df):
    ret = df["close"].pct_change()
    drsi = df["rsi"].diff()
    sens = (drsi / (ret * 100)).replace([np.inf, -np.inf], np.nan).dropna()
    sens = sens[ret.reindex(sens.index).abs() > 0.001]
    if sens.empty:
        return 2.0
    v = float(sens.tail(15).median())
    return v if np.isfinite(v) and v > 0.2 else 2.0

def _rung(close, price, action):
    return {
        "price 价格": num(price, 3),
        "pct_from_close 距收盘百分比": num((price / close - 1) * 100, 2),
        "action 动作": action,
    }

@app.get("/api/orders/suggest", summary="限价单建议")
def order_suggest(symbol: str = "etf_510500"):
    df = _load(symbol)
    if len(df) < 16:
        return {"error": "数据不够"}
    last = df.iloc[-1]
    if pd.isna(last.rsi) or pd.isna(last.close) or last.close <= 0:
        return {"error": "相对强弱还没算出来"}
    close = float(last.close)
    rsi_now = float(last.rsi)
    _weight, label, phase = position_now(df)
    sens = _rsi_per_percent(df)
    ladder = []
    if phase == "减仓":
        note = f"相对强弱 {num(rsi_now, 1)}，已经高于50，建议仓位{label}。高于70才空仓。这一段不加仓。非投资建议。"
    elif phase == "空仓" and rsi_now > 70:
        note = "相对强弱已经高于70，按规则是空仓。非投资建议。"
    elif phase == "空仓":
        for target, text in ((25, "跌到相对强弱25，先买一成"), (20, "再跌到20，加到三成")):
            pct = (target - rsi_now) / sens / 100.0
            px = close * (1 + pct)
            if px < close * 0.999:
                ladder.append(_rung(close, px, text))
        note = "这次还没跌到25，所以还是空仓。不是因为高于25就该卖。下面的价都在现价下方。非投资建议。"
    else:
        ladder.append(_rung(close, close, f"现价可以买，目标拿到{label}"))
        for pct, text in ((0.03, "再低3%，继续买"), (0.06, "再低6%，继续买"), (0.09, "再低9%，继续买")):
            ladder.append(_rung(close, close * (1 - pct), text))
        if pd.notna(last.bb_low) and float(last.bb_low) < close * 0.995:
            ladder.append(_rung(close, float(last.bb_low), "布林下轨，再买一笔"))
        if phase == "持有":
            note = f"相对强弱 {num(rsi_now, 1)}，建议仓位{label}。高于25也先拿着，回到50以下都不卖。高于50才开始减，高于70才空仓。非投资建议。"
        else:
            note = f"相对强弱 {num(rsi_now, 1)}，建议仓位{label}。回到50以下都不卖。高于50才开始减，高于70才空仓。非投资建议。"
    ladder.sort(key=lambda x: -x["price 价格"])
    return {
        "symbol": symbol,
        "as_of 日期": pd.Timestamp(last.date).strftime("%Y-%m-%d"),
        "today_close 今日收盘价": num(close),
        "today_rsi 今日RSI": num(rsi_now, 1),
        "建议仓位": label,
        "phase 阶段": phase,
        "already_in_buy_zone 已在买区": phase == "买入",
        "ladder 分批限价": ladder,
        "note 说明": note,
    }

@app.get("/api/backtest", summary="回测胜率表")
def backtest(symbol: str = "etf_510500", start: str = "2022-01-01", end: str | None = None):
    if not end:
        end = dt.date.today().isoformat()
    df = sanitize(q(
        "SELECT trade_date AS date, open, high, low, close, volume FROM bars WHERE symbol=%s AND trade_date BETWEEN %s AND %s ORDER BY trade_date",
        [symbol, start, end],
    ))
    if len(df) < 100:
        return {"error": f"只有{len(df)}根日线"}
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
    return {"symbol": symbol, "period 区间": f"{start} 到 {end}", "n_bars K线数": len(df), "results 结果": grid[:15]}
