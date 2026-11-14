// Messages of src/ui/voice.tsx: weevboss's voice button and the voice picker.
import { defineMessages } from './index'

export default defineMessages({
  fr: {
    savedRecordings: 'enregistrements conservés',
    interruptedAudio: 'enregistrement interrompu — seule la partie conservée est disponible',
    audioSaved: 'audio conservé — non envoyé',
    transcriptSaved: 'transcription conservée',
    addTranscript: 'ajouter au brouillon',
    retryTranscript: 'reprendre la transcription',
    saveAudio: 'enregistrer l’audio',
    incompleteAudio: 'Une partie de l’enregistrement manque, le reste est gardé.',
    recordingInterrupted: 'Enregistrement interrompu. L’audio conservé peut être récupéré.',
    storageUnavailable: 'Ce navigateur ne peut pas garder d’enregistrement : rien n’a démarré.',
    storageInterrupted: 'La sauvegarde a échoué : garde la page ouverte et touche « enregistrer l’audio ».',
    readAudio: 'lecture audio impossible',
    nothingHeard: 'rien entendu',
    micDenied: 'micro refusé',
    /** Label of the logo button, by phase: idle, recording, transcribing, ready to send. */
    dictate: 'dicter à weevboss',
    stopAndTranscribe: 'arrêter et transcrire',
    sendWhenReady: 'envoyer dès que transcrit',
    send: 'envoyer',
    /** Sample sentence said when a voice is picked. */
    hello: (name: string) => `Salut${name ? ` ${name}` : ''}, c’est moi, weevboss.`,
    voices: 'voix',
    /** The word after the voices: installs the Siri Shortcut (its address is copied first). */
    siri: 'ajouter à Siri',
  },
  en: {
    savedRecordings: 'saved recordings',
    interruptedAudio: 'recording interrupted — only retained audio is available',
    audioSaved: 'audio retained — not sent',
    transcriptSaved: 'transcript retained',
    addTranscript: 'add to draft',
    retryTranscript: 'retry transcription',
    saveAudio: 'save audio',
    incompleteAudio: 'Part of this recording is missing. The rest is kept.',
    recordingInterrupted: 'Recording interrupted. The retained audio can be recovered.',
    storageUnavailable: 'This browser can’t keep recordings, so recording didn’t start.',
    storageInterrupted: 'Saving failed: keep this page open and tap “save audio”.',
    readAudio: 'couldn’t read the audio',
    nothingHeard: 'didn’t hear anything',
    micDenied: 'mic blocked',
    dictate: 'talk to weevboss',
    stopAndTranscribe: 'stop and transcribe',
    sendWhenReady: 'send once transcribed',
    send: 'send',
    hello: (name: string) => `Hi${name ? ` ${name}` : ''}, it’s me, weevboss.`,
    voices: 'voices',
    siri: 'add to Siri',
  },
})
