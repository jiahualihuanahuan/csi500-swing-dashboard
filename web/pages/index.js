import { useEffect, useState } from "react"

const API = ""

function field(obj, name) {
  if (!obj) return undefined
  if (obj[name] != null) return obj[name]
  const key = Object.keys(obj).find(k => k === name || k.startsWith(name + " "))
  return key ? obj[key] : undefined
}

export default function Home() {
  const [sig, setSig] = useState(null)
  const [bt, setBt] = useState(null)
  const [order, setOrder] = useState(null)
  const [err, setErr] = useState(null)
  const [sym, setSym] = useState("etf_510500")

  useEffect(() => {
    let cancelled = false
    setSig(null); setBt(null); setOrder(null); setErr(null)
    ;(async () => {
      try {
        const [sRes, bRes, oRes] = await Promise.all([
          fetch(`${API}/api/signals/${sym}`),
          fetch(`${API}/api/backtest?symbol=${sym}`),
          fetch(`${API}/api/orders/suggest?symbol=${sym}`),
        ])
        if (!sRes.ok || !bRes.ok || !oRes.ok) {
          throw new Error(`API ${sRes.status}/${bRes.status}/${oRes.status}`)
        }
        const [s, b, o] = await Promise.all([sRes.json(), bRes.json(), oRes.json()])
        if (cancelled) return
        setSig(s); setBt(b); setOrder(o)
        const msgs = [s?.error, b?.error, o?.error].filter(Boolean)
        if (msgs.length) setErr(msgs.join(" · "))
      } catch (e) {
        if (!cancelled) setErr(e.message || String(e))
      }
    })()
    return () => { cancelled = true }
  }, [sym])

  const limit = field(order, "suggested_limit_price")
  const todayClose = field(order, "today_close")
  const todayRsi = field(order, "today_rsi")
  const targetRsi = field(order, "target_rsi")
  const pct = field(order, "pct_from_close")
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

      {order && !order.error && limit != null && (
        <div style={{ border: "1px solid #fca5a5", borderRadius: 8, padding: 16, marginBottom: 24, background: "#fef2f2" }}>
          <b>Limit order suggestion</b>: buy {sym} at <b>{limit}</b> (today close {todayClose}, RSI {todayRsi}, target RSI {targetRsi}). ~{pct}% below close. {note}
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
