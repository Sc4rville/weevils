import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkKey, findKey, shellValue } from './key-sources.ts'

const home = () => fs.mkdtempSync(path.join(os.tmpdir(), 'keys-'))
const put = (dir: string, file: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
  fs.writeFileSync(path.join(dir, file), text)
}

describe('a key written in a shell file', () => {
  it('reads a plain value, quoted or not, the last one wins', () => {
    expect(shellValue('export OPENAI_API_KEY=sk-one\n', 'OPENAI_API_KEY')).toBe('sk-one')
    expect(shellValue('  export OPENAI_API_KEY="sk-two"  # mine\nOPENAI_API_KEY=\'sk-three\'\n', 'OPENAI_API_KEY')).toBe('sk-three')
    expect(shellValue('set -gx HF_TOKEN hf_fish\n', 'HF_TOKEN')).toBe('hf_fish')
  })
  it('never a comment, another name, or a value that would have to be run', () => {
    expect(shellValue('# export OPENAI_API_KEY=sk-old\n', 'OPENAI_API_KEY')).toBe('')
    expect(shellValue('export MY_OPENAI_API_KEY=sk-other\n', 'OPENAI_API_KEY')).toBe('')
    expect(shellValue('export OPENAI_API_KEY=$(pass show openai)\nexport OPENAI_API_KEY="$OTHER"\n', 'OPENAI_API_KEY')).toBe('')
  })
})

describe('a key already on the machine', () => {
  it('under its name in the environment, then in the shell files', () => {
    const h = home()
    expect(findKey('GROQ_API_KEY', h, {})).toBeNull()
    put(h, '.zshrc', 'export GROQ_API_KEY=gsk_0123456789abcdef\n') // gitleaks:allow a fake for the test
    expect(findKey('GROQ_API_KEY', h, {})).toEqual({ value: 'gsk_0123456789abcdef', from: 'shell' })
    expect(findKey('GROQ_API_KEY', h, { GROQ_API_KEY: 'gsk_fromTheService1234' })).toEqual({ value: 'gsk_fromTheService1234', from: 'shell' })
  })
  it('where the provider’s own tool keeps it: npm, Hugging Face, RunPod, Vast.ai, Codex with a key', () => {
    const h = home()
    put(h, '.npmrc', 'fund=false\n//registry.npmjs.org/:_authToken=npm_0123456789abcdef\n') // gitleaks:allow a fake
    put(h, '.cache/huggingface/token', 'hf_0123456789abcdef\n') // gitleaks:allow a fake for the test
    put(h, '.runpod/config.toml', 'apikey = "rpa_0123456789abcdef"\n') // gitleaks:allow a fake for the test
    put(h, '.codex/auth.json', JSON.stringify({ OPENAI_API_KEY: 'sk-0123456789abcdef', tokens: {} })) // gitleaks:allow a fake for the test
    expect(findKey('NPM_TOKEN', h, {})).toEqual({ value: 'npm_0123456789abcdef', from: 'tool' })
    expect(findKey('HF_TOKEN', h, {})).toEqual({ value: 'hf_0123456789abcdef', from: 'tool' })
    expect(findKey('RUNPOD_API_KEY', h, {})).toEqual({ value: 'rpa_0123456789abcdef', from: 'tool' })
    put(h, '.config/vastai/vast_api_key', 'vast0123456789abcdef\n') // gitleaks:allow a fake for the test
    expect(findKey('VAST_API_KEY', h, {})).toEqual({ value: 'vast0123456789abcdef', from: 'tool' })
    expect(findKey('OPENAI_API_KEY', h, {})).toEqual({ value: 'sk-0123456789abcdef', from: 'tool' })
  })
  it('a ChatGPT subscription in Codex is not a key, and a stub is not one either', () => {
    const h = home()
    put(h, '.codex/auth.json', JSON.stringify({ OPENAI_API_KEY: null, tokens: { access_token: 'x' } }))
    put(h, '.bashrc', 'export STRIPE_API_KEY=todo\n')
    expect(findKey('OPENAI_API_KEY', h, {})).toBeNull()
    expect(findKey('STRIPE_API_KEY', h, {})).toBeNull()
  })
})

describe('asking the provider', () => {
  const answering = (status: number, seen: { url?: string; headers?: Record<string, string> } = {}) =>
    (async (url: string, init?: RequestInit) => {
      seen.url = url
      seen.headers = init?.headers as Record<string, string>
      return new Response('{}', { status })
    }) as unknown as typeof fetch
  it('accepted, clearly refused, or no way to know', async () => {
    const seen: { url?: string; headers?: Record<string, string> } = {}
    expect(await checkKey('OPENAI_API_KEY', 'sk-x', answering(200, seen))).toBe('ok')
    expect(seen.url).toBe('https://api.openai.com/v1/models')
    expect(seen.headers).toEqual({ authorization: 'Bearer sk-x' })
    expect(await checkKey('OPENAI_API_KEY', 'sk-x', answering(401))).toBe('refused')
    // A key limited to other rights, a provider that is down: never taken for a « no ».
    expect(await checkKey('OPENAI_API_KEY', 'sk-x', answering(403))).toBe('unknown')
    expect(await checkKey('OPENAI_API_KEY', 'sk-x', answering(503))).toBe('unknown')
    expect(await checkKey('GEMINI_API_KEY', 'x', answering(400))).toBe('refused')
  })
  it('a provider with no check, or no network: unknown, and nobody is called for nothing', async () => {
    let called = 0
    const counting = (async () => (called++, new Response('{}'))) as unknown as typeof fetch
    expect(await checkKey('ACME_API_KEY', 'x', counting)).toBe('unknown')
    expect(called).toBe(0)
    const down = (async () => {
      throw new Error('offline')
    }) as unknown as typeof fetch
    expect(await checkKey('OPENAI_API_KEY', 'sk-x', down)).toBe('unknown')
  })
})
