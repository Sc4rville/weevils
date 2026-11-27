// @vitest-environment happy-dom
// Setup buttons and questions speak in plain words: no raw variable names (OPENAI_API_KEY), no « empty: root », no
// « siri address ». The same actions stay: the masked field opens, the Siri word still installs the Shortcut.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const calls = vi.hoisted(() => ({ shortcut: 0, asked: [] as string[], state: 'field' as 'found' | 'link' | 'field' }))
vi.mock('../api', () => ({
  api: {
    setupKeyAsk: async (name: string) => (calls.asked.push(name), { ok: true, state: calls.state }),
    voices: async () => ({ voices: [{ id: 'v1', name: 'Ada' }], current: 'v1' }),
    shortcut: async () => (calls.shortcut++, { token: 't', url: '' }),
    setVoice: async () => ({}),
  },
}))

const { setLang, tr } = await import('../i18n')
const S = (await import('../i18n/setup')).default
const { KeyChip, SetupComposer, Chip } = await import('./setup')
const { VoicePicker } = await import('./voice')
const { chipLabel } = await import('./format')

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: Root, host: HTMLDivElement
beforeEach(() => {
  setLang('en')
  calls.shortcut = 0
  calls.asked = []
  calls.state = 'field'
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  setLang(null)
})
const render = async (node: React.ReactNode) => {
  await act(async () => root.render(node))
  await act(async () => new Promise((r) => setTimeout(r, 10)))
}

it('a requested secret is named by its brand, never by its variable, and still opens the masked field', async () => {
  await render(
    <>
      <KeyChip name="OPENAI_API_KEY" />
      <SetupComposer />
    </>,
  )
  const chip = host.querySelector('button')!
  expect(chip.textContent?.trim()).toBe('paste your OpenAI key')
  await act(async () => chip.click())
  const form = host.querySelector('form.setup-form')!
  expect(form.textContent).toContain('your OpenAI key')
  expect(host.textContent).not.toContain('OPENAI_API_KEY')
  // The page that creates the key sits next to the field: one tap, never « go to your settings ».
  const page = form.querySelector<HTMLAnchorElement>('a.setup-page')!
  expect(page.textContent).toBe('create it here')
  expect(page.href).toBe('https://platform.openai.com/api-keys')
  expect(page.target).toBe('_blank')
  expect(chipLabel('key:HF_TOKEN')).toBe('paste your Hugging Face token')
  // A provider that signs in by a link is never « paste ».
  expect(chipLabel('key:GITHUB_TOKEN')).toBe('connect GitHub')
  expect(chipLabel('key:NPM_TOKEN')).toBe('connect npm')
  setLang('fr')
  expect(chipLabel('key:GITHUB_TOKEN')).toBe('connecter GitHub')
  expect(chipLabel('key:HF_TOKEN')).toBe('colle ton jeton Hugging Face')
  expect(chipLabel('key:OPENAI_API_KEY')).toBe('colle ta clé OpenAI')
})

it('a key found on the machine closes the field by itself: nothing to paste', async () => {
  calls.state = 'found'
  await render(
    <>
      <KeyChip name="RUNPOD_API_KEY" />
      <SetupComposer />
    </>,
  )
  await act(async () => host.querySelector('button')!.click())
  await act(async () => new Promise((r) => setTimeout(r, 10)))
  expect(calls.asked).toEqual(['RUNPOD_API_KEY'])
  expect(host.querySelector('form.setup-form')).toBeNull()
})

it('a sign-in by link never opens a field; the field comes only when the sign-in could not start', async () => {
  calls.state = 'link'
  await render(
    <>
      <KeyChip name="NPM_TOKEN" />
      <SetupComposer />
    </>,
  )
  expect(host.querySelector('button')!.textContent?.trim()).toBe('connect npm')
  await act(async () => host.querySelector('button')!.click())
  await act(async () => new Promise((r) => setTimeout(r, 10)))
  expect(host.querySelector('form.setup-form')).toBeNull()
  calls.state = 'field'
  await act(async () => host.querySelector('button')!.click())
  await act(async () => new Promise((r) => setTimeout(r, 10)))
  expect(host.querySelector('form.setup-form')).not.toBeNull()
})

it('machine and domain questions say what leaving them empty means, without shorthand', () => {
  for (const lang of ['en', 'fr'] as const) {
    setLang(lang)
    const t = tr(S)
    for (const q of [t.q_machine_user, t.q_machine_password, t.q_reach_domain]) {
      expect(q).not.toMatch(/\((empty|vide) ?: root\)|my key|ma clé/)
    }
  }
})

it('the Siri buttons say « add to Siri » and still install the Shortcut', async () => {
  await render(<Chip brick="shortcut" />)
  expect(host.textContent).toContain('add to Siri')
  expect(host.textContent).not.toMatch(/address/)
  await render(<VoicePicker userName="" />)
  const word = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('add to Siri'))!
  expect(word).toBeTruthy()
  await act(async () => word.click())
  expect(calls.shortcut).toBe(1)
})
