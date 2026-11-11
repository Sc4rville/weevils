/** Static tokenization only. Never execute the orchestration program. */
type Token = { value: string; literal?: boolean }
function tokens(code: string): Token[] {
  const out: Token[] = []
  const re = /\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|[A-Za-z_$][\w$]*|[^\s]/g
  for (const m of code.matchAll(re)) {
    const raw=m[0]
    if(raw.startsWith('//')||raw.startsWith('/*'))continue
    if (/^["'`]/.test(raw)) {
      if(raw[0]==='`' && raw.includes('${')) {out.push({value:'',literal:true});continue}
      let value=raw.slice(1,-1).replace(/\\([\\'"`])/g,'$1').replace(/\\n/g,'\n')
      if(raw[0]==='"')try{value=JSON.parse(raw)}catch{ /* malformed literals are never evaluated */ }
      out.push({value,literal:true})
    } else out.push({value:raw})
  }
  return out
}
export function nestedCalls(input: unknown): {name:string; command?:string}[] {
  const obj=input && typeof input==='object'? input as Record<string,unknown>:{}
  const code=typeof input==='string'?input:typeof obj.code==='string'?obj.code:typeof obj.input==='string'?obj.input:''
  const ts=tokens(code), calls:{name:string;command?:string}[]=[]
  for(let i=0;i<ts.length-3;i++) {
    if(ts[i].literal||ts[i].value!=='tools'||ts[i+1].value!=='.'||ts[i+2].literal||ts[i+3].value!=='(')continue
    const call:{name:string;command?:string}={name:ts[i+2].value}
    if(ts[i+4]?.value==='{') {
      let depth=1
      for(let j=i+5;j<ts.length && depth;j++) {
        const token=ts[j]
        if(depth===1 && token.value==='cmd' && ts[j+1]?.value===':' && ts[j+2]?.literal && [',','}'].includes(ts[j+3]?.value)) call.command=ts[j+2].value || undefined
        if(!token.literal && ['{','[','('].includes(token.value))depth++
        if(!token.literal && ['}',']',')'].includes(token.value))depth--
      }
    }
    calls.push(call)
  }
  return calls
}
/** Redact before data crosses the API boundary, not just in the renderer. */
export function redactToolText(text:string):string {
  return text.replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-]*PRIVATE KEY-----|$)/g,'[redacted]')
    .replace(/\b(Bearer)\s+[^\s"']+/gi,'$1 [redacted]')
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi,'$1[redacted]@')
    .replace(/\b(sk-[a-zA-Z0-9_-]{8,}|eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+)\b/g,'[redacted]')
    .replace(/([\w-]*(?:token|password|passwd|secret|api[_-]?key|authorization|cookie)[\w-]*["']?\s*[:=]\s*)(?:"[^"\n]*"|'[^'\n]*'|[^\s,;&}]+)/gi,'$1[redacted]')
    .slice(0,8000)
}
export function commandDetails(name:string,input:unknown):string[] {
  const obj=input && typeof input==='object'? input as Record<string,unknown>:{}
  const raw=obj.cmd??obj.command
  const commands=name.split('.').at(-1)==='exec'?nestedCalls(input).map(c=>c.command):['exec_command','shell','local_shell','local_shell_call'].includes(name.split('.').at(-1)??'')?[Array.isArray(raw)?raw.join(' '):raw]:[]
  return commands.filter((c):c is string=>typeof c==='string'&&!!c).map(c=> /(?:\.env\b|credentials|printenv|\/proc\/.*environ|PRIVATE KEY)/i.test(c)?'[redacted]':redactToolText(c))
}
