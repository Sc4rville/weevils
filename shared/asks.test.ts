import { describe, expect, it } from 'vitest'
import { asksUser } from './asks.ts'

describe('une session qui attend l’utilisateur', () => {
  it('TLO : valider RunPod et coller une adresse → coller ; un lien à ouvrir → lien', () => {
    expect(asksUser('J’ai préparé le pod.\n\nValide la facturation sur RunPod, puis colle-moi l’adresse du pod ici.')).toMatchObject({ kind: 'paste' })
    expect(asksUser('Ouvre ce lien pour autoriser l’accès : https://www.runpod.io/console/user/settings?x=1. Je reprends ensuite.')).toMatchObject({ kind: 'link', url: 'https://www.runpod.io/console/user/settings?x=1' })
  })
  it('une question ou un choix → question', () => {
    expect(asksUser('Deux options :\n- A : rapide\n- B : propre\n\nTu préfères laquelle ?')).toMatchObject({ kind: 'question', text: 'Tu préfères laquelle ?' })
    expect(asksUser('Done. Should I push to main?')).toMatchObject({ kind: 'question' })
  })
  it('un compte rendu sans demande n’attend rien ; un « ? » dans une URL ou du code non plus', () => {
    expect(asksUser('Tout est fait : 12 tests verts, poussé sur main.')).toBeNull()
    expect(asksUser('Déployé sur https://x.scarville.tech/?v=2 et vérifié.')).toBeNull()
    expect(asksUser('Corrigé :\n```js\nconst a = b ? c : d\n```\nC’est en ligne.')).toBeNull()
  })
})
