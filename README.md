# CSI 500 波段交易仪表盘 / Swing Dashboard

中证500指数与ETF（510500 / 159922）的波段交易仪表盘。
CSI 500 index & ETF swing-trading dashboard.

## 技术栈 / Stack

- **数据抓取 Data fetch**: Python + akshare（指数+ETF日线，限速 1 次/秒 rate-limited to 1 req/s）
- **存储 Storage**: PostgreSQL（快速SQL，按 symbol/date 建索引 indexed on symbol/date）
- **API**: FastAPI（信号 signals、仓位 positions、回测 backtest、限价单建议 limit-order suggestions）
- **前端 Frontend**: Next.js + lightweight-charts（K线图 + RSI/KDJ/MACD）
- **回测 Backtest**: 网格搜索 RSI/KDJ/布林带触发组合 grid search over trigger combos，胜率表 win-rate table
- **部署 Deploy**: Docker Compose（可选 Ollama 新闻摘要 sidecar，默认关闭 off by default）

## 指标说明 / Indicator Guide

- **RSI（相对强弱指数）**: 衡量价格涨跌动能的超买超卖指标，0-100。低于30通常视为超卖（可买入），高于70视为超买（可卖出）。
- **KDJ**: 短线随机指标，K/D/J三线，J线最敏感，A股短线常用。
- **MACD（指数平滑异同移动平均线）**: 趋势+动量指标，hist柱状图由负转正为买入信号，由正转负为卖出信号。
- **布林带 Bollinger Bands**: 价格通道，下轨常作支撑、上轨常作阻力。
- **MA50（50日均线）**: 趋势过滤，价格在均线上方偏多头，下方偏空头。

## 快速开始 / Quick start

```bash
git clone https://github.com/jiahualihuanahuan/csi500-swing-dashboard.git
cd csi500-swing-dashboard
cp .env.example .env
docker compose up -d --build
```

- 仪表盘 Dashboard: http://localhost:3333
- API 文档 API docs: http://localhost:8000/docs

## 仓位状态机 / Position state machine

四个档位 Four tiers: 满仓 full / 半仓 half / 轻仓 light / 空仓 flat。
RSI < 30 买入一半（half），RSI < 20 补到七成（to 70%），RSI > 70 或 MACD 柱状图翻转时卖出 exits。

## 回测 / Backtest

`GET /api/backtest?symbol=etf_510500&start=2022-01-01&end=2026-10-15`
返回按胜率排序的参数组合对比表 comparison table of trigger parameter sets sorted by win rate。

## 限价单助手 / Limit-order helper

`GET /api/orders/suggest?symbol=etf_510500`
根据今日收盘价和RSI，估算RSI达到下一个买入触发点（如30）时的价格，可直接用于挂限价单。
Computes the price at which RSI would hit the next buy trigger given today's close.

## 新闻摘要（可选）/ News digest (optional)

在 `.env` 中设置 `OLLAMA_URL` 启用。Sidecar 每日总结中文财经 headlines，供服务器上的 9B Qwen 模型阅读。非必需 Not required.
