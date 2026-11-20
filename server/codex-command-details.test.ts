import { describe, expect, it } from 'vitest'
import { nestedCalls, commandDetails, redactToolText, toolOutputText, toolOutputDetails, callDetails, commandSummaries } from './codex-command-details.ts'
it('parses nested literal commands without executing scripts or treating strings/comments as calls',()=>{
 expect(nestedCalls('text(await tools.exec_command({cmd:"git status"})); // tools.fake()\nconst s="tools.fake()"')).toEqual([{name:'exec_command',command:'git status'}])
 expect(nestedCalls('await tools.exec_command({cmd:dynamic})')).toEqual([{name:'exec_command'}])
 expect(nestedCalls('await tools.exec_command({cmd:`echo ${secret}`})')).toEqual([{name:'exec_command'}])
 expect(nestedCalls({code:'await tools.exec_command({cmd:"npm test"})'})[0].command).toBe('npm test')
})
it('redacts secrets and excludes credential reads before exposing details',()=>{
 expect(commandDetails('exec_command',{cmd:'cat .env'})).toEqual(['[redacted]'])
 const redacted=redactToolText('TOKEN=private curl https://user:password@host/?api_key=secret Authorization: Bearer abcdef')
 for(const secret of ['private','password','secret','abcdef'])expect(redacted).not.toContain(secret)
 expect(commandDetails('functions.exec','await tools.exec_command({cmd:"git status"})')).toEqual(['git status'])
})

it('reads text result blocks and ignores binary content and unrelated objects',()=>{
 expect(toolOutputText([{type:'input_text',text:JSON.stringify({output:'tests passed TOKEN=private'})},{type:'image',data:'private'}])).toBe('tests passed TOKEN=[redacted]')
 expect(toolOutputText({unrelated:'private'})).toBe('')
})

it('reports truncation after redaction across structured blocks, without false positives at the boundary',()=>{
 expect(toolOutputDetails('x'.repeat(8000))).toEqual({output:'x'.repeat(8000),outputTruncated:false})
 const result=toolOutputDetails([{type:'input_text',text:'x'.repeat(7000)},{type:'input_text',text:'y'.repeat(2000)+' TOKEN=private'}])
 expect(result.output).toHaveLength(8000)
 expect(result.outputTruncated).toBe(true)
 expect(result.output).not.toContain('private')
})

it('extracts literal descriptions and actual nested tool names without interpreting computed values',()=>{
 const input='await tools.exec_command({cmd:"git status",description:"Check repository TOKEN=private"}); await tools.view_image({path:dynamic}); await tools.exec_command({cmd:dynamic,description:derived})'
 expect(nestedCalls(input)[0]).toMatchObject({name:'exec_command',command:'git status',description:'Check repository TOKEN=private'})
 expect(callDetails('functions.exec',input)).toEqual([{name:'exec_command',description:'Check repository TOKEN=[redacted]'},{name:'view_image'},{name:'exec_command'}])
})
it('summarizes concrete executables without disclosing arguments or mistaking heredoc code for commands',()=>{
 expect(commandSummaries(['TMPDIR=/private/cache heavy npm run check > /private/log 2>&1','git status --short; git log -3 --oneline'])).toEqual(['npm run check','git status','git log'])
 expect(commandSummaries(["python3 - <<'PY'\ngit status\nsecret=private\nPY"])).toEqual(['python3'])
 expect(commandSummaries(['curl "https://private/secret;git status"'])).toEqual(['curl'])
})

describe('redactToolText on long texts (the weevbook redacts whole strings)', () => {
  // The single regex it replaced, kept as the reference: same output, in time proportional to the length.
  const reference = (text: string) => text.replace(/([\w-]*(?:token|password|passwd|secret|api[_-]?key|authorization|cookie)[\w-]*["']?\s*[:=]\s*)(?:"[^"\n]*"|'[^'\n]*'|[^\s,;&}]+)/gi, '$1[redacted]')
  it('redacts name=value pairs as the regex did', () => {
    const parts = ['token', 'TOKEN', 'my_api-key', 'Authorization', 'cookie', 'word', 'x', '-', '_', '=', ':', ' ', '\n', '"', "'", ',', ';', '&', '}', 'abc', '"v a"', "'v'", '{', 'passwd']
    let seed = 7
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31
    for (let i = 0; i < 3000; i++) {
      let s = ''
      for (let k = Math.floor(rand() * 14); k > 0; k--) s += parts[Math.floor(rand() * parts.length)]
      expect(redactToolText(s, Infinity), JSON.stringify(s)).toBe(reference(s))
    }
  })
  it('takes linear time on a long run of word characters', () => {
    const long = `${'a'.repeat(2_000_000)}token=abc ${'b'.repeat(2_000_000)}`
    const t = performance.now()
    expect(redactToolText(long, Infinity)).toBe(`${'a'.repeat(2_000_000)}token=[redacted] ${'b'.repeat(2_000_000)}`)
    expect(performance.now() - t).toBeLessThan(2000)
  })
})
