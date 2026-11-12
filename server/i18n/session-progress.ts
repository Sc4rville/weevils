import { defineMessages } from '../i18n.ts'
export default defineMessages({
 fr: { render: 'Rendu des déplacements', review: 'Rendu terminé', waiting: 'Suivi du rendu', error: 'Rendu interrompu', verified: (n: number) => `${n} images vérifiées et récupérées` },
 en: { render: 'Rendering transitions', review: 'Render completed', waiting: 'Render monitoring', error: 'Rendering interrupted', verified: (n: number) => `${n} images verified and downloaded` },
})
