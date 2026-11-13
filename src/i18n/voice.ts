// Messages of src/ui/voice.tsx: weevboss's voice button and the voice picker.
import { defineMessages } from './index'

export default defineMessages({
  fr: {
    savedRecordings: 'enregistrements conservés',
    audioSaved: 'audio conservé — non envoyé',
    transcriptSaved: 'transcription conservée',
    addTranscript: 'ajouter au brouillon',
    retryTranscript: 'reprendre la transcription',
    saveAudio: 'enregistrer l’audio',
    incompleteAudio: 'Des morceaux de cet enregistrement manquent. L’original conservé n’a pas été supprimé.',
    recordingInterrupted: 'Enregistrement interrompu. L’audio conservé peut être récupéré.',
    storageUnavailable: 'La sauvegarde audio est indisponible dans ce navigateur. L’enregistrement n’a pas démarré.',
    storageInterrupted: 'La sauvegarde audio a échoué. Gardez cette page ouverte et enregistrez l’audio avant de réessayer.',
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
  },
  en: {
    savedRecordings: 'saved recordings',
    audioSaved: 'audio retained — not sent',
    transcriptSaved: 'transcript retained',
    addTranscript: 'add to draft',
    retryTranscript: 'retry transcription',
    saveAudio: 'save audio',
    incompleteAudio: 'Some recording chunks are missing. The retained original has not been deleted.',
    recordingInterrupted: 'Recording interrupted. The retained audio can be recovered.',
    storageUnavailable: 'Audio storage is unavailable in this browser. Recording has not started.',
    storageInterrupted: 'Audio storage failed. Keep this page open and save the audio before retrying.',
    readAudio: 'couldn’t read the audio',
    nothingHeard: 'didn’t hear anything',
    micDenied: 'mic blocked',
    dictate: 'talk to weevboss',
    stopAndTranscribe: 'stop and transcribe',
    sendWhenReady: 'send once transcribed',
    send: 'send',
    hello: (name: string) => `Hi${name ? ` ${name}` : ''}, it’s me, weevboss.`,
    voices: 'voices',
  },
})
