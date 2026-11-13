import { tr } from './i18n.ts'
import P from './i18n/provider.ts'
/** Local provider choice and credential presence; never logs in or calls an AI. */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Tool } from '../shared/api.ts'
import { HOME, CODEX_DIR } from './config.ts'
export const preferredTool = (): Tool => process.env.WEEVILS_PROVIDER === 'codex' ? 'codex' : 'claude'
let route: ((tool: Tool) => Tool | null) | undefined
export function setProviderRoute(select: (tool: Tool) => Tool | null) { route = select }
/** Runtime quota routing does not rewrite the user's configured provider/model/effort. */
export function availableTool(tool = preferredTool()): Tool {
 const selected = route ? route(tool) : tool
 if (!selected) throw new Error(tr(P).waiting)
 return selected
}
const read = (file: string): any => { try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null } }
export function codexLogged(): boolean {
 const auth = read(path.join(path.dirname(CODEX_DIR), 'auth.json'))
 return !!(auth?.tokens?.access_token || auth?.OPENAI_API_KEY || process.env.OPENAI_API_KEY?.trim())
}
export function providerStatus(tool: Tool = preferredTool()): { installed: boolean; logged: boolean } {
 const installed = [...(process.env.PATH ?? '').split(path.delimiter),path.join(os.homedir(),'.local','bin')].some(dir=>{try{fs.accessSync(path.join(dir,tool),fs.constants.X_OK);return true}catch{return false}})
 const logged = tool === 'codex' ? codexLogged() : !!(process.env.ANTHROPIC_API_KEY?.trim() || process.env.CLAUDE_CODE_OAUTH_TOKEN?.trim() || read(path.join(HOME,'.claude','.credentials.json'))?.claudeAiOauth?.accessToken || (process.platform === 'darwin' && read(path.join(HOME,'.claude.json'))?.oauthAccount))
 return {installed,logged}
}
export const providerReady = () => { const s=providerStatus();return s.installed && s.logged }

export const providerUnavailable = (tool: Tool = preferredTool()) => tr(P).unavailable(tool === 'codex' ? 'Codex' : 'Claude')
