import { useEffect, useMemo, useState } from "react"
import PriceChart from "../components/PriceChart"

const API = ""
const RANGES = [
  { id: "6m", label: "6个月", days: 183 },
  { id: "1y", label: "1年", days: 365 },
  { id: "3y", label: "3年", days: 365 * 3 },
  { id: "5y", label: "5年", days: 365 * 5 },
  { id: "all", label: "全部", days: null },
]

function field(obj, name) {
  if (!obj) return undefined
  if (obj[name] != null) return obj[name]
  const key = Object.keys(obj).find(k => k === name || k.startsWith(name + " "))
  return key ? obj[key] : undefined
}

function sliceRange(rows, days) {
  if (!days || !rows?.length) return rows || []
  const end = new Date(rows[rows.length - 1].date + "T00:00:00")
  const start = new Date(end)
  start.setDate(start.getDate() - days)
  const iso = start.toISOString().slice(0, 10)
  return rows.filter(r => r.date >= iso)
}

export default function Home() {
  const [sig, setSig] = useState(null)
  const [bt, setBt] = useState(null)
  const [order, setOrder] = useState(null)
  const [bars, setBars] = useState(null)
  const [err, setErr] = useState(null)
  const [sym, setSym] = useState("etf_510500")
  const [range, setRange] = useState("1y")

  useEffect(() => {
    let cancelled = false
    setSig(null); setBt(null); setOrder(null); setBars(null); setErr(null)
    ;(async () => {
      const jobs = [
        ["signals", `${API}/api/signals/${sym}`, setSig],
        ["chart", `${API}/api/chart/${sym}`, setBars],
        ["backtest", `${API}/api/backtest?symbol=${sym}`, setBt],
        ["orders", `${API}/api/orders/suggest?symbol=${sym}`, setOrder],
      ]
      const errs = []
      await Promise.all(jobs.map(async ([name, url, set]) => {
        try {
          const r = await fetch(url)
          const body = await r.json().catch(() => null)
          if (!r.ok) throw new Error(`${name} ${r.status}`)
          if (cancelled) return
          set(body)
          if (body?.error) errs.push(`${name}: ${body.error}`)
        } catch (e) {
          errs.push(e.message || String(e))
        }
      }))
      if (!cancelled && errs.length) setErr(errs.join(" · "))
    })()
    return () => { cancelled = true }
  }, [sym])

  const days = RANGES.find(r => r.id === range)?.days
  const view = useMemo(() => sliceRange(Array.isArray(bars) ? bars : [], days), [bars, days])

  const todayClose = field(order, "today_close")
  const todayRsi = field(order, "today_rsi")
  const asOf = field(order, "as_of")
  const inZone = field(order, "already_in_buy_zone")
  const ladder = field(order, "ladder") || []
  const note = field(order, "note")
  const results = field(bt, "results")

  return (
    <div style={{ fontFamily: "system-ui", maxWidth: 1100, margin: "0 auto", padding: 24 }}>
      <h1>CSI 500 Swing Dashboard</h1>
      <div style={{ marginBottom: 16 }}>
        {Object.entries({ etf_510500: "510500 ETF", etf_159922: "159922 ETF", csi500_index: "CSI 500 Index" }).map(([k, v]) => (
          <button key={k} onClick={() => setSym(k)}
            style={{ marginRight: 8, padding: "6px 14px", borderRadius: 6, border: sym === k ? "2px solid #2563eb" : "1px solid #ccc", background: sym === k ? "#dbeafe" : "#fff" }}>{v}</button>
        ))}
      </div>

      {err && (
        <div style={{ border: "1px solid #f59e0b", background: "#fffbeb", borderRadius: 8, padding: 12, marginBottom: 16 }}>
          {err}
        </div>
      )}

      {sig && !sig.error && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 12, marginBottom: 24 }}>
          {Object.entries(sig).filter(([k]) => !k.startsWith("_")).map(([k, v]) => (
            <div key={k} style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 12 }}>
              <div style={{ color: "#6b7280", fontSize: 12 }}>{k}</div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>{v ?? "-"}</div>
            </div>
          ))}
        </div>
      )}

      <div style={{ marginBottom: 28 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
          <h2 style={{ margin: "0 0 8px" }}>日线</h2>
          <div>
            {RANGES.map(r => (
              <button key={r.id} onClick={() => setRange(r.id)}
                style={{ marginLeft: 6, padding: "4px 10px", borderRadius: 6, border: range === r.id ? "2px solid #2563eb" : "1px solid #ccc", background: range === r.id ? "#dbeafe" : "#fff" }}>{r.label}</button>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px", fontSize: 12, color: "#4b5563", marginBottom: 8 }}>
          <span><b style={{ color: "#ef4444" }}>MA5</b></span>
          <span><b style={{ color: "#f59e0b" }}>MA10</b></span>
          <span><b style={{ color: "#ca8a04" }}>MA20</b> 布林中轨</span>
          <span><b style={{ color: "#2563eb" }}>MA50</b> 趋势过滤</span>
          <span><b style={{ color: "#7c3aed" }}>MA200</b></span>
          <span style={{ color: "#94a3b8" }}>虚线 布林上下轨</span>
          <span>下方副图：成交量 · MACD · RSI · KDJ · Z-score(20日)</span>
        </div>
        {view.length > 0 ? <PriceChart rows={view} /> : <div style={{ padding: 24, color: "#6b7280" }}>图加载中…</div>}
      </div>

      {order && !order.error && (
        <div style={{ border: "1px solid #86efac", borderRadius: 8, padding: 16, marginBottom: 24, background: "#f0fdf4" }}>
          <b>分批买入</b>
          <div style={{ margin: "6px 0 10px" }}>
            截至 {asOf} 收盘 <b>{todayClose}</b>，RSI <b>{todayRsi}</b>。
            {inZone ? " 已在买区：现价可以买，更低继续买。" : " 还没到买区：只挂现价下方。"}
          </div>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 14 }}>
            <tbody>
              {ladder.map((r, i) => (
                <tr key={i}>
                  <td style={{ padding: "4px 12px 4px 0", fontWeight: 700 }}>{field(r, "price")}</td>
                  <td style={{ padding: 4, color: "#6b7280" }}>{field(r, "pct_from_close")}%</td>
                  <td style={{ padding: 4 }}>{field(r, "action")}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ marginTop: 8, color: "#4b5563", fontSize: 13 }}>{note}</div>
        </div>
      )}

      {results && (
        <div>
          <h2>Backtest — top combos by win rate ({field(bt, "period")}, {field(bt, "n_bars")} bars)</h2>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
            <thead><tr>{["rsi_buy","rsi_buy2","rsi_sell","macd_exit","trend_filter","trades","win_rate %","avg ret %","total ret %"].map(h => <th key={h} style={{ borderBottom: "2px solid #111", textAlign: "left", padding: 6 }}>{h}</th>)}</tr></thead>
            <tbody>
              {results.map((r, i) => (
                <tr key={i} style={{ background: i === 0 ? "#dcfce7" : "#fff" }}>
                  <td style={{ padding: 6 }}>{field(r, "rsi_buy")}</td><td style={{ padding: 6 }}>{field(r, "rsi_buy2")}</td><td style={{ padding: 6 }}>{field(r, "rsi_sell")}</td>
                  <td style={{ padding: 6 }}>{String(field(r, "macd_exit"))}</td><td style={{ padding: 6 }}>{String(field(r, "trend_filter"))}</td>
                  <td style={{ padding: 6 }}>{field(r, "trades")}</td><td style={{ padding: 6, fontWeight: 700 }}>{field(r, "win_rate")}</td>
                  <td style={{ padding: 6 }}>{field(r, "avg_return_pct")}</td><td style={{ padding: 6 }}>{field(r, "total_return_pct")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
