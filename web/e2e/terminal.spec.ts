import { createRequire } from 'node:module'
import { expect, test, type Page } from '@playwright/test'

const axePath = createRequire(import.meta.url).resolve('axe-core')

async function axeViolations(page: Page): Promise<string[]> {
  await page.addScriptTag({ path: axePath })
  return page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run(context: Document): Promise<{ violations: { id: string; nodes: { target: string[] }[] }[] }> } }).axe
    const results = await axe.run(document)
    return results.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`)
  })
}

async function startRun(page: Page, policy: string) {
  await page.goto('/')
  const policySelect = page.getByLabel('Model / policy')
  await expect(policySelect).toBeEnabled()
  await policySelect.selectOption(policy)
  await page.getByRole('button', { name: /Start run/ }).click()
  await expect(page).toHaveURL(/\/runs\/[0-9a-f-]{36}$/)
  return page.url()
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => window.localStorage.clear())
})

test('reference run streams from the API, replays, and explains a decision', async ({ page }) => {
  await startRun(page, 'reference')
  await expect(page.getByText('0.850429')).toBeVisible()
  await expect(page.getByText('All obligations met')).toBeVisible()

  // Replay to the round-2 dispatch: the closed canal and the in-transit barge come from the server snapshot.
  await page.getByRole('slider', { name: 'Step' }).fill('3')
  await expect(page.getByText('Step 3 / 5')).toBeVisible()
  await expect(page.getByRole('button', { name: /^Route short-canal, west to east, closed/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Vessel barge-a, in transit to east, arriving r4/ })).toBeVisible()

  await page.keyboard.press('e')
  const drawer = page.getByRole('dialog', { name: 'Step 3 · Commit at round 2' })
  await expect(drawer.getByText('Dispatch barge-a via outer-canal · cloth-east ×4')).toBeVisible()
  expect(await axeViolations(page)).toEqual([])
  await page.keyboard.press('Escape')
  await expect(drawer).toBeHidden()

  // The run survives a reload because it is recorded in this browser.
  await page.reload()
  await expect(page.getByText('Step 3 / 5')).toBeVisible()
  expect(await axeViolations(page)).toEqual([])
})

test('baselines compare against the reference with a pinned first divergence', async ({ page }) => {
  const reference = (await startRun(page, 'reference')).split('/').pop() ?? ''
  await expect(page.getByText('0.850429')).toBeVisible()
  const stopEarly = (await startRun(page, 'stop-early')).split('/').pop() ?? ''
  await expect(page.getByText('0.075000')).toBeVisible()

  await page.goto(`/compare?a=${stopEarly}&b=${reference}`)
  await expect(page.getByText('First divergence at round 1')).toBeVisible()
  expect(await axeViolations(page)).toEqual([])

  await page.goto('/runs')
  await expect(page.getByRole('table', { name: /Runs recorded in this browser/ }).getByRole('row')).toHaveCount(3)
})

test('generated scenario with a chosen seed reports the seed it ran', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel(/Environment/).selectOption('reactive_closure')
  await page.getByLabel('Seed').fill('42')
  await page.getByRole('button', { name: /Start run/ }).click()
  await expect(page.getByText(/Planner estimate/)).toBeVisible()
  await expect(page.locator('.run-facts')).toContainText('42')
})

test('the idle terminal is a console that echoes choices, with no horizontal scrolling or accessibility violations', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByLabel('Model / policy')).toBeEnabled()
  const log = page.getByRole('log', { name: 'Session console' })
  await expect(log).toContainText('catalog loaded from /openapi.json')
  await expect(page.getByRole('region', { name: 'Action trace' })).toHaveCount(0)
  await page.getByLabel('Model / policy').selectOption('idle')
  await expect(log).toContainText('model selected: idle # Idle baseline (does nothing)')
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow).toBeLessThanOrEqual(0)
  expect(await axeViolations(page)).toEqual([])
})

test('parchment theme passes contrast checks on a finished run', async ({ page }) => {
  await startRun(page, 'stop-early')
  await expect(page.getByText('0.075000')).toBeVisible()
  await page.keyboard.press('t')
  await page.keyboard.press('t')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'parchment')
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow).toBeLessThanOrEqual(0)
  expect(await axeViolations(page)).toEqual([])
})
