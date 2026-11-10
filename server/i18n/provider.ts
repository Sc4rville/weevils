import { defineMessages } from '../i18n.ts'
export default defineMessages({
 fr: { unavailable: (tool: string) => `${tool} n’est pas installé ou connecté sur cette machine` },
 en: { unavailable: (tool: string) => `${tool} is not installed or connected on this machine` },
})
