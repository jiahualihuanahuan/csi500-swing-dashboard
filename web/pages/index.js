import { useEffect, useState } from "react"

const API = ""

export default function Home() {
  const [sig, setSig] = useState(null)
  const [bt, setBt] = useState(null)
  const [order, setOrder] = useState(null)
  const [sym, setSym] = useState("etf_510500")

  useEffect(() => {
    fetch(`${API}/api/signals/${sym}`).then(r => r.json()).then(setSig).catch(() => {})
    fetch(`${API}/api/backtest?symbol=${sym}`).then(r => r.json()).then(setBt).catch(() => {})
    fetch(`${API}/api/orders/suggest?symbol=${sym}`).then(r => r.json()).then(setOrder).catch(() => {})
  }, [sym])

  return (
    <div style={{ fontFamily: "system-ui", maxWidth: 1100, margin: "0 auto", padding: 24 }}>
      <h1>CSI 500 Swing Dashboard</h1>
      <div style={{ marginBottom: 16 }}>
        {Object.entries({ etf_510500: "510500 ETF", etf_159922: "159922 ETF", csi500_index: "CSI 500 Index" }).map(([k, v]) => (
          <button key={k} onClick={() => setSym(k)}
            style={{ marginRight: 8, padding: "6px 14px", borderRadius: 6, border: sym === k ? "2px solid #2563eb" : "1px solid #ccc", background: sym === k ? "#dbeafe" : "#fff" }}>{v}</button>
        ))}
      </div>

      {sig && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 12, marginBottom: 24 }}>
          {Object.entries(sig).filter(([k]) => !k.startsWith("_")).map(([k, v]) => (
            <div key={k} style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 12 }}>
              <div style={{ color: "#6b7280", fontSize: 12 }}>{k}</div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>{v ?? "-"}</div>
            </div>
          ))}
        </div>
      )}

      {order && !order.error && (
        <div style={{ border: "1px solid #fca5a5", borderRadius: 8, padding: 16, marginBottom: 24, background: "#fef2f2" }}>
          <b>Limit order suggestion</b>: buy {sym} at <b>{order.suggested_limit_price}</b> (today close {order.today_close}, RSI {order.today_rsi}, target RSI {order.target_rsi}). ~{order.pct_from_close}% below close. {order.note}
        </div>
      )}

      {bt && bt.results && (
        <div>
          <h2>Backtest — top combos by win rate ({bt.period}, {bt.n_bars} bars)</h2>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
            <thead><tr>{["rsi_buy","rsi_buy2","rsi_sell","macd_exit","trend_filter","trades","win_rate %","avg ret %","total ret %"].map(h => <th key={h} style={{ borderBottom: "2px solid #111", textAlign: "left", padding: 6 }}>{h}</th>)}</tr></thead>
            <tbody>
              {bt.results.map((r, i) => (
                <tr key={i} style={{ background: i === 0 ? "#dcfce7" : "#fff" }}>
                  <td style={{ padding: 6 }}>{r.rsi_buy}</td><td style={{ padding: 6 }}>{r.rsi_buy2}</td><td style={{ padding: 6 }}>{r.rsi_sell}</td>
                  <td style={{ padding: 6 }}>{String(r.macd_exit)}</td><td style={{ padding: 6 }}>{String(r.trend_filter)}</td>
                  <td style={{ padding: 6 }}>{r.trades}</td><td style={{ padding: 6, fontWeight: 700 }}>{r.win_rate}</td>
                  <td style={{ padding: 6 }}>{r.avg_return_pct}</td><td style={{ padding: 6 }}>{r.total_return_pct}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
