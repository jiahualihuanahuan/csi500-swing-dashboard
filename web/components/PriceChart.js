import { useEffect, useRef } from "react"

const OVERLAY = { priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }

function lineData(rows, key) {
  const out = []
  for (const r of rows) {
    if (r[key] == null) continue
    out.push({ time: r.date, value: r[key] })
  }
  return out
}

export default function PriceChart({ rows }) {
  const ref = useRef(null)

  useEffect(() => {
    if (!ref.current || !rows?.length) return
    let chart
    let dead = false
    ;(async () => {
      const lc = await import("lightweight-charts")
      if (dead || !ref.current) return
      chart = lc.createChart(ref.current, {
        autoSize: true,
        layout: {
          background: { color: "#ffffff" },
          textColor: "#374151",
          fontFamily: "system-ui, sans-serif",
          panes: { separatorColor: "#e5e7eb", separatorHoverColor: "#93c5fd", enableResize: true },
        },
        grid: { vertLines: { color: "#f3f4f6" }, horzLines: { color: "#f3f4f6" } },
        rightPriceScale: { borderColor: "#e5e7eb" },
        timeScale: { borderColor: "#e5e7eb" },
      })

      const addLine = (pane, key, color, extra = {}) => {
        const s = chart.addSeries(lc.LineSeries, { color, lineWidth: 1, ...OVERLAY, ...extra }, pane)
        s.setData(lineData(rows, key))
        return s
      }

      chart.addSeries(lc.CandlestickSeries, {
        upColor: "#16a34a", downColor: "#dc2626",
        borderUpColor: "#16a34a", borderDownColor: "#dc2626",
        wickUpColor: "#16a34a", wickDownColor: "#dc2626",
      }, 0).setData(rows.map(r => ({ time: r.date, open: r.open, high: r.high, low: r.low, close: r.close })))

      addLine(0, "ma5", "#ef4444")
      addLine(0, "ma10", "#f59e0b")
      addLine(0, "ma20", "#ca8a04")
      addLine(0, "ma50", "#2563eb", { lineWidth: 2 })
      addLine(0, "ma200", "#7c3aed")
      addLine(0, "bb_up", "#94a3b8", { lineStyle: 2 })
      addLine(0, "bb_low", "#94a3b8", { lineStyle: 2 })

      chart.addSeries(lc.HistogramSeries, {
        priceFormat: { type: "volume" }, priceLineVisible: false, lastValueVisible: false,
      }, 1).setData(rows.map(r => ({
        time: r.date,
        value: r.volume || 0,
        color: r.close >= r.open ? "rgba(22,163,74,0.45)" : "rgba(220,38,38,0.45)",
      })))

      chart.addSeries(lc.HistogramSeries, { priceLineVisible: false, lastValueVisible: false }, 2).setData(
        rows.filter(r => r.hist != null).map(r => ({
          time: r.date,
          value: r.hist,
          color: r.hist >= 0 ? "rgba(22,163,74,0.75)" : "rgba(220,38,38,0.75)",
        }))
      )
      addLine(2, "macd", "#2563eb")
      addLine(2, "signal", "#f59e0b")

      const rsi = addLine(3, "rsi", "#7c3aed", { lineWidth: 2, lastValueVisible: true })
      rsi.createPriceLine({ price: 70, color: "#9ca3af", lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: "70" })
      rsi.createPriceLine({ price: 30, color: "#9ca3af", lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: "30" })

      addLine(4, "k", "#2563eb")
      addLine(4, "d", "#f59e0b")
      addLine(4, "j", "#db2777")

      const z = addLine(5, "zscore", "#0f766e", { lineWidth: 2, lastValueVisible: true })
      for (const level of [2, 0, -2]) {
        z.createPriceLine({ price: level, color: "#9ca3af", lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: String(level) })
      }

      const weights = [4.2, 0.85, 1.45, 1.25, 1.25, 1.25]
      chart.panes().forEach((pane, i) => pane.setStretchFactor(weights[i] || 1))
      chart.timeScale().fitContent()
    })()
    return () => {
      dead = true
      chart?.remove()
    }
  }, [rows])

  return <div ref={ref} style={{ width: "100%", height: 1080 }} />
}
