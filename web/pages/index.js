import { useEffect, useMemo, useState } from "react"
import PriceChart from "../components/PriceChart"

const API = ""
const RANGES = [
  { id: "1w", label: "1周", days: 7 },
  { id: "1m", label: "1个月", days: 31 },
  { id: "3m", label: "3个月", days: 92 },
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

function sameBars(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
  const x = a[a.length - 1]
  const y = b[b.length - 1]
  if (!x || !y) return false
  return x.date === y.date && x.open === y.open && x.high === y.high && x.low === y.low && x.close === y.close && x.volume === y.volume
}

function clock(d) {
  if (!d) return ""
  const p = (n) => String(n).padStart(2, "0")
  return p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds())
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
  const [updated, setUpdated] = useState(null)
  const [sym, setSym] = useState("etf_510500")
  const [range, setRange] = useState("1y")
  const [ai, setAi] = useState(null)
  const [aiLoading, setAiLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    let backtestAt = 0
    const load = async (first) => {
      if (first) {
        setSig(null); setBt(null); setOrder(null); setBars(null); setErr(null); setAi(null)
      }
      const jobs = [
        ["信号", `${API}/api/signals/${sym}`, setSig],
        ["图", `${API}/api/chart/${sym}`, (body) => {
          setBars(prev => sameBars(prev, body) ? prev : body)
        }],
        ["限价", `${API}/api/orders/suggest?symbol=${sym}`, setOrder],
      ]
      const now = Date.now()
      if (first || now - backtestAt > 5 * 60 * 1000) {
        backtestAt = now
        jobs.push(["回测", `${API}/api/backtest?symbol=${sym}`, setBt])
      }
      const errs = []
      await Promise.all(jobs.map(async ([name, url, set]) => {
        try {
          const r = await fetch(url, { cache: "no-store" })
          const body = await r.json().catch(() => null)
          if (!r.ok) throw new Error(name + " " + r.status + (body?.error ? ": " + body.error : ""))
          if (cancelled) return
          set(body)
          if (body && body.error) errs.push(name + "：" + body.error)
        } catch (e) {
          errs.push(e.message || String(e))
        }
      }))
      if (cancelled) return
      setUpdated(new Date())
      if (errs.length && first) setErr(errs.join(" · "))
      if (!errs.length) setErr(null)
    }
    load(true)
    const timer = setInterval(() => load(false), 30000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [sym])

  const loadAi = async () => {
    setAiLoading(true)
    setAi(null)
    try {
      const r = await fetch(`${API}/api/ai-recommend/${sym}`, { cache: "no-store" })
      const body = await r.json().catch(() => null)
      if (!r.ok) throw new Error(body?.error || ("HTTP " + r.status))
      if (body && body.error) {
        setAi(body)
      } else {
        setAi(body)
      }
    } catch (e) {
      setAi({ error: e.message || String(e) })
    } finally {
      setAiLoading(false)
    }
  }

  const days = RANGES.find(r => r.id === range)?.days
  const view = useMemo(() => sliceRange(Array.isArray(bars) ? bars : [], days), [bars, days])
  const chartError = bars && !Array.isArray(bars) && bars.error

  const todayClose = field(order, "today_close")
  const todayRsi = field(order, "today_rsi")
  const asOf = field(order, "as_of")
  const phase = field(order, "phase") || ""
  const ladder = field(order, "ladder") || []
  const note = field(order, "note")
  const results = field(bt, "results")
  const cards = sig && !sig.error
    ? Object.entries(sig).filter(([k, v]) => v != null && v !== "" && !k.startsWith("_"))
    : []
  const boxTitle = phase === "减仓" ? "减仓" : phase === "持有" ? "先拿着" : phase === "空仓" ? "空仓" : "分批买入"

  return (
    <div style={{ fontFamily: "system-ui", maxWidth: 1180, margin: "0 auto", padding: 24 }}>
      <h1>中证500波段</h1>
      <div style={{ color: "#6b7280", fontSize: 13, marginTop: -8, marginBottom: 12 }}>
        当前页每 30 秒自己更新，不用刷新。{updated ? " 上次更新 " + clock(updated) : ""}
      </div>
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

      {cards.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 12 }}>
            {cards.map(([k, v]) => (
              <div key={k} style={{ border: k === "建议仓位" ? "2px solid #16a34a" : "1px solid #e5e7eb", borderRadius: 8, padding: 12, background: k === "建议仓位" ? "#f0fdf4" : "#fff" }}>
                <div style={{ color: "#6b7280", fontSize: 12 }}>{k}</div>
                <div style={{ fontSize: k === "建议仓位" ? 26 : 20, fontWeight: 700 }}>{v}</div>
              </div>
            ))}
          </div>
          <div style={{ color: "#4b5563", fontSize: 13, lineHeight: 1.6, marginTop: 8 }}>
            越低买得越多：跌到25买一成，到20拿到三成，到15拿到四成，低于10拿到六成。买进之后，回到50以下都不卖，高于25也不会清成空仓。高于50开始减：50到55留八成，55到60留一半，60到65留两成，65到70留一成。高于70才空仓。
          </div>
        </div>
      )}

      <div style={{ margin: "20px 0 28px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
          <h2 style={{ margin: "0 0 8px" }}>走势</h2>
          <div>
            {RANGES.map(r => (
              <button key={r.id} onClick={() => setRange(r.id)}
                style={{ marginLeft: 6, marginBottom: 6, padding: "4px 10px", borderRadius: 6, border: range === r.id ? "2px solid #2563eb" : "1px solid #ccc", background: range === r.id ? "#dbeafe" : "#fff" }}>{r.label}</button>
            ))}
          </div>
        </div>
        {chartError ? (
          <div style={{ padding: 24, color: "#dc2626" }}>图加载失败：{chartError}</div>
        ) : view.length > 0 ? (
          <PriceChart rows={view} />
        ) : (
          <div style={{ padding: 24, color: "#6b7280" }}>图还在加载…</div>
        )}
      </div>

      {order && !order.error && (
        <div style={{ border: "1px solid #86efac", borderRadius: 8, padding: 16, marginBottom: 24, background: "#f0fdf4" }}>
          <b>{boxTitle}</b>
          <div style={{ margin: "6px 0 10px" }}>
            截至 {asOf} 收盘 <b>{todayClose}</b>，相对强弱 <b>{todayRsi}</b>。
          </div>
          {ladder.length > 0 && (
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
          )}
          <div style={{ marginTop: 8, color: "#4b5563", fontSize: 13 }}>{note}</div>
        </div>
      )}

      <div style={{ border: "1px solid #bfdbfe", borderRadius: 8, padding: 16, marginBottom: 24, background: "#eff6ff" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <b>AI 技术分析建议</b>
          <button onClick={loadAi} disabled={aiLoading}
            style={{ padding: "6px 14px", borderRadius: 6, border: "1px solid #2563eb", background: aiLoading ? "#dbeafe" : "#2563eb", color: "#fff", cursor: aiLoading ? "wait" : "pointer" }}>
            {aiLoading ? "生成中…" : "生成建议"}
          </button>
        </div>
        {ai?.error && <div style={{ color: "#dc2626", whiteSpace: "pre-wrap" }}>{ai.error}</div>}
        {ai?.recommendation && (
          <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.6, color: "#1e3a8a" }}>
            {ai.recommendation}
          </div>
        )}
        {!ai && !aiLoading && <div style={{ color: "#6b7280", fontSize: 13 }}>点击按钮，把当前 RSI / MACD / KDJ / Z值 等指标喂给本地模型生成建议。</div>}
      </div>

      {results && (
        <div>
          <h2>另一组历史试验</h2>
          <p style={{ color: "#4b5563", fontSize: 13, marginTop: 0 }}>
            这张表不是上面的建议仓位。它比的是旧规则：跌到买入线买一半，再跌到补仓线加到七成。「破均线就走」打开时，跌破50日均线会变成空仓，所以会跟上面的建议不一样。区间 {field(bt, "period")}，共 {field(bt, "n_bars")} 根日线。
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
            <div>胜率：卖出价高于买入价的占比。</div>
            <div>平均每笔：每一笔卖掉时赚或亏的百分比，再取平均。不是留存率。</div>
            <div>一共赚亏：这些买卖前后接起来，整段时间总共赚或亏的百分比。也不是留存率。</div>
          </div>
        </div>
      )}
    </div>
  )
}
