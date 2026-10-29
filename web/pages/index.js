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

export default function Home() {
  const [bars, setBars] = useState(null)
  const [err, setErr] = useState(null)
  const [updated, setUpdated] = useState(null)
  const [sym, setSym] = useState("etf_510500")
  const [range, setRange] = useState("1y")
  const [ai, setAi] = useState(null)
  const [aiLoading, setAiLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    const load = async (first) => {
      if (first) {
        setBars(null); setErr(null); setAi(null)
      }
      try {
        const r = await fetch(`${API}/api/chart/${sym}`, { cache: "no-store" })
        const body = await r.json().catch(() => null)
        if (!r.ok) throw new Error("图 " + r.status + (body?.error ? ": " + body.error : ""))
        if (cancelled) return
        setBars(prev => sameBars(prev, body) ? prev : body)
        if (body && body.error) setErr(body.error)
        else setErr(null)
      } catch (e) {
        if (!cancelled) setErr(e.message || String(e))
      }
      if (!cancelled) setUpdated(new Date())
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
      setAi(body)
    } catch (e) {
      setAi({ error: e.message || String(e) })
    } finally {
      setAiLoading(false)
    }
  }

  const days = RANGES.find(r => r.id === range)?.days
  const view = useMemo(() => sliceRange(Array.isArray(bars) ? bars : [], days), [bars, days])
  const chartError = bars && !Array.isArray(bars) && bars.error

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
    </div>
  )
}
