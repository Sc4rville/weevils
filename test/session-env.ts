// What a test must not inherit from the session that runs it, beyond the WEEVILS_* settings (test/setup-env.ts).
//
// An automation's session, and the checks weevils runs before its work lands by itself, carry a push guard in their
// environment: git configuration given through GIT_CONFIG_COUNT / GIT_CONFIG_KEY_n / GIT_CONFIG_VALUE_n that rewrites
// every push URL to a transport that does not exist, a local folder included (server/optimizers.ts guardEnv). A test's
// repositories are its own, in a throwaway HOME that holds no login: pushing between them is the thing under test. With
// the rewrites left in, every such test fails inside an automation's sandbox, the whole suite with them, and no cleanup
// or in-scope work can ever land without the person.
//
// Only the push rewrites go (remote.pushDefault, url.<x>.pushInsteadOf). Everything else the guard sets stays: no
// credential helper, no ssh for git, no prompt, no askpass.
const PUSH_RULE = /^(remote\.pushdefault|url\..*\.pushinsteadof)$/i

/** Rewrites <env> in place: the git configuration it carries, minus the rules that redirect pushes. */
export function dropPushRewrites(env: NodeJS.ProcessEnv): void {
  const count = Number(env.GIT_CONFIG_COUNT)
  if (!Number.isInteger(count) || count <= 0) return
  const kept: [string, string][] = []
  for (let i = 0; i < count; i++) {
    const key = env[`GIT_CONFIG_KEY_${i}`]
    const value = env[`GIT_CONFIG_VALUE_${i}`]
    delete env[`GIT_CONFIG_KEY_${i}`]
    delete env[`GIT_CONFIG_VALUE_${i}`]
    if (key !== undefined && !PUSH_RULE.test(key)) kept.push([key, value ?? ''])
  }
  if (!kept.length) return void delete env.GIT_CONFIG_COUNT
  env.GIT_CONFIG_COUNT = String(kept.length)
  kept.forEach(([key, value], i) => {
    env[`GIT_CONFIG_KEY_${i}`] = key
    env[`GIT_CONFIG_VALUE_${i}`] = value
  })
}
