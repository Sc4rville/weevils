// Prompts des agents en FR/EN : gabarits de weevboss présents dans les deux langues, clés JSON des prompts français inchangées.
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import Classify from './i18n/classify.ts'
import Github from './i18n/github.ts'
import Titles from './i18n/titles.ts'

describe('prompts FR/EN', () => {
  it('weevboss a un gabarit par langue, avec les mêmes emplacements', () => {
    for (const l of ['fr', 'en']) {
      const md = fs.readFileSync(path.join(import.meta.dirname, `orchestrator.${l}.md`), 'utf8')
      expect(md).toContain('{{user}}')
      expect(md).toContain('{{owner}}')
      expect(md).toContain('weevils send')
      // « pour toi » : les deux verbes, dans la liste des commandes et dans la consigne
      for (const verb of ['weevils post "', 'weevils show <']) expect(md.split(verb).length, `${l} ${verb}`).toBeGreaterThan(2)
    }
  })

  // docs/spec/07-vault.md: keeping the person's conversations on their own GitHub is part of the welcome, and it is
  // only talk. Both templates carry the same steps, the commands weevboss runs itself, and the spec's own sentences.
  it('weevboss learns the vault in both languages: weevils says the sync itself; what is left to it is the GitHub link, a found vault, another computer, the export', () => {
    const md = (l: string) => fs.readFileSync(path.join(import.meta.dirname, `orchestrator.${l}.md`), 'utf8')
    for (const l of ['fr', 'en']) {
      for (const x of [
        '(/#do=github)', '(/#do=server)', '`weevils setup ask machine`', '`--since 2026-10-01`', '`--match "',
        'Claude.ai', 'ChatGPT', '`weevils setup mark vault:export`',
        '`vault: found`', '`weevils weevbook vault restore --code "',
      ]) expect(md(l), `${l}: ${x}`).toContain(x)
      // weevboss no longer makes the vault: weevils does, and says so.
      expect(md(l)).not.toContain('`weevils weevbook vault setup`')
      // By talking only: its own paragraph shows no chip, and names nothing weevboss could not run when agents ask
      // before acting (weevils commands only).
      const bullet = /\n- \*\*(?:Their conversations|Ses conversations)[\s\S]*?(?=\n- \*\*)/.exec(md(l))?.[0] ?? ''
      expect(bullet.length).toBeGreaterThan(1500)
      expect(bullet).not.toMatch(/\[\[setup:/)
      for (const cmd of bullet.match(/`[^`]+`/g) ?? []) if (/^`[a-z]+ /.test(cmd)) expect(cmd, `${l}: ${cmd}`).toMatch(/^`weevils (setup|weevbook)[ `]/)
    }
    expect(md('en')).toContain('never write the recovery code')
    expect(md('fr')).toContain('n\'écris jamais le code de secours')
    // The spec says the onboarding as built, in the owner's words.
    const spec = fs.readFileSync(path.join(import.meta.dirname, '../docs/spec/07-vault.md'), 'utf8').replace(/\s+/g, ' ')
    expect(spec).toContain('I\'m syncing your conversations so you can pick them up from any machine or subscription.')
    expect(spec).toContain('I can [set it up now](/#do=server), or [remind you later](/#do=later).')
  })

  it('les prompts français gardent leurs clés, les anglais demandent l’anglais', () => {
    expect(Object.keys(JSON.parse(Titles.fr.item('a', 'claude', 'x', 'd', ['r'])))).toEqual(['id', 'outil', 'ou', 'debut', 'derniers_echanges'])
    expect(Object.keys(JSON.parse(Classify.fr.item('a', 't', 'e')))).toEqual(['id', 'titre', 'extrait'])
    expect(Object.keys(JSON.parse(Github.fr.blurbItem('n', 'd', 'r', 'TS')))).toEqual(['name', 'description', 'readme', 'langage'])
    expect(Titles.en.prompt('the user', '[]')).toContain('in English')
    expect(Classify.en.task('the user')).toContain('in English')
    expect(Github.en.blurbPrompt('the user', '[]')).toContain('in English')
  })
})

it('carries the shared machine prose convention into project handoffs without rewriting their evidence', async()=>{
 const R=(await import('./i18n/relay.ts')).default
 const convention=(await import('./i18n/machine-prose.ts')).default
 const evidence='> [VPS] verbatim quotation\n```text\n[PC] raw transcript\n```\nID: [GPU]-job-123'
 for(const lang of ['fr','en'] as const){
  const common={why:'quota',cwd:'/workspace/project',file:'/archive/thread.jsonl',title:'Render project',auto:false}
  const go=R[lang].go({...common,plan:evidence})
  const plan=R[lang].plan({...common,marker:'[test-plan]',ask:evidence,last:evidence,replies:evidence,steps:evidence,background:'render host and browser host differ',git:'clean'})
  for(const prompt of [go,plan]){expect(prompt).toContain(convention[lang].rule);expect(prompt).toContain(evidence)}
  expect(plan.startsWith('[test-plan]')).toBe(true)
 }
})
