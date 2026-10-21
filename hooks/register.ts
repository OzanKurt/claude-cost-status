import type { EngineInterface, Register } from 'claude-code'

const REFRESH_MS = 30_000

// Daily and monthly totals, filled by scripts/totals.cjs as it rescans the transcripts.
let totals: { today: number; month: number } | undefined

const usd = (value: number) => `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

// Shows the session's own cost next to today's and this month's totals.
async function refresh($: EngineInterface) {
  const usage = await $.session.usage()
  const parts: string[] = []
  if (usage.cost) parts.push(`${usd(usage.cost.usd)} session`)
  if (totals) parts.push(`${usd(totals.today)} today`, `${usd(totals.month)} month`)
  $.ui.status(parts.length ? parts.join(' | ') : undefined)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    $.clock.every(REFRESH_MS, () => void refresh($).catch(() => {}))
    await refresh($).catch(() => {})

    // The child lives as long as this module; it prints one JSON line per scan.
    void (async () => {
      let buffered = ''
      const child = $.process.spawn({ argv: ['node', `${$.plugin.root}/scripts/totals.cjs`] })
      for await (const { stream, text } of child) {
        if (stream !== 'stdout') continue
        const lines = (buffered + text).split('\n')
        buffered = lines.pop() ?? ''
        const last = lines.filter(Boolean).pop()
        if (!last) continue
        try {
          totals = JSON.parse(last)
          await refresh($)
        } catch {
          // Skip a malformed line; the next scan prints another.
        }
      }
    })().catch(() => {})

    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    await refresh($).catch(() => {})
    return result
  })
}
