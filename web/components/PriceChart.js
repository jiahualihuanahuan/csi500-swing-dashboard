import { useEffect, useRef } from "react"

const UP = "#dc2626"
const DOWN = "#16a34a"
const OVERLAY = { priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }

const NOTES = [
  { w: 4.2, title: "日线", body: "一根是一天。红K收涨，绿K收跌。红细线是5日均价，橙线10日，黄线20日。蓝粗线是50日均价，跌破它这套规则就先不买。紫线是200日。灰虚线是布林带上下边，价格多半在这两条中间晃。" },
  { w: 0.85, title: "成交量", body: "当天成交了多少。红柱是上涨的那天，绿柱是下跌的那天。柱子越高，买卖越热闹。" },
  { w: 1.45, title: "MACD", body: "看涨和跌谁的力气大。蓝线是快线，黄线是慢线。红柱：快线在慢线上面，涨的力气更大。绿柱：快线在下面，跌的力气更大。" },
  { w: 1.25, title: "RSI", body: "相对强弱，从0到100。紫线是当天的读数。低于灰线30，通常算跌多了，可以考虑买。高于灰线70，通常算涨多了，可以考虑卖。" },
  { w: 1.25, title: "KDJ", body: "短线冷热。蓝线是K，黄线是D，粉线是J。粉线跳得最快。蓝线从下面穿过黄线，短线往往转强。" },
  { w: 1.25, title: "Z值", body: "青线不是涨跌颜色。它衡量收盘价离开20日均价有几个波动。0是贴着均价。高于2偏贵，低于-2偏便宜。灰虚线标着 2、0 和 -2。" },
]

function lineData(rows, key) {
  const out = []
  for (const r of rows) {
    if (r[key] == null) continue
    out.push({ time: r.date, value: r[key] })
  }
  return out
}

function paint(bag, rows) {
  if (!bag || !rows?.length) return
  const { series } = bag
  series.candle.setData(rows.map(r => ({ time: r.date, open: r.open, high: r.high, low: r.low, close: r.close })))
  for (const key of ["ma5", "ma10", "ma20", "ma50", "ma200", "bb_up", "bb_low", "macd", "signal", "rsi", "k", "d", "j", "zscore"]) {
    series[key].setData(lineData(rows, key))
  }
  series.volume.setData(rows.map(r => ({
    time: r.date,
    value: r.volume || 0,
    color: r.close >= r.open ? "rgba(220,38,38,0.45)" : "rgba(22,163,74,0.45)",
  })))
  series.hist.setData(rows.filter(r => r.hist != null).map(r => ({
    time: r.date,
    value: r.hist,
    color: r.hist >= 0 ? "rgba(220,38,38,0.75)" : "rgba(22,163,74,0.75)",
  })))
  if (!bag.fitted) {
    bag.chart.timeScale().fitContent()
    bag.fitted = true
  }
}

export default function PriceChart({ rows }) {
  const ref = useRef(null)
  const bagRef = useRef(null)
  const rowsRef = useRef(rows)
  rowsRef.current = rows

  useEffect(() => {
    if (!ref.current) return
    let dead = false
    let chart
    ;(async () => {
      const lc = await import("lightweight-charts")
      if (dead || !ref.current) return
      chart = lc.createChart(ref.current, {
        autoSize: true,
        layout: {
          background: { color: "#ffffff" },
          textColor: "#374151",
          fontFamily: "system-ui, sans-serif",
          panes: { separatorColor: "#e5e7eb", separatorHoverColor: "#93c5fd", enableResize: false },
        },
        grid: { vertLines: { color: "#f3f4f6" }, horzLines: { color: "#f3f4f6" } },
        rightPriceScale: { borderColor: "#e5e7eb" },
        timeScale: { borderColor: "#e5e7eb" },
      })

      const series = {}
      const addLine = (pane, key, color, extra = {}) => {
        series[key] = chart.addSeries(lc.LineSeries, { color, lineWidth: 1, ...OVERLAY, ...extra }, pane)
      }

      series.candle = chart.addSeries(lc.CandlestickSeries, {
        upColor: UP, downColor: DOWN,
        borderUpColor: UP, borderDownColor: DOWN,
        wickUpColor: UP, wickDownColor: DOWN,
      }, 0)

      addLine(0, "ma5", "#ef4444")
      addLine(0, "ma10", "#f59e0b")
      addLine(0, "ma20", "#ca8a04")
      addLine(0, "ma50", "#2563eb", { lineWidth: 2 })
      addLine(0, "ma200", "#7c3aed")
      addLine(0, "bb_up", "#94a3b8", { lineStyle: 2 })
      addLine(0, "bb_low", "#94a3b8", { lineStyle: 2 })

      series.volume = chart.addSeries(lc.HistogramSeries, {
        priceFormat: { type: "volume" }, priceLineVisible: false, lastValueVisible: false,
      }, 1)

      series.hist = chart.addSeries(lc.HistogramSeries, { priceLineVisible: false, lastValueVisible: false }, 2)
      addLine(2, "macd", "#2563eb")
      addLine(2, "signal", "#f59e0b")

      addLine(3, "rsi", "#7c3aed", { lineWidth: 2, lastValueVisible: true })
      series.rsi.createPriceLine({ price: 70, color: "#9ca3af", lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: "70" })
      series.rsi.createPriceLine({ price: 30, color: "#9ca3af", lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: "30" })

      addLine(4, "k", "#2563eb")
      addLine(4, "d", "#f59e0b")
      addLine(4, "j", "#db2777")

      addLine(5, "zscore", "#0f766e", { lineWidth: 2, lastValueVisible: true })
      for (const level of [2, 0, -2]) {
        series.zscore.createPriceLine({ price: level, color: "#9ca3af", lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: String(level) })
      }

      chart.panes().forEach((pane, i) => {
        pane.setStretchFactor(NOTES[i]?.w || 1)
        if (lc.createTextWatermark && NOTES[i]) {
          lc.createTextWatermark(pane, {
            horzAlign: "left",
            vertAlign: "top",
            lines: [{ text: NOTES[i].title, color: "rgba(17,24,39,0.88)", fontSize: 13, fontStyle: "bold" }],
          })
        }
      })

      const bag = { chart, series, fitted: false }
      bagRef.current = bag
      paint(bag, rowsRef.current)
    })()
    return () => {
      dead = true
      chart?.remove()
      bagRef.current = null
    }
  }, [])

  useEffect(() => {
    paint(bagRef.current, rows)
  }, [rows])

  return (
    <div style={{ display: "flex", gap: 12, alignItems: "stretch" }}>
      <div ref={ref} style={{ flex: "1 1 auto", height: 1080, minWidth: 0 }} />
      <div style={{ width: 232, height: 1080, display: "flex", flexDirection: "column" }}>
        {NOTES.map(n => (
          <div key={n.title} style={{ flex: n.w, overflow: "hidden", borderBottom: "1px solid #e5e7eb", padding: "6px 0", fontSize: 12, lineHeight: 1.45 }}>
            <div style={{ fontWeight: 700, marginBottom: 2 }}>{n.title}</div>
            <div style={{ color: "#374151" }}>{n.body}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
