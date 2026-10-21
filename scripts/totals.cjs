// Sums today's and this month's API cost from ~/.claude/projects transcripts.
// Runs for the session's life: one full scan of this month's files, then every
// 30 s reads only the bytes appended since. Prints one JSON line per scan.
const fs = require('fs')
const os = require('os')
const path = require('path')

const PROJECTS = path.join(os.homedir(), '.claude', 'projects')
const INTERVAL_MS = 30_000
const CHUNK = 16 * 1024 * 1024

// USD per million tokens: input, output, 5m cache write, 1h cache write, cache read (LiteLLM, 2026-10).
const PRICES = {
  'claude-opus-5-5': [4, 20, 5, 8, 0.2],
  'claude-opus-5': [5, 25, 6.25, 10, 0.5],
  'claude-opus-4-8': [5, 25, 6.25, 10, 0.5],
  'claude-sonnet-5-5': [2, 10, 2.5, 4, 0.1],
  'claude-sonnet-5': [2, 10, 2.5, 4, 0.2],
  'claude-fable-5-1': [10, 50, 12.5, 20, 0.25],
  'claude-fable-5': [10, 50, 12.5, 20, 1],
  'claude-haiku-5-5': [0.1, 0.5, 0.125, 0.2, 0.01],
  'claude-haiku-4-5': [1, 5, 1.25, 2, 0.1],
}
const PRICE_KEYS = Object.keys(PRICES).sort((a, b) => b.length - a.length)

let month = ''
let files = new Map()
let seen = new Map()
let perDay = new Map()
let unknown = new Set()

const dayOf = date =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

function priceOf(model) {
  const key = PRICE_KEYS.find(k => model.startsWith(k))
  return key ? PRICES[key] : undefined
}

function costOf(entry) {
  if (typeof entry.costUSD === 'number') return entry.costUSD
  const { model, usage } = entry.message
  const price = priceOf(model)
  if (!price) {
    unknown.add(model)
    return 0
  }
  const [input, output, write5m, write1h, read] = price
  const split = usage.cache_creation
  const tokens5m = split ? split.ephemeral_5m_input_tokens || 0 : usage.cache_creation_input_tokens || 0
  const tokens1h = split ? split.ephemeral_1h_input_tokens || 0 : 0
  return (
    ((usage.input_tokens || 0) * input +
      (usage.output_tokens || 0) * output +
      tokens5m * write5m +
      tokens1h * write1h +
      (usage.cache_read_input_tokens || 0) * read) /
    1e6
  )
}

function addLine(line, monthStart) {
  if (!line.includes('"usage"') || !line.includes('"assistant"')) return
  let entry
  try {
    entry = JSON.parse(line)
  } catch {
    return
  }
  const message = entry.message
  if (entry.type !== 'assistant' || !message || !message.usage || !message.model || message.model === '<synthetic>') return
  const at = new Date(entry.timestamp)
  if (!(at.getTime() >= monthStart)) return
  const day = dayOf(at)
  const cost = costOf(entry)
  // One response is logged once per content block, early lines with partial usage: count its largest.
  if (message.id && entry.requestId) {
    const key = `${message.id}:${entry.requestId}`
    const counted = seen.get(key)
    if (counted && counted.cost >= cost) return
    if (counted) perDay.set(counted.day, perDay.get(counted.day) - counted.cost)
    seen.set(key, { day, cost })
  }
  perDay.set(day, (perDay.get(day) || 0) + cost)
}

function readNew(file, size, monthStart) {
  const state = files.get(file) || { offset: 0, partial: '' }
  if (size < state.offset) Object.assign(state, { offset: 0, partial: '' })
  const fd = fs.openSync(file, 'r')
  try {
    const buffer = Buffer.alloc(Math.min(CHUNK, size - state.offset))
    while (state.offset < size) {
      const read = fs.readSync(fd, buffer, 0, Math.min(buffer.length, size - state.offset), state.offset)
      if (read <= 0) break
      state.offset += read
      const lines = (state.partial + buffer.toString('utf8', 0, read)).split('\n')
      state.partial = lines.pop()
      for (const line of lines) addLine(line, monthStart)
    }
  } finally {
    fs.closeSync(fd)
  }
  files.set(file, state)
}

function walk(dir, monthStart) {
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(full, monthStart)
      continue
    }
    if (!entry.name.endsWith('.jsonl')) continue
    try {
      const stat = fs.statSync(full)
      if (stat.mtimeMs < monthStart) continue
      if (stat.size > (files.get(full)?.offset || 0) || stat.size < (files.get(full)?.offset || 0)) {
        readNew(full, stat.size, monthStart)
      }
    } catch {
      // A file removed or locked mid-scan is picked up on the next pass.
    }
  }
}

function scan() {
  const now = new Date()
  const thisMonth = dayOf(now).slice(0, 7)
  if (thisMonth !== month) {
    month = thisMonth
    files = new Map()
    seen = new Map()
    perDay = new Map()
    unknown = new Set()
  }
  walk(PROJECTS, new Date(now.getFullYear(), now.getMonth(), 1).getTime())
  let total = 0
  for (const cost of perDay.values()) total += cost
  process.stdout.write(
    JSON.stringify({ today: perDay.get(dayOf(now)) || 0, month: total, unknown: [...unknown] }) + '\n',
  )
}

function loop() {
  try {
    scan()
  } catch (error) {
    process.stderr.write(String(error) + '\n')
  }
  setTimeout(loop, INTERVAL_MS)
}

loop()
