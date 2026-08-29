/**
 * Session Pulse v2 — gateway/session activity + live context & cost for the
 * Hermes desktop app. Chip: gateway dot, model, context %, est spend.
 * Pane: state rows, context gauge, token split (in/cache/out), est spend at
 * z.ai GLM rates, live event log.
 * Loads from <desktop-app-machine> $HERMES_HOME/desktop-plugins/session-pulse/.
 */

import { cn, haptic, host, Tip, useValue } from '@hermes/plugin-sdk'
import { useEffect, useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

const MAX_EVENTS = 60

// ---- z.ai GLM pricing (USD per 1M tokens: [input, cached-input, output]) ----
// Source: docs.z.ai/guides/overview/pricing (verified 2026-08-28).
// GLM-5.3-Flash runs a 50% promo through 2026-09-09 16:00 UTC; list after.
const FLASH_PROMO_END = Date.UTC(2026, 8, 9, 16, 0, 0)
const RATES = {
  'glm-5.3-flash': [0.075, 0.015, 0.25],
  'glm-5.3-flash@list': [0.15, 0.03, 0.5],
  'glm-5.3': [1.4, 0.26, 4.4],
  'glm-5.2': [1.4, 0.26, 4.4],
  'glm-5.1': [1.4, 0.26, 4.4],
  'glm-5-turbo': [1.2, 0.24, 4.0],
  'glm-5': [1.0, 0.2, 3.2],
  'glm-4.7-flashx': [0.07, 0.01, 0.4],
  'glm-4.7': [0.6, 0.11, 2.2],
  'glm-4.6v': [0.3, 0.05, 0.9],
  'glm-4.6-flashx': [0.04, 0.004, 0.4],
  'glm-4.6': [0.6, 0.11, 2.2],
  'glm-4.5': [0.6, 0.11, 2.2]
}
const RATE_ORDER = [
  'glm-5.3-flash', 'glm-5.3', 'glm-5.2', 'glm-5.1', 'glm-5-turbo', 'glm-5',
  'glm-4.7-flashx', 'glm-4.7', 'glm-4.6v', 'glm-4.6-flashx', 'glm-4.6', 'glm-4.5'
]
// DeepSeek bills peak vs off-peak (off = half): peak is Mon-Fri 01:00-04:00
// and 06:00-10:00 UTC. Source: api-docs.deepseek.com/quick_start/pricing.
function deepSeekOffPeak(now) {
  const d = now.getUTCDay()
  const h = now.getUTCHours()
  const peak = d >= 1 && d <= 5 && ((h >= 1 && h < 4) || (h >= 6 && h < 10))
  return !peak
}

function ratesFor(modelStr) {
  const s = String(modelStr || '').toLowerCase()
  for (const key of RATE_ORDER) {
    if (s.includes(key)) {
      if (key === 'glm-5.3-flash' && Date.now() > FLASH_PROMO_END) {
        return { rates: RATES['glm-5.3-flash@list'], label: 'glm-5.3-flash list' }
      }
      return { rates: RATES[key], label: key + (key === 'glm-5.3-flash' ? ' promo' : '') }
    }
  }
  // Codex models ride the ChatGPT subscription backend — no per-token billing.
  if (s.includes('codex') || (s.includes('@http') && s.includes('chatgpt'))) {
    return { rates: null, included: true, label: 'codex (ChatGPT plan)' }
  }
  if (s.includes('deepseek')) {
    const off = deepSeekOffPeak(new Date())
    const tag = off ? ' off-peak' : ' peak'
    if (s.includes('pro')) {
      return { rates: off ? [0.66, 0.022, 1.98] : [1.32, 0.044, 3.96], label: 'deepseek-v4-pro' + tag }
    }
    if (s.includes('v4-flash') || s.includes('chat') || s.includes('reasoner') || s.includes('vision')) {
      return { rates: off ? [0.22, 0.007, 0.66] : [0.44, 0.014, 1.32], label: 'deepseek-v4-flash' + tag }
    }
    return { rates: null, label: 'deepseek (unknown variant)' }
  }
  // Unknown model: refuse to guess rather than price it at GLM rates.
  return { rates: null, label: 'no rates' }
}

function fmt(v) {
  if (v == null) return '—'
  if (typeof v === 'string') return v || '—'
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  const named = v.name || v.label || v.id || v.model || v.path
  return String(named ?? JSON.stringify(v).slice(0, 40))
}

function shortModel(m) {
  const s = fmt(m)
  return s.length > 22 ? s.slice(0, 21) + '…' : s
}

function fmtTok(n) {
  if (n == null) return '—'
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k'
  return String(Math.round(n))
}

function fmtUsd(n) {
  if (n == null) return '—'
  return '$' + (n >= 1 ? n.toFixed(2) : n.toFixed(4))
}

// cache-read tokens are billed separately but reported merged into `total`:
// cached ≈ total − input − output (clamped at 0).
function splitUsage(u) {
  if (!u) return null
  const input = Number(u.input) || 0
  const output = Number(u.output) || 0
  const total = Number(u.total) || 0
  const cached = Math.max(0, total - input - output)
  return { input, output, total, cached }
}

function costOf(split, rates) {
  if (!split) return null
  return (
    (split.input * rates[0] + split.cached * rates[1] + split.output * rates[2]) / 1e6
  )
}

function Dot({ ok }) {
  return jsx('span', {
    className: cn(
      'inline-block size-1.5 shrink-0 rounded-full',
      ok ? 'bg-(--ui-accent)' : 'bg-(--ui-text-quaternary)'
    )
  })
}

function Row({ label, value, hint }) {
  return jsxs('div', {
    className: 'flex items-center justify-between gap-2',
    children: [
      jsx('span', { className: 'text-(--ui-text-quaternary)', children: label }),
      jsxs('span', {
        className: 'truncate text-(--ui-text-secondary)',
        children: [value, hint ? jsx('span', { className: 'text-(--ui-text-quaternary)', children: ' ' + hint }) : null]
      })
    ]
  })
}

function Gauge({ pct }) {
  const p = Math.max(0, Math.min(100, pct || 0))
  return jsx('div', {
    className: 'h-1 w-full overflow-hidden rounded-full bg-(--ui-stroke-secondary)',
    children: jsx('div', {
      className: 'h-full rounded-full bg-(--ui-accent) transition-all',
      style: { width: p.toFixed(1) + '%' }
    })
  })
}

// Shared: live usage when streaming, chars/4 estimate when idle (one cheap
// session.context_breakdown fetch per focus/busy change, no provider call).
function useCtxInfo() {
  const usage = useValue(host.state.focusedUsage)
  const focusedId = useValue(host.state.focusedSessionId)
  const busy = useValue(host.state.busy)
  const [bd, setBd] = useState(null)
  useEffect(() => {
    if (!focusedId || busy) return
    let cancelled = false
    host
      .request('session.context_breakdown', { session_id: focusedId })
      .then((b) => {
        if (!cancelled && b) setBd(b)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [focusedId, busy])
  const pct = usage && usage.context_percent != null ? usage.context_percent : bd ? bd.context_percent : null
  const used = usage && usage.context_used != null ? usage.context_used : bd ? bd.context_used : null
  const max = usage && usage.context_max != null ? usage.context_max : bd ? bd.context_max : null
  const basis = usage && usage.context_percent != null ? 'measured' : bd ? 'est' : null
  return { usage, pct, used, max, basis }
}

function PulseChip() {
  const gateway = useValue(host.state.gateway)
  const model = useValue(host.state.model)
  const ctx = useCtxInfo()
  const gw = fmt(gateway)
  const ok = Boolean(gateway) && !/disconn|error|off/i.test(gw)
  const split = splitUsage(ctx.usage)
  const priced = ratesFor(model)
  const spend = split && priced.rates ? costOf(split, priced.rates) : null
  const bits = ['pulse']
  if (ctx.used != null) bits.push(fmtTok(ctx.used) + ' tok')
  if (ctx.pct != null) bits.push(Math.round(ctx.pct) + '%')
  if (spend != null) bits.push(fmtUsd(spend))
  else if (priced.included) bits.push('plan')
  return jsx(Tip, {
    label: 'Session Pulse — gateway, context & est spend (focused session)',
    children: jsx('button', {
      className: cn(
        'inline-flex h-full items-center gap-1 px-1.5 text-[0.6875rem] transition-colors',
        'text-(--ui-text-tertiary) hover:bg-(--chrome-action-hover) hover:text-foreground'
      ),
      type: 'button',
      onClick: () => {
        haptic('tap')
        host.notify({
          kind: 'info',
          message: `Session Pulse — gateway: ${gw} · model: ${fmt(model)}` +
            (ctx.pct != null ? ` · ctx: ${Math.round(ctx.pct)}% (${fmtTok(ctx.used)} tok)` : '') +
            (spend != null ? ` · est spend: ${fmtUsd(spend)} (focused session)` : '')
        })
      },
      children: jsxs('span', {
        className: 'inline-flex items-center gap-1',
        children: [jsx(Dot, { ok }), jsx('span', { children: bits.join(' · ') })]
      })
    })
  })
}

function UsageBlock() {
  const model = useValue(host.state.model)
  const ctx = useCtxInfo()
  const split = splitUsage(ctx.usage)
  const { rates, label: rateLabel } = ratesFor(model)
  const spend = split && rates ? costOf(split, rates) : null

  const pct = ctx.pct
  const used = ctx.used
  const max = ctx.max
  const basis = ctx.basis

  return jsxs('div', {
    className: 'flex flex-col gap-1.5 px-3 py-3 text-xs',
    children: [
      jsxs('div', {
        className: 'flex items-center justify-between',
        children: [
          jsx('span', {
            className: 'text-[0.6875rem] uppercase tracking-wide text-(--ui-text-quaternary)',
            children: 'usage — focused session'
          }),
          basis
            ? jsx('span', { className: 'text-[0.625rem] text-(--ui-text-quaternary)', children: basis })
            : null
        ]
      }),
      jsxs('div', {
        className: 'flex flex-col gap-1',
        children: [
          jsx(Gauge, { pct }),
          jsxs('div', {
            className: 'flex justify-between text-[0.6875rem] text-(--ui-text-tertiary)',
            children: [
              jsx('span', { children: pct != null ? (Math.round(pct * 10) / 10) + '% context' : 'context: no data yet' }),
              jsx('span', { children: max ? `${fmtTok(used)} / ${fmtTok(max)}` : '' })
            ]
          })
        ]
      }),
      jsx(Row, { label: 'input', value: fmtTok(split && split.input), hint: 'tok' }),
      jsx(Row, { label: 'cached', value: fmtTok(split && split.cached), hint: 'tok' }),
      jsx(Row, { label: 'output', value: fmtTok(split && split.output), hint: 'tok' }),
      jsx(Row, {
        label: 'est spend',
        value:
          spend != null
            ? fmtUsd(spend)
            : priced.included
              ? 'plan (no per-token bill)'
              : '—',
        hint: spend != null ? `@ ${rateLabel}` : ''
      }),
      jsx('div', {
        className: 'text-[0.625rem] leading-4 text-(--ui-text-quaternary)',
        children: rates
          ? `${rateLabel} rates ${rates[0]}/${rates[1]}/${rates[2]} $/M (in/cache/out); cache ≈ total−in−out`
          : priced.included
            ? `${rateLabel} — ChatGPT plan: no per-token bill, but it burns your metered 5h Codex quota`
            : `${rateLabel} — add this model to the plugin's rate table to price it`
      })
    ]
  })
}

function PulsePane() {
  const gateway = useValue(host.state.gateway)
  const model = useValue(host.state.model)
  const profile = useValue(host.state.profile)
  const cwd = useValue(host.state.cwd)
  const [events, setEvents] = useState([])
  const gw = fmt(gateway)
  const ok = Boolean(gateway) && !/disconn|error|off/i.test(gw)

  useEffect(() => {
    const dispose = host.onEvent('*', (ev) => {
      const e = ev || {}
      const type = String(e.type || e.event || 'event')
      let preview = ''
      try {
        const payload = e.payload !== undefined ? e.payload : (e.data !== undefined ? e.data : e)
        preview = typeof payload === 'string' ? payload : JSON.stringify(payload)
      } catch {
        preview = ''
      }
      setEvents((prev) => {
        const entry = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          type,
          preview: (preview || '').slice(0, 90),
          at: new Date().toLocaleTimeString()
        }
        return [entry, ...prev].slice(0, MAX_EVENTS)
      })
    })
    return dispose
  }, [])

  return jsxs('div', {
    className: 'flex h-full flex-col text-sm',
    children: [
      jsxs('div', {
        className: 'flex items-center justify-between px-3 pt-3',
        children: [
          jsxs('div', {
            className: 'flex items-center gap-1.5',
            children: [
              jsx(Dot, { ok }),
              jsx('span', { className: 'font-medium', children: 'Session Pulse' })
            ]
          }),
          jsx('button', {
            className:
              'rounded px-1.5 py-0.5 text-[0.6875rem] text-(--ui-text-quaternary) transition-colors hover:bg-(--chrome-action-hover) hover:text-foreground',
            type: 'button',
            onClick: () => setEvents([]),
            children: 'clear'
          })
        ]
      }),
      jsx('div', {
        className: 'flex flex-col gap-1.5 px-3 py-3 text-xs',
        children: [
          jsx(Row, { label: 'gateway', value: gw }),
          jsx(Row, { label: 'model', value: shortModel(model) }),
          jsx(Row, { label: 'profile', value: fmt(profile) }),
          jsx(Row, { label: 'cwd', value: fmt(cwd) })
        ]
      }),
      jsx(UsageBlock, {}),
      jsx('div', {
        className:
          'border-t border-(--ui-stroke-secondary) px-3 pb-1 pt-2 text-[0.6875rem] uppercase tracking-wide text-(--ui-text-quaternary)',
        children: `events (${events.length})`
      }),
      jsx('div', {
        className: 'min-h-0 flex-1 overflow-y-auto px-3 pb-3',
        children:
          events.length === 0
            ? jsx('div', {
                className: 'py-4 text-xs text-(--ui-text-quaternary)',
                children: 'Waiting for gateway events…'
              })
            : jsx('div', {
                className: 'flex flex-col gap-1 pt-1',
                children: events.map((ev) =>
                  jsxs(
                    'div',
                    {
                      className: 'flex items-baseline gap-2 text-[0.6875rem]',
                      children: [
                        jsx('span', {
                          className: 'shrink-0 text-(--ui-text-quaternary)',
                          children: ev.at
                        }),
                        jsx('span', {
                          className: 'shrink-0 font-medium text-(--ui-accent)',
                          children: ev.type
                        }),
                        jsx('span', {
                          className: 'truncate text-(--ui-text-tertiary)',
                          children: ev.preview
                        })
                      ]
                    },
                    ev.id
                  )
                )
              })
      })
    ]
  })
}

export default {
  id: 'session-pulse',
  name: 'Session Pulse',
  register(ctx) {
    ctx.register({
      id: 'pane',
      area: 'panes',
      title: 'session pulse',
      data: { placement: 'right', width: '237px' },
      render: () => jsx(PulsePane, {})
    })

    ctx.register({
      id: 'chip',
      area: 'statusBar.right',
      order: 130,
      render: () => jsx(PulseChip, {})
    })
  }
}
