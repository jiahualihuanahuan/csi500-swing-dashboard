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
const NAMES = { etf_510500: "510500", etf_159922: "159922", csi500_index: "中证500指数" }
const COLS = [
  ["rsi_buy", "买入线"],
  ["rsi_buy2", "补仓线"],
  ["rsi_sell", "卖出线"],
  ["macd_exit", "转弱就卖"],
  ["trend_filter", "破均线就走"],
  ["trades", "笔数"],
  ["win_rate", "胜率"],
  ["avg_return_pct", "平均每笔"],
  ["total_return_pct", "一共赚亏"],
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

function zhKey(k) {
  if (k === "date") return "日期"
  if (k === "k" || k === "d" || k === "j") return k.toUpperCase()
  const i = k.indexOf(" ")
  return i === -1 ? k : k.slice(i + 1)
}

function zhVal(v) {
  if (typeof v !== "string") return v ?? "-"
  return v.replace(/^(half|add|flat|full|light) /, "")
}

function onOff(v) {
  if (v === true || v === "true") return "开"
  if (v === false || v === "false") return "关"
  return v ?? "-"
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
        ["信号", `${API}/api/signals/${sym}`, setSig],
        ["图", `${API}/api/chart/${sym}`, setBars],
        ["回测", `${API}/api/backtest?symbol=${sym}`, setBt],
        ["限价", `${API}/api/orders/suggest?symbol=${sym}`, setOrder],
      ]
      const errs = []
      await Promise.all(jobs.map(async ([name, url, set]) => {
        try {
          const r = await fetch(url)
          const body = await r.json().catch(() => null)
          if (!r.ok) throw new Error(name + " " + r.status)
          if (cancelled) return
          set(body)
          if (body && body.error) errs.push(name + "：" + body.error)
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
    <div style={{ fontFamily: "system-ui", maxWidth: 1180, margin: "0 auto", padding: 24 }}>
      <h1>中证500波段</h1>
      <div style={{ marginBottom: 16 }}>
        {Object.entries(NAMES).map(([k, v]) => (
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
              <div style={{ color: "#6b7280", fontSize: 12 }}>{zhKey(k)}</div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>{zhVal(v)}</div>
            </div>
          ))}
        </div>
      )}

      <div style={{ marginBottom: 28 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
          <h2 style={{ margin: "0 0 8px" }}>走势</h2>
          <div>
            {RANGES.map(r => (
              <button key={r.id} onClick={() => setRange(r.id)}
                style={{ marginLeft: 6, padding: "4px 10px", borderRadius: 6, border: range === r.id ? "2px solid #2563eb" : "1px solid #ccc", background: range === r.id ? "#dbeafe" : "#fff" }}>{r.label}</button>
            ))}
          </div>
        </div>
        {view.length > 0 ? <PriceChart rows={view} /> : <div style={{ padding: 24, color: "#6b7280" }}>图还在加载…</div>}
      </div>

      {order && !order.error && (
        <div style={{ border: "1px solid #86efac", borderRadius: 8, padding: 16, marginBottom: 24, background: "#f0fdf4" }}>
          <b>分批买入</b>
          <div style={{ margin: "6px 0 10px" }}>
            截至 {asOf} 收盘 <b>{todayClose}</b>，相对强弱 <b>{todayRsi}</b>。
            {inZone ? " 已经在买区：现价可以买，更低就继续买。" : " 还没到买区：只挂现价下方。"}
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
          <h2>回测：哪组买卖规则更赚</h2>
          <p style={{ color: "#4b5563", fontSize: 13, marginTop: 0 }}>
            每一行是一套规则，按胜率从高到低排。区间 {field(bt, "period")}，共 {field(bt, "n_bars")} 根日线。
          </p>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
            <thead>
              <tr>{COLS.map(([k, h]) => <th key={k} style={{ borderBottom: "2px solid #111", textAlign: "left", padding: 6 }}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {results.map((r, i) => (
                <tr key={i} style={{ background: i === 0 ? "#dcfce7" : "#fff" }}>
                  <td style={{ padding: 6 }}>{field(r, "rsi_buy")}</td>
                  <td style={{ padding: 6 }}>{field(r, "rsi_buy2")}</td>
                  <td style={{ padding: 6 }}>{field(r, "rsi_sell")}</td>
                  <td style={{ padding: 6 }}>{onOff(field(r, "macd_exit"))}</td>
                  <td style={{ padding: 6 }}>{onOff(field(r, "trend_filter"))}</td>
                  <td style={{ padding: 6 }}>{field(r, "trades")}</td>
                  <td style={{ padding: 6, fontWeight: 700 }}>{field(r, "win_rate")}%</td>
                  <td style={{ padding: 6 }}>{field(r, "avg_return_pct")}%</td>
                  <td style={{ padding: 6 }}>{field(r, "total_return_pct")}%</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ color: "#4b5563", fontSize: 13, lineHeight: 1.6, marginTop: 10 }}>
            <div>买入线：相对强弱跌到这个数，先买一半仓。</div>
            <div>补仓线：再跌到这个数，加到七成仓。不是等它涨回去。</div>
            <div>卖出线：相对强弱涨过这个数就卖。</div>
            <div>转弱就卖：开，表示红柱变成绿柱时也卖；关，表示不看这个。</div>
            <div>破均线就走：开，表示价格跌破50日均线就清仓，并且先不买新的；关，表示不看均线。</div>
            <div>笔数：这段时间里做完的买卖次数。</div>
            <div>胜率：这些买卖里，卖出价高于买入价的占比。</div>
            <div>平均每笔：每一笔卖掉时赚或亏的百分比，再取平均。不是留存率。</div>
            <div>一共赚亏：这些买卖前后接起来，整段时间总共赚或亏的百分比。也不是留存率。</div>
          </div>
        </div>
      )}
    </div>
  )
}
