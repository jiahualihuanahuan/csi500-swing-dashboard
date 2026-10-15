"""CSI500 API — 中证500波段交易后端 / Backend for CSI 500 swing dashboard.
所有返回字段均附中文说明 / All response fields include Chinese descriptions."""
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
import os, pandas as pd, numpy as np
import psycopg2

app = FastAPI(title="CSI500 API 中证500 API", description="中证500指数与ETF波段交易信号、仓位、回测接口")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
DB = os.environ["DATABASE_URL"]

def q(sql, params=None):
    with psycopg2.connect(DB) as c:
        return pd.read_sql(sql, c, params=params)

@app.get("/health")
def health():
    return {"ok": True, "status": "正常 healthy"}

@app.get("/api/bars/{symbol}", summary="K线数据 / OHLCV bars")
def bars(symbol: str, start: str | None = None, end: str | None = None):
    """获取K线 / Get daily bars. symbol: csi500_index / etf_510500 / etf_159922"""
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

# ---------- 指标 / Indicators ----------
def rsi(s, n=14):
    """RSI 相对强弱指数 / Relative Strength Index. 0-100, <30 超卖 oversold, >70 超买 overbought."""
    d = s.diff(); up = d.clip(lower=0).rolling(n).mean(); down = (-d.clip(upper=0)).rolling(n).mean()
    return 100 - 100 / (1 + up / down.replace(0, np.nan))

def kdj(df, n=9):
    """KDJ 随机指标 / Stochastic oscillator. K/D/J 三线, J线最敏感."""
    ll = df["low"].rolling(n).min(); hh = df["high"].rolling(n).max()
    rsv = (df["close"] - ll) / (hh - ll).replace(0, np.nan) * 100
    k = rsv.ewm(alpha=1/3).mean(); d = k.ewm(alpha=1/3).mean()
    return k, d, 3 * k - 2 * d

def macd(s, fast=12, slow=26, sig=9):
    """MACD 指数平滑异同移动平均线. hist 柱状图由负转正=买入信号, 由正转负=卖出信号."""
    ef, es = s.ewm(span=fast).mean(), s.ewm(span=slow).mean()
    line = ef - es; signal = line.ewm(span=sig).mean()
    return line, signal, line - signal

def bollinger(s, n=20, k=2):
    """布林带 / Bollinger Bands. 下轨=支撑 support, 上轨=阻力 resistance."""
    mid = s.rolling(n).mean(); std = s.rolling(n).std()
    return mid - k * std, mid, mid + k * std

def add_indicators(df):
    df = df.copy()
    df["rsi"] = rsi(df["close"])
    df["k"], df["d"], df["j"] = kdj(df)
    df["macd"], df["signal"], df["hist"] = macd(df["close"])
    df["bb_low"], df["bb_mid"], df["bb_up"] = bollinger(df["close"])
    df["ma50"] = df["close"].rolling(50).mean()  # 50日均线 / 50-day moving average
    return df

# ---------- 信号 / 仓位状态机 / Signals & position state machine ----------
# 四档: 满仓 full(1.0) / 半仓 half(0.5) / 轻仓 light(0.25) / 空仓 flat(0.0)
TIERS = [("full 满仓", 1.0), ("half 半仓", 0.5), ("light 轻仓", 0.25), ("flat 空仓", 0.0)]

def simulate(df, rsi_buy=30, rsi_buy2=20, rsi_sell=70, macd_exit=True, trend_filter=True):
    """回测模拟 / Backtest simulation. rsi_buy=RSI买入线, rsi_buy2=二次补仓线, rsi_sell=RSI卖出线."""
    df = add_indicators(df)
    pos = 0.0; entry = None; trades = []
    for r in df.itertuples():
        # 趋势过滤: 价格低于50日均线时不开新仓，已有仓位则趋势出场
        if trend_filter and pd.notna(r.ma50) and r.close < r.ma50:
            if pos > 0:
                trades.append((r.date, entry, r.close, pos, "trend-exit 趋势出场")); pos = 0.0; entry = None
            continue
        if pos == 0 and r.rsi < rsi_buy:
            pos = 0.5; entry = r.close  # 低吸第一笔 / first entry
        elif pos == 0.5 and r.rsi < rsi_buy2:
            pos = 0.7; entry = (entry + r.close) / 2  # 二次补仓 / second entry
        elif pos > 0 and (r.rsi > rsi_sell or (macd_exit and r.hist < 0 and getattr(r, "hist_prev", 0) >= 0)):
            trades.append((r.date, entry, r.close, pos, "signal-exit 信号出场")); pos = 0.0; entry = None
    if pos > 0:
        trades.append((df.iloc[-1].date, entry, df.iloc[-1].close, pos, "open 未平仓"));
    return trades

