// The raw lines and the checkpoints, pushed to the vault from a process of their own (docs/spec/07-vault.md, step 3).
// weevilsd's vault pusher starts it at the lowest priority when something is due: megabytes of lines are read, slimmed
// and sealed here, never in the app's loop. One argument: the job, as JSON (paths only: the key is read from its file).
// It prints its report as JSON and ends.

import { ghRunner } from './vault-github.ts'
import { pushLines, type LinesJob } from './vault-raw.ts'
import { readKey } from './vault.ts'

const job = JSON.parse(process.argv[2] ?? 'null') as LinesJob | null
const key = job ? readKey(job.keyFile) : null
if (!job || !key) {
  console.error('no vault key on this machine') // i18n-ignore: log line
  process.exitCode = 2
} else {
  const { gh, at, ...rest } = job
  process.stdout.write(JSON.stringify(await pushLines({ ...rest, key, ...(gh ? { gh: ghRunner(gh, 60_000) } : {}), ...(at !== undefined ? { now: () => at } : {}) })))
}
