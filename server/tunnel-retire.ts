// Once a computer has its stable address (server/stable-address.ts), the Cloudflare quick tunnel the setup page's install
// left running (get/bootstrap.sh: user service weevils-link, a launchd agent on a Mac, or a plain background process)
// only keeps weevils reachable under a random name nobody uses any more: it is stopped and not started again.
// Best effort, only what that install made; nothing else is touched.
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const run = (cmd: string, args: string[]) =>
  new Promise<void>((resolve) => execFile(cmd, args, { timeout: 15_000 }, () => resolve()))

export function retireTunnel(home = os.homedir(), platform = process.platform): void {
  const unit = path.join(home, '.config/systemd/user/weevils-link.service')
  const label = 'com.github.sc4rville.weevils-link'
  const plist = path.join(home, 'Library/LaunchAgents', `${label}.plist`)
  void (async () => {
    if (platform === 'linux' && fs.existsSync(unit)) {
      await run('systemctl', ['--user', 'disable', '--now', 'weevils-link'])
      console.log('[address] the old quick tunnel (weevils-link) is stopped')
    }
    if (platform === 'darwin' && fs.existsSync(plist)) {
      await run('launchctl', ['bootout', `gui/${process.getuid?.() ?? ''}/${label}`])
      try {
        fs.rmSync(plist)
      } catch {
        /* left as it was */
      }
      console.log('[address] the old quick tunnel (launchd) is stopped')
    }
    // A run with no service manager left a plain process: only cloudflared's quick tunnel command, only this user's.
    await run('pkill', ['-u', String(process.getuid?.() ?? ''), '-f', 'cloudflared tunnel --no-autoupdate --url http://127.0.0.1:'])
  })()
}
