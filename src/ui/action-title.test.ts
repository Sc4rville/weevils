// Each recorded action gets a short human title from its call: the agent's own description, else tool and arguments.
import { expect, it } from 'vitest'
import type { Message } from '../../shared/api'
import { actionTitle, shortPath } from './plain-steps'
import W from '../i18n/plain-steps'
const ev = (text: string, toolDetails?: Message['toolDetails']): Message => ({ id: 'x', role: 'event', text, at: 1, ...(toolDetails ? { toolDetails } : {}) })
const bash = (command: string) => ev(`Bash · ${command.slice(0, 90)}`, { calls: [{ name: 'Bash' }], commands: [command] })
const en = (m: Message) => actionTitle(m, W.en)

it('reads the shell commands of a real thread (the ones Yann saw as « Recorded action »)', () => {
  expect(en(bash('cd ~/projects/weevils-next; grep -n "session: (id\\|session\\|sendTo\\|autos" src/api.ts | head -20'))).toBe('Search src/api.ts for "session: (id|session|sendTo|autos"')
  expect(en(bash('cd ~/projects/weevils-next; sed -n 100,125p src/api.ts; grep -n "auto" src/api.ts | head'))).toBe('Read src/api.ts lines 100-125')
  expect(en(bash('cd ~/projects/weevils-next; grep -n "export interface Optimizer " -A30 shared/api.ts | grep x'))).toBe('Search shared/api.ts for "export interface Optimizer "')
  expect(en(bash('heavy npm run check > /tmp/x.log 2>&1; echo $?'))).toBe('Run npm check')
  expect(en(bash('npx vitest run src/ui'))).toBe('Run the tests')
  expect(en(bash('git -C ~/projects/weevils status --short'))).toBe('See what changed')
  expect(en(bash('curl -s http://127.0.0.1:4179/api/snapshot | jq .'))).toBe('Call 127.0.0.1:4179/api/snapshot')
  expect(en(bash('ls ~/projects/weevils/server'))).toBe('List server')
  expect(en(bash('cat $(which expose) | head -80; ls /etc/caddy/'))).toBe('Read expose')
})

it('prefers the agent\'s own description, and titles the other tools from their arguments', () => {
  expect(en(ev('Bash · Run the theme contrast test', { calls: [{ name: 'Bash', description: 'Run the theme contrast test' }], commands: ['npx vitest run test/theme-contrast.test.ts'] }))).toBe('Run the theme contrast test')
  expect(en(ev('Read · /home/yann/projects/weevils/src/api.ts', { calls: [{ name: 'Read' }], commands: [], args: { file: '/home/yann/projects/weevils/src/api.ts', lines: '100-125' } }))).toBe('Read src/api.ts lines 100-125')
  expect(en(ev('Grep · automations', { calls: [{ name: 'Grep' }], commands: [], args: { pattern: 'automations', path: '/home/yann/projects/weevils/server' } }))).toBe('Search server for "automations"')
  expect(en(ev('WebSearch · mermaid bundle size', { calls: [{ name: 'WebSearch' }], commands: [], args: { query: 'mermaid bundle size' } }))).toBe('Search the web for "mermaid bundle size"')
  // An older event with no recorded details: from its line; a command cut at 90 characters never yields a broken title.
  expect(en(ev('Bash · cd ~/projects/weevils && grep -rn "expose\\|DIST_DIR" server/*.ts | head; cat sites/x.caddy; sed -n 1,2p "a b…'))).toBe('Search server/*.ts for "expose|DIST_DIR"')
  expect(en(ev('Bash · cd ~/projects/weevils; grep -n "export interface Optimizer \\|expose)…'))).toBe('Running command')
  expect(en(ev('Edit · /home/user/projects/shop/src/PayButton.tsx'))).toBe('Edit src/PayButton.tsx')
  expect(actionTitle(bash('npm test'), W.fr)).toBe('Lancer les tests')
})

it('paths lose the project folder and anything above it', () => {
  expect(shortPath('/home/yann/projects/weevils/src/ui/bits.tsx')).toBe('src/ui/bits.tsx')
  expect(shortPath('/etc/nginx/sites-enabled/default')).toBe('sites-enabled/default')
  expect(shortPath('a/b/c/d/e.ts')).toBe('…/d/e.ts')
})
