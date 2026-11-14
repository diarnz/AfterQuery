/** WCAG 2.1 AA contrast gate for the design tokens (frontend blueprint §5). */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Vitest runs from the web/ package root (see vite.config.ts).
const css = readFileSync(resolve(process.cwd(), 'src/ui/styles/tokens.css'), 'utf8')

function block(selector: string): Record<string, string> {
  const start = css.indexOf(selector)
  if (start === -1) throw new Error(`Missing ${selector}`)
  const open = css.indexOf('{', start)
  let depth = 0
  let end = open
  for (; end < css.length; end += 1) {
    if (css[end] === '{') depth += 1
    if (css[end] === '}' && --depth === 0) break
  }
  const body = css.slice(open + 1, end)
  return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*(#[0-9a-f]{6})/gi)].map((match) => [match[1], match[2]]))
}

function luminance(hex: string): number {
  const channel = (offset: number) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5)
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (light + 0.05) / (dark + 0.05)
}

const TEXT = ['--text-primary', '--text-secondary', '--text-muted', '--accent-brass-strong', '--status-ok', '--status-error', '--status-notice', '--status-pending', '--status-infra']
const SURFACES = ['--bg-canvas', '--bg-panel', '--bg-raised', '--bg-inset']

const themes = {
  dark: block(':root {'),
  parchment: block(":root[data-theme='parchment']"),
  'system light': block(":root:not([data-theme='dark'])"),
}

describe.each(Object.entries(themes))('%s theme', (_name, tokens) => {
  it.each(TEXT.flatMap((text) => SURFACES.map((surface) => [text, surface] as const)))('%s on %s is at least 4.5:1', (text, surface) => {
    const fg = tokens[text]
    const bg = tokens[surface]
    expect(fg, text).toBeDefined()
    expect(bg, surface).toBeDefined()
    expect(contrast(fg as string, bg as string)).toBeGreaterThanOrEqual(4.5)
  })

  it('primary button text is at least 4.5:1 on brass', () => {
    expect(contrast(tokens['--on-brass'] as string, tokens['--accent-brass'] as string)).toBeGreaterThanOrEqual(4.5)
  })

  it('map ink is at least 3:1 on water (non-text graphics)', () => {
    expect(contrast(tokens['--map-ink'] as string, tokens['--map-water'] as string)).toBeGreaterThanOrEqual(3)
  })
})

it('the system-light block matches the explicit parchment theme', () => {
  expect(themes['system light']).toEqual(themes.parchment)
})