@app.get("/api/signals/{symbol}", summary="最新信号 / Latest signals")
def signals(symbol: str):
    """返回最新一根K线的指标与建议仓位 / Latest bar indicators + suggested position tier."""
    df = q("SELECT trade_date AS date, open, high, low, close, volume FROM bars WHERE symbol=%s ORDER BY trade_date", [symbol])
    if df.empty:
        return {"error": "no data 无数据"}
    df = add_indicators(df)
    last = df.iloc[-1]
    return {
        "date": str(last.date), "close 收盘价": round(last.close, 3),
        "rsi 相对强弱指数": round(last.rsi, 1), "k": round(last.k, 1), "d": round(last.d, 1), "j": round(last.j, 1),
        "macd_hist MACD柱状图": round(last.hist, 4), "ma50 50日均线": round(last.ma50, 3) if pd.notna(last.ma50) else None,
        "bb_low 布林下轨": round(last.bb_low, 3), "position_tier 建议仓位": "half 半仓" if last.rsi < 30 else ("light 轻仓" if last.rsi < 40 else "flat 空仓"),
    }

@app.get("/api/orders/suggest", summary="限价单建议 / Limit order suggestion")
def order_suggest(symbol: str = "etf_510500", target_rsi: float = 30.0):
    """根据今日收盘价和RSI，线性估算RSI达到target_rsi时的价格 / Estimate price where RSI hits target (linear approx)."""
    df = q("SELECT trade_date AS date, open, high, low, close FROM bars WHERE symbol=%s ORDER BY trade_date DESC LIMIT 20", [symbol])
    if len(df) < 3:
        return {"error": "not enough data 数据不足"}
    df = df.iloc[::-1].reset_index(drop=True)
    df = add_indicators(df)
    last = df.iloc[-1]
    prev = df.iloc[-2]
    rsi_now = last.rsi
    if pd.isna(rsi_now):
        return {"error": "rsi not ready RSI未就绪"}
    pct_move = (last.close - prev.close) / prev.close
    rsi_move = last.rsi - prev.rsi if pd.notna(prev.rsi) else 0
    sens = rsi_move / pct_move if pct_move != 0 else -50  # RSI每1%价格变动的点数
    need = target_rsi - rsi_now
    pct_needed = need / sens if sens != 0 else 0
    limit_price = last.close * (1 + pct_needed)
    return {
        "symbol": symbol,
        "today_close 今日收盘价": round(last.close, 3),
        "today_rsi 今日RSI": round(rsi_now, 1),
        "target_rsi 目标RSI": target_rsi,
        "suggested_limit_price 建议限价": round(max(limit_price, 0.01), 3),
        "pct_from_close 距收盘百分比": round(pct_needed * 100, 2),
        "note 说明": "线性近似，仅供参考，开盘时请复查 / Linear approx, for reference only. Not financial advice 非投资建议.",
    }

# ---------- 回测网格 / Backtest grid ----------
@app.get("/api/backtest", summary="回测胜率表 / Backtest win-rate table")
def backtest(symbol: str = "etf_510500", start: str = "2022-01-01", end: str = "2026-10-15"):
    """网格搜索不同RSI买卖参数的胜率 / Grid search win rates across RSI buy/sell params."""
    df = q("SELECT trade_date AS date, open, high, low, close, volume FROM bars WHERE symbol=%s AND trade_date BETWEEN %s AND %s ORDER BY trade_date", [symbol, start, end])
    if len(df) < 100:
        return {"error": f"only {len(df)} bars 仅{len(df)}根K线"}
    grid = []
    for rsi_buy in (25, 30, 35):
        for rsi_buy2 in (15, 20):
            for rsi_sell in (65, 70, 75):
                for macd_exit in (True, False):
                    for trend_filter in (True, False):
                        trades = simulate(df, rsi_buy, rsi_buy2, rsi_sell, macd_exit, trend_filter)
                        closed = [t for t in trades if t[4] != "open 未平仓"]
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
