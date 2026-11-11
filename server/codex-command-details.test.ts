import { expect, it } from 'vitest'
import { nestedCalls, commandDetails, redactToolText, toolOutputText } from './codex-command-details.ts'
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
