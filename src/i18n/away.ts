import { defineMessages } from './index'

// A machine of yours that does not answer (src/ui/away.tsx): why, since when, and the one line that brings it back.
export default defineMessages({
  fr: {
    joining: (name: string, since: string) => `${name} se branche : weevils s’y installe${since}. Il apparaît ici tout seul à la fin.`,
    failed: (name: string, since: string, why: string) => `L’installation sur ${name} s’est arrêtée${since}${why ? ` : ${why}` : ''}.`,
    failedFix: (name: string) => `Sur ${name}, lance :`,
    port: (name: string, since: string) => `${name} ne peut pas se connecter : un autre programme de cette machine tient son port${since}. Il en prend un libre tout seul à son prochain essai.`,
    off: (name: string) => `${name} est éteint dans weevils. Allume-le : il se connecte en quelques secondes.`,
    connecting: (name: string) => `${name} se connecte…`,
    link: (name: string, since: string) => `Aucune nouvelle de ${name}${since} : il est éteint ou en veille, ou weevils y a perdu son lien.`,
    stopped: (name: string, since: string) => `${name} est allumé, mais weevils n’y répond plus${since}.`,
    key: (name: string, since: string) => `${name} répond mais ne laisse plus entrer cette machine${since} : il lui faut une mise à jour.`,
    since: (when: string) => ` depuis ${when}`,
    yesterday: (time: string) => `hier ${time}`,
    copy: (name: string) => `Copier la ligne à coller sur ${name}`,
    copying: 'une ligne neuve…',
    copied: (name: string) => `Copiée. Colle-la dans un terminal sur ${name} : il se reconnecte tout seul à la fin.`,
    shown: (name: string) => `Colle cette ligne dans un terminal sur ${name} :`,
  },
  en: {
    joining: (name: string, since: string) => `${name} is plugging in: weevils is installing there${since}. It shows up here by itself when done.`,
    failed: (name: string, since: string, why: string) => `The install on ${name} stopped${since}${why ? `: ${why}` : ''}.`,
    failedFix: (name: string) => `On ${name}, run:`,
    port: (name: string, since: string) => `${name} can’t connect: another program on this machine holds its port${since}. It takes a free one by itself at its next try.`,
    off: (name: string) => `${name} is switched off in weevils. Switch it on: it connects within seconds.`,
    connecting: (name: string) => `${name} is connecting…`,
    link: (name: string, since: string) => `No news from ${name}${since}: it’s off or asleep, or weevils on it lost its link.`,
    stopped: (name: string, since: string) => `${name} is on, but weevils on it hasn’t answered${since}.`,
    key: (name: string, since: string) => `${name} answers but no longer lets this machine in${since}: it needs an update.`,
    since: (when: string) => ` since ${when}`,
    yesterday: (time: string) => `yesterday ${time}`,
    copy: (name: string) => `Copy the line to paste on ${name}`,
    copying: 'a fresh line…',
    copied: (name: string) => `Copied. Paste it in a terminal on ${name}: it reconnects by itself when it’s done.`,
    shown: (name: string) => `Paste this line in a terminal on ${name}:`,
  },
})
