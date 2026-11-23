import { defineMessages } from './index'

// A machine of yours that does not answer (src/ui/away.tsx): why, since when, and the one line that brings it back.
export default defineMessages({
  fr: {
    link: (name: string, since: string) => `Aucune nouvelle de ${name}${since} : il est éteint ou en veille, ou weevils y a perdu son lien.`,
    stopped: (name: string, since: string) => `${name} est allumé, mais weevils n’y répond plus${since}.`,
    key: (name: string, since: string) => `${name} répond mais ne laisse plus entrer cette machine${since} : il lui faut une mise à jour.`,
    since: (when: string) => ` depuis ${when}`,
    yesterday: (time: string) => `hier ${time}`,
    copy: (name: string) => `Copier la ligne à coller sur ${name}`,
    copying: 'une ligne neuve…',
    copied: (name: string) => `Copiée. Colle-la dans un terminal sur ${name} : il revient en une minute.`,
    shown: (name: string) => `Colle cette ligne dans un terminal sur ${name} :`,
  },
  en: {
    link: (name: string, since: string) => `No news from ${name}${since}: it’s off or asleep, or weevils on it lost its link.`,
    stopped: (name: string, since: string) => `${name} is on, but weevils on it hasn’t answered${since}.`,
    key: (name: string, since: string) => `${name} answers but no longer lets this machine in${since}: it needs an update.`,
    since: (when: string) => ` since ${when}`,
    yesterday: (time: string) => `yesterday ${time}`,
    copy: (name: string) => `Copy the line to paste on ${name}`,
    copying: 'a fresh line…',
    copied: (name: string) => `Copied. Paste it in a terminal on ${name}: it’s back within a minute.`,
    shown: (name: string) => `Paste this line in a terminal on ${name}:`,
  },
})
