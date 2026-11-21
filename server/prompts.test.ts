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
  it('weevboss learns the vault in both languages: GitHub by its code, the 24 words once, the history question, the summary, the export', () => {
    const md = (l: string) => fs.readFileSync(path.join(import.meta.dirname, `orchestrator.${l}.md`), 'utf8')
    for (const l of ['fr', 'en']) {
      for (const x of [
        'weevils setup github', 'github.com/login/device',
        '`weevils weevbook vault setup`', '`weevils setup mark vault:code`',
        '`weevils setup mark vault:history`', '`weevils setup ask machine`', '`weevils setup ask machine --since 2026-10-01`', '`weevils setup ask machine --match "',
        '`weevils weevbook vault summary --json`', '`claude_window`', '`import`', '`pending`', '`weevils setup mark vault:summary`',
        'Claude.ai', 'ChatGPT', '`weevils setup mark vault:export`',
        '`vault: found`', '`weevils weevbook vault restore --code "',
      ]) expect(md(l), `${l}: ${x}`).toContain(x)
      // By talking only: its own paragraph shows no chip, and names nothing weevboss could not run when agents ask
      // before acting (weevils commands only).
      const bullet = /\n- \*\*(?:Their conversations|Ses conversations)[\s\S]*?(?=\n- \*\*)/.exec(md(l))?.[0] ?? ''
      expect(bullet.length).toBeGreaterThan(2000)
      expect(bullet).not.toMatch(/\[\[setup:/)
      for (const cmd of bullet.match(/`[^`]+`/g) ?? []) if (/^`[a-z]+ /.test(cmd)) expect(cmd, `${l}: ${cmd}`).toMatch(/^`weevils (setup|weevbook)[ `]/)
    }
    const en = md('en')
    const spec = fs.readFileSync(path.join(import.meta.dirname, '../docs/spec/07-vault.md'), 'utf8').replace(/\n> ?/g, ' ').replace(/\s+/g, ' ')
    for (const said of [
      'Keep this somewhere safe, like a password: with it, a new machine gets everything back',
      'Your server is ready to carry your work. Want me to bring over your whole history, or do you have a date or a few conversations in mind?',
      'Done: 412 conversations from your MacBook and this server, across two Claude accounts and Codex. From today they\'re yours, not Claude\'s, not OpenAI\'s, not any one machine\'s. They live in your private GitHub, and you can reopen and continue any of them right here. Machines and subscriptions come and go; your work stays. You\'re independent now.',
    ]) {
      expect(en, said).toContain(said)
      expect(spec, said).toContain(said) // the spec's words, not a paraphrase
    }
    expect(en).toContain('Never write those words again')
    expect(en).toContain('say "the last 30 days of your conversations", never "everything" or "your whole history"')
    const fr = md('fr')
    for (const said of [
      '« Garde-le en lieu sûr, comme un mot de passe : avec lui, une nouvelle machine récupère tout. »',
      '« Ton serveur est prêt à porter ton travail. Tu veux que je ramène tout ton historique, ou tu as une date ou quelques conversations en tête ? »',
      'C\'est fait : 412 conversations de ton MacBook et de ce serveur, sur deux comptes Claude et Codex.',
      'N\'écris plus jamais ces mots',
      'dis « les 30 derniers jours de tes conversations », jamais « tout » ni « tout ton historique »',
    ]) expect(fr, said).toContain(said)
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
