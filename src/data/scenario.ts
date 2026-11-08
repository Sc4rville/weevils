// Données de démonstration, toutes fictives. Adaptées de harness-interface-kit/demo/scenario.json.
// Les durées sont en secondes « avant maintenant » : createInitialState les convertit en horodatages,
// pour que la forme des données soit déjà celle que renverra le vrai backend.

import type { Tool, SessionStatus, Role, H24RunState, Source } from '../state/types'

interface MessageSeed { id: string; role: Role; text: string; agoSeconds?: number }

export const scenario = {
  machines: [{ id: 'vps-demo-01', name: 'vps · démo 01', note: 'Machine fictive. Aucune adresse ni connexion réseau.' }],

  projects: [
    {
      id: 'lws',
      name: 'lws',
      color: 'lws',
      kind: 'repo' as const,
      repo: {
        label: 'demo/lws',
        files: [
          { path: 'README.md', content: '# lws — dépôt de démonstration\n\nCe contenu est fictif. Il sert à tester l’explorateur de fichiers.\n' },
          { path: 'src/interface.ts', content: '// Exemple fictif, indépendant de la stack du prototype.\nexport const projectName = "lws";\n' },
        ],
      },
    },
    {
      id: 'crm',
      name: 'crm',
      color: 'crm',
      kind: 'repo' as const,
      repo: {
        label: 'demo/crm',
        files: [
          { path: 'README.md', content: '# crm — dépôt de démonstration\n\nAucune connexion GitHub réelle.\n' },
          { path: 'notes/interface.md', content: '# Proposition fictive\n\nUne version de l’écran attend le choix de l’utilisateur.\n' },
        ],
      },
    },
    {
      // Catégorie que weevils invente quand des échanges ne correspondent à aucun repo.
      id: 'idees',
      name: 'idées',
      color: 'idees',
      kind: 'invented' as const,
      repo: null,
    },
  ],

  sessions: [
    {
      id: 'lws-claude-01',
      projectId: 'lws',
      machineId: 'vps-demo-01',
      tool: 'claude' as Tool,
      title: 'organiser le projet',
      status: 'working' as SessionStatus,
      origin: 'terminal · démo',
      openedSeconds: 5760,
      workSeconds: 720,
      messages: [
        { id: 'm-lws-01', role: 'user', text: 'Organise les fichiers et indique-moi les points à décider.', agoSeconds: 760 },
        { id: 'm-lws-02', role: 'assistant', text: 'Démo : je prépare une proposition de structure.', agoSeconds: 720 },
        { id: 'm-lws-03', role: 'event', text: 'Deux sous-agents sont associés à cette tâche.', agoSeconds: 700 },
      ] as MessageSeed[],
      subagents: [
        { id: 'sub-lws-01', label: 'structure', activity: 'Préparer une proposition de dossiers', status: 'working' as const, elapsedSeconds: 320 },
        { id: 'sub-lws-02', label: 'relecture', activity: 'Vérification fictive du README terminée', status: 'done' as const, elapsedSeconds: 180 },
      ],
    },
    {
      id: 'lws-codex-01',
      projectId: 'lws',
      machineId: 'vps-demo-01',
      tool: 'codex' as Tool,
      title: 'travailler sur la v2',
      status: 'idle' as SessionStatus,
      origin: 'terminal · démo',
      openedSeconds: 16200,
      workSeconds: 0,
      messages: [{ id: 'm-lws-code-01', role: 'assistant', text: 'Démo : cette session reste ouverte et attend une instruction.', agoSeconds: 9000 }] as MessageSeed[],
      subagents: [],
    },
    {
      id: 'crm-claude-01',
      projectId: 'crm',
      machineId: 'vps-demo-01',
      tool: 'claude' as Tool,
      title: 'débloquer l’interface',
      status: 'needs_user' as SessionStatus,
      origin: 'terminal · démo',
      openedSeconds: 50460,
      workSeconds: 0,
      messages: [
        { id: 'm-crm-01', role: 'user', text: 'Prépare une version simple de l’écran.', agoSeconds: 4000 },
        { id: 'm-crm-02', role: 'assistant', text: 'Démo : une proposition est prête. Veux-tu la garder ou demander un ajustement ?', agoSeconds: 2400 },
      ] as MessageSeed[],
      subagents: [],
    },
    {
      id: 'crm-claude-02',
      projectId: 'crm',
      machineId: 'vps-demo-01',
      tool: 'claude' as Tool,
      title: 'organiser le projet',
      status: 'working' as SessionStatus,
      origin: 'terminal · démo',
      openedSeconds: 5760,
      workSeconds: 480,
      messages: [{ id: 'm-crm-03', role: 'assistant', text: 'Démo : je prépare les fichiers de présentation.', agoSeconds: 480 }] as MessageSeed[],
      subagents: [
        { id: 'sub-crm-01', label: 'documentation', activity: 'Préparer le texte de présentation', status: 'working' as const, elapsedSeconds: 210 },
      ],
    },
  ],

  interventions: [
    {
      id: 'action-crm-01',
      projectId: 'crm',
      sessionId: 'crm-claude-01',
      title: 'choisir la version de l’écran',
      description: 'Demande fictive : la session attend ta décision pour continuer.',
      choices: [
        { id: 'keep', label: 'garder cette version', eventMessage: 'Choix reçu : conserver la proposition. Reprise simulée du travail.' },
        { id: 'adjust', label: 'demander un ajustement', eventMessage: 'Demande d’ajustement reçue. Reprise simulée du travail.' },
      ],
    },
  ],

  conversations: [
    {
      id: 'conv-lws-gpt-01',
      source: 'chatgpt' as Source,
      title: 'organisation du projet',
      projectId: 'lws' as string | null,
      agoSeconds: 86400 * 2,
      messages: [
        { id: 't-01', role: 'user', text: 'Je veux retrouver rapidement les éléments de ce projet.' },
        { id: 't-02', role: 'assistant', text: 'Exemple fictif : nous pouvons commencer par une organisation simple.' },
      ] as MessageSeed[],
    },
    {
      id: 'conv-crm-claude-01',
      source: 'claude' as Source,
      title: 'réflexion sur une interface simple',
      projectId: 'crm' as string | null,
      agoSeconds: 86400,
      messages: [
        { id: 't-03', role: 'user', text: 'Je veux comparer deux idées pour cet écran.' },
        { id: 't-04', role: 'assistant', text: 'Exemple fictif : voici deux pistes à discuter.' },
      ] as MessageSeed[],
    },
    {
      id: 'conv-idees-claude-01',
      source: 'claude' as Source,
      title: 'noms possibles pour l’app',
      projectId: 'idees' as string | null,
      agoSeconds: 3 * 86400,
      messages: [
        { id: 't-07', role: 'user', text: 'Aide-moi à trouver un nom court pour mon outil.' },
        { id: 't-08', role: 'assistant', text: 'Exemple fictif : quelques pistes courtes et faciles à dire.' },
      ] as MessageSeed[],
    },
    {
      id: 'conv-unassigned-01',
      source: 'chatgpt' as Source,
      title: 'une nouvelle idée pour lws',
      projectId: null as string | null,
      agoSeconds: 1800,
      suggestedProjectId: 'lws',
      suggestionReason: 'le nom lws apparaît dans l’échange',
      messages: [
        { id: 't-05', role: 'user', text: 'Une idée fictive pour lws : simplifier la présentation des fichiers.' },
        { id: 't-06', role: 'assistant', text: 'Cette conversation peut servir à tester son association au projet.' },
      ] as MessageSeed[],
    },
  ],

  h24: [
    {
      id: 'h24-lws',
      projectId: 'lws',
      title: 'veille du projet',
      schedule: 'toutes les heures',
      enabled: true,
      runState: 'running' as H24RunState,
      runSeconds: 240,
      lastEvent: 'Analyse de démonstration commencée.',
    },
    {
      id: 'h24-crm',
      projectId: 'crm',
      title: 'classement des échanges',
      schedule: 'chaque nuit à 3 h',
      enabled: true,
      runState: 'waiting' as H24RunState,
      runSeconds: 0,
      lastEvent: 'En veille : prochaine exécution cette nuit.',
    },
  ],

  terminalEvent: {
    id: 'terminal-arrival-01',
    session: {
      id: 'lws-codex-02',
      projectId: 'lws',
      machineId: 'vps-demo-01',
      tool: 'codex' as Tool,
      title: 'vérifier la présentation',
      origin: 'terminal · démo',
      text: 'Session de démonstration ouverte depuis le terminal.',
    },
  },

  mainGreeting:
    'Démo : je comprends quelques demandes simples, comme « reprends le crm » ou « ouvre claude lws ». Le reste, je te demande où l’envoyer.',
}
