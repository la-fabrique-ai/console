# Référence du backend — étapes 1, 3a, 8b et lots 4.1/4.2

Référence du backend des étapes 1, 3a, 8b et lots 4.1/4.2, issue du registre réel de createBackend et des modules src/integrations. Les actions d’extensions de l’autre branche (notamment usage) ne sont pas dans ce registre ; elles ne sont pas couvertes ici. Ne pas s’appuyer sur les anciens mods pour intégrer les écrans V2.

CLI : node src/cli.mjs <action> <objet JSON> ; objet par défaut {}. stdout contient UNE enveloppe JSON terminée par un saut de ligne. Succès de transport : {ok:true,data:...}, exit 0. Exception : {ok:false,error:{code,message,cause?}}, exit 1. cause : la cause technique, séparée du message affiché, quand l’erreur en donne une (LEGACY_ARCHIVE_FAILED) ; filtrée comme le reste. Les champs/chaînes sensibles sont filtrés ; ne pas exposer un stderr brut.

IMPORTANT : ok:true peut contenir status=refused ; inspecter data.status/code, pas seulement ok. Un worker peut aussi publier preparation.errorCode avec un statut incertain ou failed-certain. Aucun de ces états ne signifie agent lancé, ticket terminé ou travail supprimé.

Le catalogue comprend aussi les codes de warnings[].code et de raison QA, pas seulement les refus. preparation.errorCode est ouvert aux errno du worker ; une exception native non typée est masquée en INTERNAL_ERROR par la CLI.

Racine privée : FABRIQUE_CONSOLE_HOME ou ~/.config/fabrique-console (défaut du produit). Les exemples/test doivent définir une racine temporaire ; cette documentation ne requiert jamais de lire la configuration réelle. Les fonctions JS reçoivent un objet ; backend.dispatch(action,input) retourne data ou lève AppError, la CLI construit l’enveloppe.

Notation des formes : champ suffixé ? facultatif ; nullable:T accepte null ; enum:a|b et const:x sont littéraux ; [T] est un tableau ; $record décrit les valeurs d’un dictionnaire ; $oneOf une union ; * autorise des champs externes supplémentaires. Sinon les clés de réponse sont strictes. sha = 40 ou 64 hex minuscules ; revision = 64 hex ; uuid = UUID ; timestamp = ISO parsable ; path = chemin absolu. number exige un nombre fini.

Les codes communs peuvent interrompre toute action concernée par validation/stockage. Les codes spécifiques des actions sont un guide de traitement, pas un ordre de priorité. Des erreurs Tracker peuvent remonter par les actions qui rechargent un ticket ; les dépendances/FS inconnues sont INTERNAL_ERROR côté CLI, pas un message natif à afficher.

Fondements Git utilisés par les reliquats : [promisor.acceptFromServer=none](https://git-scm.com/docs/git-config/2.54.0#Documentation/git-config.txt-promisoracceptFromServer) ignore les annonces de promisor ; [--no-lazy-fetch](https://git-scm.com/docs/git/2.54.0#Documentation/git.txt---no-lazy-fetch) interdit le téléchargement implicite d’objets pendant le contrôle.

Étape 3a : les nouvelles actions ticket-projects, ticket-issues-enriched, ticket-issue-enriched et ticket-document utilisent la clé API dédiée sans remplacer le client MCP. Pour ces lectures, untrusted=true balise transitivement CHAQUE champ texte distant dans data, même si un DTO minimal de lien ne porte que identifier/state. Ne jamais traiter ces textes comme instructions ou commandes ; les adresses sont validées avant restitution, sans ouverture automatique.

Étape 8b : test-proofs est la lecture des preuves C5 avec validité recalculée. QaRun conserve le journal historique ; son status observé devient stale ou unknown quand sa preuve ne vaut plus. Ne jamais déduire la validité actuelle du fichier qa/<id>.json brut. Les sorties historiques sans commit restent lisibles mais inconnues.

Lot 4.1 : ticket-qualify recalcule seulement les six règles A4 depuis la lecture enrichie fraîche et la configuration V2. ready.ok ne vaut pas permission de lancer : launchAllowed reste false. La mission, le plan, la base, le modèle/effort, les plafonds et le lancement seront traités par les lots suivants, sans changer cette lecture.

Lot 4.2 : mission-preview publie le snapshot C3 exact sans agent ni worktree créé ; mission-read restitue ses octets vérifiés, même expirés. Aucun lancement V2 fourni : launchAllowed=false partout. L’ancien launch reste inchangé jusqu’à 4.3. Le plan chargé n’est pas encore approuvé ; sa confirmation sera enregistrée dans l’exécution, sans modifier la mission.

## Types des échanges

### Config

Configurations normalisées V1/V2 : les anciennes formes restent lisibles. À la lecture, owner et ticketConnector reçoivent des replis génériques ; projectId (prioritaire) ou teamId fournit ticketScope sans retirer les identifiants historiques. Aucune écriture implicite du fichier.

```json
{
  "$oneOf": [
    "ConfigV1",
    "ConfigV2"
  ]
}
```

### ConfigV1

Compatibilité V1. machine est null. key : identifiant minuscule 1–48 ; projectId ou teamId requis ; chemins absolus ; mainBranch valide. Les champs inconnus V1 sont normalisés par le validateur historique. Budgets facultatifs par rôle ; projet > global > défaut (800k/750k par ticket/400k par revue/1M).

```json
{
  "version": 1,
  "tracker": "TrackerSettings",
  "projects": [
    "LegacyProject"
  ],
  "budgets?": {
    "lead?": "positive safe integer",
    "dev?": "positive safe integer",
    "reviewer?": "positive safe integer",
    "qa?": "positive safe integer"
  },
  "owner": {
    "id": "string",
    "displayName": "string"
  },
  "ticketConnector": "string"
}
```

### TrackerSettings

transport mcp ou graphql ; endpoint MCP officiel uniquement, endpoint GraphQL optionnel officiel en V2.

```json
{
  "transport": "enum:mcp|graphql",
  "endpoint?": "string"
}
```

### TestProfile

argv direct non vide (pas de shell/wrapper), 1–100 arguments sans NUL ; timeoutMs 100–3600000, défaut 120000 ; terminal facultatif.

```json
{
  "argv": [
    "string"
  ],
  "timeoutMs": "integer",
  "terminal?": "boolean"
}
```

### LegacyProject

Configuration V1 : preferredAgent requis, tests normalisés. Les chemins/branche sont non nuls ; voir LegacyProjection pour snapshot V2. Budgets facultatifs par rôle ; projet > global > défaut (800k/750k par ticket/400k par revue/1M).

```json
{
  "key": "string",
  "name?": "string",
  "projectId?": "string",
  "teamId?": "string",
  "repo": "path",
  "preferredAgent": "enum:claude|codex",
  "mainBranch": "string",
  "machine": null,
  "tests": {
    "$record": "TestProfile"
  },
  "budgets?": {
    "lead?": "positive safe integer",
    "dev?": "positive safe integer",
    "reviewer?": "positive safe integer",
    "qa?": "positive safe integer"
  },
  "color": "string",
  "icon": "string",
  "leadLayout": "enum:generic|generated",
  "ticketScope": {
    "connection": "string",
    "scopeId": "string"
  }
}
```

### ConfigV2

Toutes les clés V2 sont validées strictement. Chemins absolus, clé unique ; IDs/textes non vides ≤200 sans contrôles. teamId peut manquer au stockage mais la sélection le refuse. Deux dépôts du même projet ne peuvent partager le même git-common-dir. Budgets facultatifs par rôle ; projet > global > défaut (800k/750k par ticket/400k par revue/1M).

```json
{
  "version": 2,
  "tracker": "TrackerSettings",
  "worktreesRoot": "path",
  "wip": {
    "dev": "integer",
    "review": "integer",
    "maxParallelDevs": "integer"
  },
  "launch": {
    "confirm": "enum:each|wave"
  },
  "projects": [
    "ProjectV2"
  ],
  "profiles": "Profiles",
  "budgets?": {
    "lead?": "positive safe integer",
    "dev?": "positive safe integer",
    "reviewer?": "positive safe integer",
    "qa?": "positive safe integer"
  },
  "owner": {
    "id": "string",
    "displayName": "string"
  },
  "ticketConnector": "string"
}
```

### ProjectV2

kind produit/annexe ; couleur #RRGGBB ; machine null ; au moins un dépôt. WIP dev/review 1–100, maxParallelDevs global 1–4 ; la préparation plafonne les dev à min(maxParallelDevs,2), revues séparées par projet. Les champs wip.dev ne sont pas le plafond dev effectif de cette préparation : celui-ci est global min(maxParallelDevs,2) ; les revues suivent project.wip.review ou wip.review. Budgets facultatifs par rôle ; projet > global > défaut (800k/750k par ticket/400k par revue/1M).

```json
{
  "key": "string",
  "name?": "string",
  "projectId?": "string",
  "teamId?": "string",
  "kind": "enum:produit|annexe",
  "color": "string",
  "preferredAgent?": "enum:claude|codex",
  "machine": null,
  "wip?": {
    "dev": "integer",
    "review": "integer"
  },
  "repos": [
    "RepositoryConfig"
  ],
  "budgets?": {
    "lead?": "positive safe integer",
    "dev?": "positive safe integer",
    "reviewer?": "positive safe integer",
    "qa?": "positive safe integer"
  },
  "icon": "string",
  "leadLayout": "enum:generic|generated",
  "ticketScope": {
    "connection": "string",
    "scopeId": "string"
  }
}
```

### RepositoryConfig

labels/aliases : au plus 100 textes distincts chacun, comparaison exacte sur id ou nom. verification est un état de configuration, pas une preuve. tests optionnels à l’entrée, toujours normalisés en sortie.

```json
{
  "key": "string",
  "path": "path",
  "labels": [
    "string"
  ],
  "aliases": [
    "string"
  ],
  "mainBranch": "string",
  "verification": "enum:required|verified",
  "tests": {
    "$record": "TestProfile"
  }
}
```

### Profiles

version non vide ; dev/review ne contiennent que claude/codex puis léger/standard/fort, tous facultatifs. Modèles autorisés par politique locale : codex gpt-6-luna, gpt-6.1-sol, gpt-6-astra ; claude claude-haiku-5-5, claude-sonnet-5-5, claude-opus-5-5. Pas une preuve de disponibilité sur le compte ; effort low/medium/high. unconfigured + objets vides est valide.

```json
{
  "version": "string",
  "dev": {
    "$record": {
      "$record": {
        "model": "string",
        "effort": "enum:low|medium|high"
      }
    }
  },
  "review": {
    "$record": {
      "$record": {
        "model": "string",
        "effort": "enum:low|medium|high"
      }
    }
  }
}
```

### ReadConfig

revision = SHA-256 des octets exacts de config.json, null si absent ; conserver le couple document/révision pendant l’édition.

```json
{
  "config": "Config",
  "revision": "nullable:revision"
}
```

### SaveV1

Réponse V1 historique sans revision. Relire read-config pour obtenir la révision.

```json
{
  "config": "ConfigV1"
}
```

### SaveV2

Nouvelle révision des octets publiés, pas une empreinte canonique du JS.

```json
{
  "config": "ConfigV2",
  "revision": "revision"
}
```

### Migration

already-v2 ne comporte aucun chemin/empreinte. migrated/already-migrated donnent la sauvegarde et le journal ; targetHash est canonique, à ne pas utiliser comme baseRevision.

```json
{
  "$oneOf": [
    {
      "status": "const:already-v2",
      "config": "ConfigV2"
    },
    {
      "status": "enum:migrated|already-migrated",
      "config": "ConfigV2",
      "backupPath": "path",
      "journalPath": "path",
      "sourceHash": "revision",
      "targetHash": "revision"
    }
  ]
}
```

### IssueSnapshot

Entrée de repo-preview uniquement : id obligatoire ≤200, team/project null ou {id}, labels [{id?,name?}] ≤100 dont au moins un id/nom, updatedAt ISO ou null. Autres champs Tracker tolérés. Les champs supplémentaires de l’action, eux, sont refusés.

```json
{
  "id": "string",
  "team?": {
    "$oneOf": [
      null,
      {
        "id?": "nullable:string",
        "*": "any"
      }
    ]
  },
  "project?": {
    "$oneOf": [
      null,
      {
        "id": "string",
        "*": "any"
      }
    ]
  },
  "labels?": [
    {
      "id?": "string",
      "name?": "string",
      "*": "any"
    }
  ],
  "updatedAt?": "nullable:timestamp",
  "*": "any"
}
```

### Preview

Résolution physique de l’action ; source reste le ticket de l’appelant, jamais une autorisation de lancement. matchedLabels sont des données non fiables à afficher en texte.

```json
{
  "issueId": "string",
  "source": "const:ticket fourni par l'appelant",
  "issueUpdatedAt": "nullable:timestamp",
  "launchAllowed": false,
  "projectKey": "string",
  "status": "const:resolved",
  "selection": "enum:single-repository|labels",
  "matchedLabels": [
    "string"
  ],
  "repository": {
    "key": "string",
    "path": "path",
    "mainBranch": "string",
    "mainBranchChecked": false,
    "configVerification": "enum:required|verified",
    "gitCommonDir": "path"
  },
  "configRevision": "nullable:revision"
}
```

### PreviewRefusal

Refus de sélection, sans agentLaunched ; configRevision ajouté par l’action même en refus. projectKey/candidates dépendent du stade atteint.

```json
{
  "issueId": "string",
  "source": "const:ticket fourni par l'appelant",
  "issueUpdatedAt": "nullable:timestamp",
  "launchAllowed": false,
  "status": "const:refused",
  "code": "code",
  "message": "string",
  "configRevision": "nullable:revision",
  "projectKey?": "string",
  "candidates?": [
    "string"
  ]
}
```

### Refusal

Refus métier retourné (CLI ok:true), non une exception. Les extras dépendent du code : BASE_CONFIRMATION_REQUIRED donne planId/manifestHash/base ; LANE_BUSY occupants ; collisions préparation préparationId.

```json
{
  "status": "const:refused",
  "code": "code",
  "message": "string",
  "agentLaunched": false,
  "preparationId?": "string",
  "planId?": "uuid",
  "manifestHash?": "revision",
  "base?": "Base",
  "occupants?": [
    "string"
  ]
}
```

### Base

fetch.status décrit le téléchargement ; verified/verification décrivent la relation. Un succès réseau avec historique tronqué peut donc être non vérifié. origin n’est proposé que derrière une base fraîche vérifiée. remoteRef nomme le suivi laissé inchangé ; options.origin.ref est la branche du distant, accompagnée de remote=origin et du SHA observé.

```json
{
  "mainBranch": "string",
  "localRef": "string",
  "remote": "const:origin",
  "remoteRef": "string",
  "localSha": "sha",
  "remoteSha": "nullable:sha",
  "chosenSha": "sha",
  "source": "enum:local|origin|review",
  "options": [
    {
      "source": "enum:local|origin|review",
      "ref?": "string",
      "remote?": "const:origin",
      "sha": "sha"
    }
  ],
  "relation": "enum:equal|ahead|behind|diverged|unknown",
  "ahead": "nullable:integer",
  "behind": "nullable:integer",
  "verified": "boolean",
  "shallow": "boolean",
  "verification": {
    "status": "enum:verified|unverified",
    "reason": {
      "$oneOf": [
        null,
        "enum:fetch-unavailable|shallow-repository|relation-unavailable"
      ]
    }
  },
  "fetch": {
    "status": "enum:succeeded|failed|missing",
    "attemptedAt": "timestamp",
    "lastSucceededAt": "nullable:timestamp",
    "reason?": "enum:timeout|fetch-failed",
    "observedAt": "nullable:timestamp",
    "observedSha": "nullable:sha",
    "trackingRefUpdated": false,
    "writes": [
      "enum:objects|temporary-locks"
    ],
    "notice": "string"
  }
}
```

### PlanInput

Seules ces clés sont acceptées. dev : reviewCommit interdit ; review : reviewCommit SHA complet obligatoire, baseSource interdit. Valeur par défaut de baseSource : local.

```json
{
  "issueId": "string",
  "tool": "enum:claude|codex",
  "role": "enum:dev|review",
  "reviewCommit?": "sha",
  "baseSource?": "enum:local|origin"
}
```

### RepositoryIdentity

dev/ino source et common-dir en chaînes décimales (BigInt préservé).

```json
{
  "repo": {
    "dev": "string",
    "ino": "string"
  },
  "common": {
    "dev": "string",
    "ino": "string"
  }
}
```

### Plan

Plan persisté mais sans réservation de capacité. issue.identifier est normalisé en identifiant de chemin ; ce n’est pas le libellé Tracker original. manifestHash fige entrée/ticket/configuration/dépôt/base/capacité, hors dates fetch ; branch null pour review.

```json
{
  "status": "const:planned",
  "planId": "uuid",
  "instanceId": "uuid",
  "sessionId": "uuid",
  "runId": "uuid",
  "createdAt": "timestamp",
  "input": "PlanInput",
  "issue": {
    "id": "string",
    "identifier": "string",
    "updatedAt": "nullable:timestamp"
  },
  "issueFingerprint": "revision",
  "configRevision": "revision",
  "projectKey": "string",
  "repoKey": "string",
  "repo": "path",
  "gitCommonDir": "path",
  "repositoryIdentity": "RepositoryIdentity",
  "worktreesRoot": "path",
  "worktree": "path",
  "branch": "nullable:string",
  "branchSource": "enum:tracker|fallback|detached",
  "base": "Base",
  "gitVersion": "string",
  "laneSnapshot": [
    "string"
  ],
  "needsConfirmation": "boolean",
  "agentLaunched": false,
  "manifestHash": "revision"
}
```

### Preparation

Sous-document public : aucun PID/nonce interne. preparedAt/errorCode apparaissent seulement si enregistrés ; status peut différer du status de réponse (checkout-ready est présenté needs-finalization, failed-released est présenté released). errorCode peut aussi contenir un errno natif opaque : traiter le statut et la preuve, pas un code inconnu comme une autorisation. Sa base est le snapshot historique enregistré, pas nécessairement le DTO Base courant.

```json
{
  "preparationId": "string",
  "planId": "uuid",
  "instanceId": "uuid",
  "sessionId": "uuid",
  "runId": "uuid",
  "issueId": "string",
  "tool": "enum:claude|codex",
  "role": "enum:dev|review",
  "projectKey": "string",
  "repoKey": "string",
  "repo": "path",
  "gitCommonDir": "path",
  "worktree": "path",
  "branch": "nullable:string",
  "base": "StoredBase",
  "status": "enum:reserved|creating|checkout-ready|prepared|uncertain|failed-certain|released|failed-released",
  "phase": "string",
  "createdAt": "timestamp",
  "updatedAt": "timestamp",
  "preparedAt?": "timestamp",
  "errorCode?": "string"
}
```

### Inspection

Preuve détaillée ; partial conserve la réservation. Raisons : identité absente/changée, déplacement, ancêtre changé, appartenance/chemin/HEAD/index/contenu/branche incohérents, cleanup en cours ou inspection impossible.

```json
{
  "state": "enum:in-progress|group-reused|partial|none|cleaned|failed-owned-empty|prepared|attach",
  "reason?": "string",
  "head?": "sha",
  "owned?": "boolean",
  "birth?": "string",
  "path?": "path",
  "ancestor?": "path"
}
```

### Advice

Conseil à afficher, pas une commande à exécuter automatiquement. Les argv sont séparés ; note facultative.

```json
{
  "program": "string",
  "argv": [
    "string"
  ],
  "requiresConfirmation": "boolean",
  "note?": "string"
}
```

### CleanupProposal

Seul un dossier vide revendiqué par l’outil, sans entrée worktree Git ni branche subsistante. .DS_Store le rend non vide. hash lie l’état exact, l’identité et les commandes.

```json
{
  "kind": "const:empty-directory",
  "snapshot": {
    "dev": "integer",
    "ino": "integer"
  },
  "commands": [
    {
      "program": "const:rmdir",
      "argv": [
        "path"
      ]
    }
  ],
  "hash": "revision",
  "requiresConfirmation": true
}
```

### PreparationResult

Ne signifie jamais qu’un agent est lancé. proof/inspection/automaticRelease/manualCleanup/cleanupProposal sont absents pour une réponse active ou un release simple ; reused seulement en reprise ; forced seulement pour sortie forcée.

```json
{
  "status": "enum:creating|prepared|uncertain|failed-certain|needs-finalization|released",
  "preparationId": "string",
  "preparation": "Preparation",
  "preparationHash": "revision",
  "agentLaunched": false,
  "reused?": "boolean",
  "warning?": "string",
  "forced?": true,
  "proof?": "string",
  "inspection?": "Inspection",
  "automaticRelease?": "boolean",
  "manualCleanup?": [
    "Advice"
  ],
  "cleanupProposal?": {
    "$oneOf": [
      null,
      "CleanupProposal"
    ]
  }
}
```

### FetchInspection

Lecture sans effacement. Une fin prouvée sera réconciliée par un prochain plan ; inspector ne le fait pas.

```json
{
  "fetches": [
    {
      "id": "string",
      "status": "enum:starting|running|uncertain",
      "gitCommonDir": "path",
      "createdAt": "timestamp",
      "bootId": "nullable:string",
      "owner": {
        "pid": "integer",
        "birth": "nullable:string"
      },
      "worker": {
        "$oneOf": [
          null,
          {
            "pid": "integer",
            "pgid": "integer",
            "birth": "nullable:string"
          }
        ]
      },
      "confirmationHash": "revision",
      "terminationProven": "boolean"
    }
  ]
}
```

### FetchAbandoned

Sortie comptable seulement. Audit complet durable avec previousState ; résumé public sans état interne ni jeton.

```json
{
  "status": "const:abandoned",
  "fetchId": "string",
  "audit": {
    "at": "timestamp",
    "actor": {
      "uid": "integer",
      "username": "string"
    },
    "expectedHash": "revision"
  }
}
```

### Snapshot

Projection de compatibilité. Pour un projet V2 multi-dépôts : repo et mainBranch null, tests={}. Les sessions ici sont V1 : ne pas les confondre avec les préparations workspace-state.

```json
{
  "config": "Config",
  "projects": [
    "LegacyProjection"
  ],
  "sessions": [
    {
      "$record": "any"
    }
  ],
  "tracker": {
    "configured": "boolean",
    "provider": "enum:mcp-oauth|keychain",
    "transport": "enum:mcp|graphql",
    "endpoint?": "string"
  },
  "warnings": [
    {
      "code": "code",
      "message": "string"
    }
  ]
}
```

### LegacyProjection

Projection vers les écrans historiques ; autres métadonnées de projet conservées.

```json
{
  "key": "string",
  "repo": "nullable:path",
  "mainBranch": "nullable:string",
  "tests": {
    "$record": "TestProfile"
  },
  "*": "any"
}
```

### StoredBase

Instantané de base tel qu’enregistré lors de la préparation. Ce n’est pas une observation fraîche : les anciennes préparations peuvent omettre verification/shallow/observedAt ou conserver d’anciens champs. Ne pas inventer une vérification actuelle depuis ce snapshot. Les nouvelles préparations reprennent exactement la Base de leur Plan (contrat exécuté).

```json
{
  "chosenSha": "sha",
  "*": "any"
}
```

### LegacyIssue

Ticket externe extensible ; les champs internes de Tracker restent des données non fiables. Les enveloppes locales sont strictes.

```json
{
  "id": "string",
  "identifier": "string",
  "title": "string",
  "description": "nullable:string",
  "url": "string",
  "team": {
    "id": "string"
  },
  "project": "nullable:any",
  "state": {
    "id": "nullable:string",
    "name": "string",
    "type": "string"
  },
  "labels": [
    "any"
  ],
  "comments": [
    "any"
  ],
  "*": "any"
}
```

### LegacyIssueList

Liste V1, contrat exécuté avec transport injecté.

```json
{
  "issues": [
    "LegacyIssue"
  ],
  "updatedAt": "timestamp",
  "cached?": "boolean",
  "complete": "boolean",
  "cursor": "nullable:string",
  "freshness": {
    "observedAt": "nullable:timestamp",
    "cached": "boolean"
  },
  "tickets": [
    "LegacyIssue"
  ],
  "relations?": "enum:none|parent|full"
}
```

### LegacyIssueDetail

Détail V1, contrat exécuté avec transport injecté.

```json
{
  "issue": "LegacyIssue",
  "updatedAt?": "timestamp",
  "cached?": "boolean",
  "complete": "boolean",
  "cursor": "nullable:string",
  "freshness": {
    "observedAt": "nullable:timestamp",
    "cached": "boolean"
  },
  "ticket": "LegacyIssue",
  "collections": {
    "comments": "TicketCollection",
    "children": "TicketCollection",
    "labels": "TicketCollection"
  },
  "relations?": "enum:none|parent|full",
  "commentsComplete?": "boolean"
}
```

### LegacyTrackerMeta

Métadonnées V1, valeurs distantes extensibles.

```json
{
  "states": [
    "any"
  ],
  "viewer?": "any",
  "teams?": [
    "any"
  ],
  "projects?": [
    "any"
  ],
  "updatedAt?": "timestamp",
  "cached?": "boolean",
  "complete": "boolean",
  "cursor": "nullable:string",
  "freshness": {
    "observedAt": "nullable:timestamp",
    "cached": "boolean"
  },
  "scopes": [
    "any"
  ],
  "capabilities": "TicketCapabilities",
  "readOnly?": "boolean"
}
```

### ProjectSummary

Résumé calculé uniquement depuis une lecture complète réussie.

```json
{
  "key": "string",
  "open": "nullable:integer",
  "total": "integer",
  "unknown": "integer",
  "updatedAt": "timestamp",
  "cached?": "boolean",
  "source": "const:tracker",
  "complete": true
}
```

### LegacyGit

Observation Git V1.

```json
{
  "branch": "string",
  "status": "string",
  "diff": "string",
  "stat": "string",
  "commits": "string"
}
```

### QaRun

Journal QA historique et observation recalculée ; passed ne vaut succès actuel que si la preuve C5 correspond au code courant. Lire test-proofs pour le résultat d’origine et sa validité. Les états explicites timed-out/interrupted/error/failed restent informatifs en cas de preuve inconnue, sans devenir un succès C5.

```json
{
  "id": "uuid",
  "sessionId": "uuid",
  "profile": "string",
  "argv": [
    "string"
  ],
  "timeoutMs": "integer",
  "cwd": "path",
  "execution": "enum:inline|terminal",
  "workerPid": "nullable:integer",
  "status": "string",
  "startedAt": "timestamp",
  "finishedAt": "nullable:timestamp",
  "exitCode": "nullable:integer",
  "stdout": "string",
  "stderr": "string",
  "terminalId": "nullable:string",
  "reason?": "code",
  "outputTruncated?": "boolean",
  "signal?": "nullable:string"
}
```

### LegacyQA

Enveloppe QA V1 stricte.

```json
{
  "run": "QaRun"
}
```

### StoppedSessionV1

Session V1 explicitement arrêtée, sans modification des données historiques.

```json
{
  "id": "uuid",
  "issueId": "string",
  "identifier": "string",
  "title": "string",
  "issueUrl": "string",
  "tool": "string",
  "review": "boolean",
  "reviewSource?": "any",
  "projectKey": "string",
  "repo": "path",
  "worktree": "path",
  "branch": "string",
  "mainBranch": "string",
  "baseCommit": "sha",
  "terminalId": "nullable:string",
  "status": "string",
  "createdAt": "timestamp",
  "updatedAt": "timestamp",
  "qaId": "nullable:uuid",
  "launchUncertain": "boolean",
  "lastStartedAt?": "timestamp",
  "stoppedAt": "timestamp",
  "qa": "nullable:QaRun",
  "launchAttemptAt": "timestamp",
  "firstMessageSent": "nullable:boolean"
}
```

### LegacyStop

Enveloppe arrêt V1 stricte.

```json
{
  "session": "StoppedSessionV1"
}
```

### LegacyProposal

Rapport local V1, aucune publication distante.

```json
{
  "path": "path",
  "content": "string",
  "proposal": {
    "issueId": "string",
    "comment": "string"
  },
  "pr": {
    "title": "string",
    "base": "nullable:string",
    "head": "string",
    "body": "string"
  },
  "report": "CommitReport"
}
```

### LegacyMutation

Contrat exécuté avec mutation simulée ; aucune écriture réelle autorisée en 3a.

```json
{
  "success": true
}
```

### EnrichedState

Statut de ticket. Le nom est du texte externe non fiable ; unknown reste inconnu.

```json
{
  "id": "nullable:string",
  "name": "nullable:string",
  "type": "enum:backlog|unstarted|started|completed|canceled|triage|unknown"
}
```

### EnrichedLink

Dans l’équipe : identifiant interne et métier, état. Hors équipe ou prérequis archivé : identifier et state uniquement, sans titre, équipe ou adresse. Exception limitée aux blockedBy : les autres liens archivés restent exclus.

```json
{
  "$oneOf": [
    {
      "id": "nullable:string",
      "identifier": "nullable:string",
      "state": "EnrichedState",
      "untrusted": true
    },
    {
      "identifier": "nullable:string",
      "state": "EnrichedState"
    }
  ]
}
```

### EnrichedPartialReason

Cause locale fixe de partialité, jamais le message distant brut.

```json
{
  "path": "string",
  "reason": "enum:deadline|request-timeout|request-limit|node-limit|page-limit|invalid-cursor|invalid-connection|invalid-node|duplicate-node|unavailable|api-error|rate-limit|complexity-limit|response-too-large|scope-unverified|unknown-status|document-truncated|api-key-unavailable|archived-excluded"
}
```

### EnrichedLabel

Étiquette externe, y compris agent: et niveau:.

```json
{
  "id": "string",
  "name": "nullable:string",
  "untrusted": true
}
```

### EnrichedMilestone

Jalon Tracker ; progression native, pas un décompte reconstruit depuis une page.

```json
{
  "id": "string",
  "name": "nullable:string",
  "description": "nullable:string",
  "progress": "nullable:number",
  "status": "nullable:string",
  "targetDate": "nullable:string",
  "createdAt": "nullable:string",
  "updatedAt": "nullable:string",
  "untrusted": true
}
```

### EnrichedDocumentMetadata

Métadonnées seules ; URL HTTPS validée par le connecteur, sinon null. Aucun contenu chargé par la liste.

```json
{
  "id": "string",
  "title": "nullable:string",
  "createdAt": "nullable:string",
  "updatedAt": "nullable:string",
  "url": "nullable:string",
  "untrusted": true
}
```

### EnrichedLabelCollection

items=null si non lu ; tableau possiblement partiel sinon. total=null tant que cette collection et ses sous-collections requises ne sont pas complètes. reasons concerne cette connexion ; partialReasons à la racine inclut tous les descendants.

```json
{
  "items": {
    "$oneOf": [
      null,
      [
        "EnrichedLabel"
      ]
    ]
  },
  "complete": "boolean",
  "total": "nullable:integer",
  "reasons": [
    "enum:deadline|request-timeout|request-limit|node-limit|page-limit|invalid-cursor|invalid-connection|invalid-node|duplicate-node|unavailable|api-error|rate-limit|complexity-limit|response-too-large|scope-unverified|unknown-status|document-truncated|api-key-unavailable|archived-excluded"
  ],
  "cursor?": "nullable:string"
}
```

### EnrichedLinkCollection

items=null si non lu ; tableau possiblement partiel sinon. total=null tant que cette collection et ses sous-collections requises ne sont pas complètes. reasons concerne cette connexion ; partialReasons à la racine inclut tous les descendants.

```json
{
  "items": {
    "$oneOf": [
      null,
      [
        "EnrichedLink"
      ]
    ]
  },
  "complete": "boolean",
  "total": "nullable:integer",
  "reasons": [
    "enum:deadline|request-timeout|request-limit|node-limit|page-limit|invalid-cursor|invalid-connection|invalid-node|duplicate-node|unavailable|api-error|rate-limit|complexity-limit|response-too-large|scope-unverified|unknown-status|document-truncated|api-key-unavailable|archived-excluded"
  ],
  "cursor?": "nullable:string"
}
```

### EnrichedMilestoneCollection

items=null si non lu ; tableau possiblement partiel sinon. total=null tant que cette collection et ses sous-collections requises ne sont pas complètes. reasons concerne cette connexion ; partialReasons à la racine inclut tous les descendants.

```json
{
  "items": {
    "$oneOf": [
      null,
      [
        "EnrichedMilestone"
      ]
    ]
  },
  "complete": "boolean",
  "total": "nullable:integer",
  "reasons": [
    "enum:deadline|request-timeout|request-limit|node-limit|page-limit|invalid-cursor|invalid-connection|invalid-node|duplicate-node|unavailable|api-error|rate-limit|complexity-limit|response-too-large|scope-unverified|unknown-status|document-truncated|api-key-unavailable|archived-excluded"
  ],
  "cursor?": "nullable:string"
}
```

### EnrichedDocumentCollection

items=null si non lu ; tableau possiblement partiel sinon. total=null tant que cette collection et ses sous-collections requises ne sont pas complètes. reasons concerne cette connexion ; partialReasons à la racine inclut tous les descendants.

```json
{
  "items": {
    "$oneOf": [
      null,
      [
        "EnrichedDocumentMetadata"
      ]
    ]
  },
  "complete": "boolean",
  "total": "nullable:integer",
  "reasons": [
    "enum:deadline|request-timeout|request-limit|node-limit|page-limit|invalid-cursor|invalid-connection|invalid-node|duplicate-node|unavailable|api-error|rate-limit|complexity-limit|response-too-large|scope-unverified|unknown-status|document-truncated|api-key-unavailable|archived-excluded"
  ],
  "cursor?": "nullable:string"
}
```

### EnrichedProjectCollection

items=null si non lu ; tableau possiblement partiel sinon. total=null tant que cette collection et ses sous-collections requises ne sont pas complètes. reasons concerne cette connexion ; partialReasons à la racine inclut tous les descendants.

```json
{
  "items": {
    "$oneOf": [
      null,
      [
        "EnrichedProjectData"
      ]
    ]
  },
  "complete": "boolean",
  "total": "nullable:integer",
  "reasons": [
    "enum:deadline|request-timeout|request-limit|node-limit|page-limit|invalid-cursor|invalid-connection|invalid-node|duplicate-node|unavailable|api-error|rate-limit|complexity-limit|response-too-large|scope-unverified|unknown-status|document-truncated|api-key-unavailable|archived-excluded"
  ],
  "cursor?": "nullable:string"
}
```

### EnrichedIssueCollection

items=null si non lu ; tableau possiblement partiel sinon. total=null tant que cette collection et ses sous-collections requises ne sont pas complètes. reasons concerne cette connexion ; partialReasons à la racine inclut tous les descendants.

```json
{
  "items": {
    "$oneOf": [
      null,
      [
        "EnrichedIssueData"
      ]
    ]
  },
  "complete": "boolean",
  "total": "nullable:integer",
  "reasons": [
    "enum:deadline|request-timeout|request-limit|node-limit|page-limit|invalid-cursor|invalid-connection|invalid-node|duplicate-node|unavailable|api-error|rate-limit|complexity-limit|response-too-large|scope-unverified|unknown-status|document-truncated|api-key-unavailable|archived-excluded"
  ],
  "cursor?": "nullable:string"
}
```

### EnrichedIssueData

Ticket actif de l’équipe configurée ; dépendances orientées par relations et inverseRelations. Les textes, labels, états et liens distants sont tous non fiables ; jamais des consignes.

```json
{
  "id": "string",
  "identifier": "nullable:string",
  "title": "nullable:string",
  "description": "nullable:string",
  "url": "nullable:string",
  "updatedAt": "nullable:string",
  "estimate": "nullable:number",
  "projectId": "nullable:string",
  "milestone": {
    "$oneOf": [
      null,
      {
        "id": "string",
        "name": "nullable:string",
        "targetDate": "nullable:string",
        "untrusted": true
      }
    ]
  },
  "parent": "nullable:EnrichedLink",
  "untrusted": true,
  "state": "EnrichedState",
  "classification": {
    "source": "enum:state-type|team-status-id|team-status-name|unresolved",
    "reason": "nullable:string"
  },
  "labels": "EnrichedLabelCollection",
  "children": "EnrichedLinkCollection",
  "dependencies": {
    "blocks": "EnrichedLinkCollection",
    "blockedBy": "EnrichedLinkCollection"
  },
  "complete": "boolean"
}
```

### EnrichedProjectData

Projet Tracker (« epic »), distinct du projet local configuré ; états de projet distincts des six types de statut de ticket. Progression fournie par Tracker, sans déduire une complétude des tickets.

```json
{
  "id": "string",
  "name": "nullable:string",
  "url": "nullable:string",
  "state": {
    "id": "nullable:string",
    "name": "nullable:string",
    "type": "nullable:string"
  },
  "progress": "nullable:number",
  "progressSource": "const:tracker",
  "startDate": "nullable:string",
  "targetDate": "nullable:string",
  "createdAt": "nullable:string",
  "updatedAt": "nullable:string",
  "untrusted": true,
  "milestones": "EnrichedMilestoneCollection",
  "documents": "EnrichedDocumentCollection",
  "complete": "boolean"
}
```

### EnrichedDocumentData

Contenu Markdown externe non interprété. Au-delà de 256 Kio UTF-8 : tronqué à une limite de caractère, truncated=true et réponse partielle. Aucun téléchargement via URL documentaire.

```json
{
  "id": "string",
  "title": "nullable:string",
  "createdAt": "nullable:string",
  "updatedAt": "nullable:string",
  "url": "nullable:string",
  "untrusted": true,
  "content": "nullable:string",
  "truncated": "boolean"
}
```

### EnrichedProjects

Enveloppe de lecture enrichie. Sans clé : unavailable ; panne ou plafond : partial, explicite même sans premier élément. observedAt date la fin du relevé ; cached conserve la date du relevé initial. Toute chaîne distante dans data est balisée non fiable par untrusted=true à la racine, y compris les noms de statuts des liens minimaux.

```json
{
  "status": "enum:complete|partial|unavailable",
  "available": "boolean",
  "complete": "boolean",
  "observedAt": "timestamp",
  "source": "const:ticket-api-key",
  "cached": "boolean",
  "scope": {
    "key": "string",
    "teamId": "string",
    "projectId": "nullable:string",
    "includeArchived": false,
    "linkedOutsideTeam": "const:identifier-state-only"
  },
  "untrusted": true,
  "partialReasons": [
    "EnrichedPartialReason"
  ],
  "limits": {
    "pageSize": "integer",
    "seedSize": "integer",
    "maxPages": "integer",
    "maxRequests": "integer",
    "maxNodes": "integer",
    "budgetMs": "integer",
    "documentBytes": "integer"
  },
  "usage": {
    "requests": "integer",
    "nodes": "integer",
    "maxComplexity": "nullable:number"
  },
  "data": {
    "projects": "EnrichedProjectCollection"
  },
  "cursor": "nullable:string",
  "freshness": {
    "observedAt": "nullable:timestamp",
    "cached": "boolean"
  },
  "collection": "EnrichedProjectCollection"
}
```

### EnrichedIssues

Enveloppe de lecture enrichie. Sans clé : unavailable ; panne ou plafond : partial, explicite même sans premier élément. observedAt date la fin du relevé ; cached conserve la date du relevé initial. Toute chaîne distante dans data est balisée non fiable par untrusted=true à la racine, y compris les noms de statuts des liens minimaux.

```json
{
  "status": "enum:complete|partial|unavailable",
  "available": "boolean",
  "complete": "boolean",
  "observedAt": "timestamp",
  "source": "const:ticket-api-key",
  "cached": "boolean",
  "scope": {
    "key": "string",
    "teamId": "string",
    "projectId": "nullable:string",
    "includeArchived": false,
    "linkedOutsideTeam": "const:identifier-state-only"
  },
  "untrusted": true,
  "partialReasons": [
    "EnrichedPartialReason"
  ],
  "limits": {
    "pageSize": "integer",
    "seedSize": "integer",
    "maxPages": "integer",
    "maxRequests": "integer",
    "maxNodes": "integer",
    "budgetMs": "integer",
    "documentBytes": "integer"
  },
  "usage": {
    "requests": "integer",
    "nodes": "integer",
    "maxComplexity": "nullable:number"
  },
  "data": {
    "issues": "EnrichedIssueCollection"
  },
  "cursor": "nullable:string",
  "freshness": {
    "observedAt": "nullable:timestamp",
    "cached": "boolean"
  },
  "collection": "EnrichedIssueCollection",
  "tickets": {
    "$oneOf": [
      null,
      [
        "ConnectorEnrichedTicket"
      ]
    ]
  }
}
```

### EnrichedIssue

Enveloppe de lecture enrichie. Sans clé : unavailable ; panne ou plafond : partial, explicite même sans premier élément. observedAt date la fin du relevé ; cached conserve la date du relevé initial. Toute chaîne distante dans data est balisée non fiable par untrusted=true à la racine, y compris les noms de statuts des liens minimaux.

```json
{
  "status": "enum:complete|partial|unavailable",
  "available": "boolean",
  "complete": "boolean",
  "observedAt": "timestamp",
  "source": "const:ticket-api-key",
  "cached": "boolean",
  "scope": {
    "key": "string",
    "teamId": "string",
    "projectId": "nullable:string",
    "includeArchived": false,
    "linkedOutsideTeam": "const:identifier-state-only"
  },
  "untrusted": true,
  "partialReasons": [
    "EnrichedPartialReason"
  ],
  "limits": {
    "pageSize": "integer",
    "seedSize": "integer",
    "maxPages": "integer",
    "maxRequests": "integer",
    "maxNodes": "integer",
    "budgetMs": "integer",
    "documentBytes": "integer"
  },
  "usage": {
    "requests": "integer",
    "nodes": "integer",
    "maxComplexity": "nullable:number"
  },
  "data": {
    "issue": "nullable:EnrichedIssueData"
  },
  "cursor": "nullable:string",
  "freshness": {
    "observedAt": "nullable:timestamp",
    "cached": "boolean"
  },
  "ticket": "nullable:ConnectorEnrichedTicket"
}
```

### EnrichedDocument

Enveloppe de lecture enrichie. Sans clé : unavailable ; panne ou plafond : partial, explicite même sans premier élément. observedAt date la fin du relevé ; cached conserve la date du relevé initial. Toute chaîne distante dans data est balisée non fiable par untrusted=true à la racine, y compris les noms de statuts des liens minimaux.

```json
{
  "status": "enum:complete|partial|unavailable",
  "available": "boolean",
  "complete": "boolean",
  "observedAt": "timestamp",
  "source": "const:ticket-api-key",
  "cached": "boolean",
  "scope": {
    "key": "string",
    "teamId": "string",
    "projectId": "nullable:string",
    "includeArchived": false,
    "linkedOutsideTeam": "const:identifier-state-only"
  },
  "untrusted": true,
  "partialReasons": [
    "EnrichedPartialReason"
  ],
  "limits": {
    "pageSize": "integer",
    "seedSize": "integer",
    "maxPages": "integer",
    "maxRequests": "integer",
    "maxNodes": "integer",
    "budgetMs": "integer",
    "documentBytes": "integer"
  },
  "usage": {
    "requests": "integer",
    "nodes": "integer",
    "maxComplexity": "nullable:number"
  },
  "data": {
    "document": "nullable:EnrichedDocumentData"
  },
  "cursor": "nullable:string",
  "freshness": {
    "observedAt": "nullable:timestamp",
    "cached": "boolean"
  }
}
```

### CodeSnapshot

Observation bornée des octets Git : SHA, index comparé à l’arbre HEAD, fichiers suivis/non suivis non ignorés et sous-modules. Aucun git status/diff : métadonnées ls-tree/ls-files et hachage direct sans filtre de contenu. Le parcours de types est local ; dossiers ignorés énumérés en une lecture puis confirmés par check-ignore --stdin -z groupé, fichiers spéciaux vérifiés en un autre lot. Chaque chemin est préfixé ./ avant stdin et comparé sous cette même forme à la réponse, puis reconverti : aucun nom de donnée ne peut activer une magie de pathspec en tête. Les séparateurs NUL préservent espaces, guillemets, antislashs, Unicode et sauts de ligne. Au plus huit commandes Git par échantillon hors sous-modules, sans processus par dossier. Les FIFO/sockets non ignorés rendent inconnu ; O_NOFOLLOW|O_NONBLOCK puis fstat empêchent de suivre un lien ou de bloquer si un fichier devient FIFO avant open. Double observation identique ; erreur/instabilité/budget dépassé : champs nuls. stateHash inclut identité et type des fichiers, pas de contenu/diff enregistré. Git >=2.45. Limites : 8 s partagées avec les sous-modules, profondeur 8, 10 000 entrées Git ou 10 000 entrées de parcours par dépôt après élagage des dossiers ignorés, 512 Mio de contenu par échantillon, 16 Mio de sortie Git par commande. Au-delà d’une limite, preuve inconnue ; environ 5 000 dossiers contenant chacun un fichier atteignent déjà 10 000 entrées de parcours (autres entrées éventuelles en plus). Le budget dépend aussi de la machine, aucun seuil temporel universel en nombre de dossiers. Test de volume : 3 000 dossiers et 3 000 fichiers, deux échantillons complets et au plus 32 processus Git (12 mesurés) ; budget de sonde 30 s pour tolérer la charge de la suite, sans modifier le défaut de production à 8 s. Les budgets expirés sont testés séparément ; les mesures sous le budget ordinaire restent consignées dans le compte rendu. Un dossier vide non suivi ne change pas l’empreinte, conformément à Git, mais consomme une entrée du parcours. Les octets ne sont pas normalisés : dirty peut différer de git status avec filtres. Domaine proof-code-v2 ; anciennes preuves conservées et périmées sans conversion.

```json
{
  "sha": "nullable:sha",
  "dirty": "nullable:boolean",
  "diffHash": "nullable:revision",
  "stateHash": "nullable:revision",
  "observedAt": "timestamp",
  "reason?": "code"
}
```

### TestProof

C5 avec résultat immuable originalStatus et status recalculé. runId est null pour les sessions V1 sans identifiant d’exécution V2 ; sessionId identifie la session historique, proofId le lancement QA distinct. repo est la clé explicite si connue, sinon le chemin historique ; aucun identifiant inventé. profilesVersion = sha256:<empreinte canonique des profils configurés>, null pour les anciens journaux. Une intention sans fin et toute sortie tronquée/interrompue restent inconnues. Un changement pendant le test ne produit pas de succès, même si HEAD est revenu ensuite.

```json
{
  "proofId": "uuid",
  "runId": "nullable:string",
  "sessionId": "uuid",
  "issueId": "nullable:string",
  "project": "nullable:string",
  "repo": "nullable:string",
  "sha": "nullable:sha",
  "dirty": "nullable:boolean",
  "diffHash": "nullable:revision",
  "profile": "string",
  "profilesVersion": "nullable:string",
  "argv": [
    "string"
  ],
  "environment": "const:local",
  "startedAt": "timestamp",
  "finishedAt": "nullable:timestamp",
  "exitCode": "nullable:integer",
  "status": "enum:réussi|échoué|inconnu|périmé",
  "originalStatus": "enum:réussi|échoué|inconnu",
  "before?": "CodeSnapshot",
  "after?": "nullable:CodeSnapshot",
  "signal?": "nullable:string",
  "outputTruncated?": "boolean",
  "legacy?": "boolean"
}
```

### TestProofs

Toutes les preuves de la session ou du ticket ; aucun filtre de succès, aucune purge. observedAt date cette lecture, pas une mesure future.

```json
{
  "proofs": [
    "TestProof"
  ],
  "observedAt": "timestamp"
}
```

### CommitReport

Rattachement Git du rapport local, sans paquet de revue C6. Pour une revue, headSha est le commit source copié, baseSha la base de sa session de développement et currentSha le HEAD source relu. Le status porte seulement la comparaison des commits, pas un verdict de revue ou une garantie sur les modifications non commitées. Une nouvelle lecture via propose recalcule la comparaison.

```json
{
  "baseSha": "nullable:sha",
  "headSha": "nullable:sha",
  "currentSha": "nullable:sha",
  "sourceSessionId": "nullable:uuid",
  "status": "enum:current|périmé|inconnu"
}
```

### QualificationCheck

Règle A4 1–6 ; règle 0 réservée à la partialité globale. satisfied = faits lus satisfaits ; missing = manque établi ; unverified = donnée ou interprétation non vérifiée. reasons contient des codes stables et paths les champs à inspecter. observedAt est la date de cette lecture, pas une garantie que le ticket ne changera plus.

```json
{
  "rule": "integer",
  "result": "enum:satisfied|missing|unverified",
  "reasons": [
    "code"
  ],
  "paths": [
    "string"
  ],
  "observedAt": "nullable:timestamp"
}
```

### QualificationSelection

Sélection déclarative ; aucune résolution Git. Agent et niveau viennent exclusivement des labels reconnus après normalisation NFC et casse (choix provisoire). Une sélection non établie reste null ; aucun recours à preferredAgent. Aucune normalisation des labels/aliases de dépôt.

```json
{
  "projectKey": "string",
  "repoKey": "nullable:string",
  "tool": "nullable:enum:claude|codex",
  "level": "nullable:enum:léger|standard|fort"
}
```

### TicketQualification

Diagnostic A4 sans mission ni lancement. checks contient six règles ; missing contient tous les résultats missing/unverified et éventuellement la règle 0 de source partielle. verified exige une lecture complète, fraîche, datée, une configuration stable et aucune règle unverified ; peut être true alors que des manques sont établis. ok exige en plus zéro manque. configRevision est la révision utilisée avant lecture.

```json
{
  "key": "string",
  "issueId": "string",
  "observedAt": "nullable:timestamp",
  "source": {
    "status": "enum:complete|partial|unavailable",
    "complete": "boolean",
    "cached": "boolean",
    "partialReasons": [
      "EnrichedPartialReason"
    ]
  },
  "selection": "QualificationSelection",
  "template": "nullable:enum:ordinary|bug|investigation",
  "ready": {
    "ok": "boolean",
    "verified": "boolean",
    "checks": [
      "QualificationCheck"
    ],
    "missing": [
      "QualificationCheck"
    ]
  },
  "launchAllowed": false,
  "configRevision": "revision"
}
```

### MissionPlan

Plan lu par ses seuls identifiants, texte intégral et SHA-256 UTF-8. approved=false décrit son absence d’approbation au moment de l’aperçu ; la mission reste immuable après une future confirmation.

```json
{
  "projectId": "string",
  "documentId": "string",
  "title": "nullable:string",
  "url": "nullable:string",
  "updatedAt": "nullable:timestamp",
  "content": "string",
  "contentHash": "revision",
  "approved": false,
  "untrusted": true
}
```

### MissionBase

Base du lot 1, plus projection C3 : branche principale, SHA choisi, date de contrôle et relation égale vérifiée. Le fetch observe/télécharge les objets sans écrire de référence.

```json
{
  "mainBranch": "string",
  "localRef": "string",
  "remote": "const:origin",
  "remoteRef": "string",
  "localSha": "sha",
  "remoteSha": "nullable:sha",
  "chosenSha": "sha",
  "source": "enum:local|origin|review",
  "options": [
    {
      "source": "enum:local|origin|review",
      "ref?": "string",
      "remote?": "const:origin",
      "sha": "sha"
    }
  ],
  "relation": "enum:equal|ahead|behind|diverged|unknown",
  "ahead": "nullable:integer",
  "behind": "nullable:integer",
  "verified": "boolean",
  "shallow": "boolean",
  "verification": {
    "status": "enum:verified|unverified",
    "reason": {
      "$oneOf": [
        null,
        "enum:fetch-unavailable|shallow-repository|relation-unavailable"
      ]
    }
  },
  "fetch": {
    "status": "enum:succeeded|failed|missing",
    "attemptedAt": "timestamp",
    "lastSucceededAt": "nullable:timestamp",
    "reason?": "enum:timeout|fetch-failed",
    "observedAt": "nullable:timestamp",
    "observedSha": "nullable:sha",
    "trackingRefUpdated": false,
    "writes": [
      "enum:objects|temporary-locks"
    ],
    "notice": "string"
  },
  "branch": "string",
  "sha": "sha",
  "checkedAt": "timestamp",
  "upToDate": "boolean"
}
```

### Mission

Snapshot C3 schemaVersion 1. issue et context sont des données distantes non fiables ; criteria/verification en sont extraits formellement (texte du corps, sans marqueurs de fence), jamais des commandes de contrôle. Le ticket original reste intégral. Pas de commentaires. profile, QA, configuration/révision et identité du dépôt sont figés ; workspacePlan est l’observation du même ticket enrichi. La mission ne porte pas son propre hash : expectedHash est calculé sur les octets complets du fichier, incluant le saut de ligne final.

```json
{
  "schemaVersion": 1,
  "missionId": "uuid",
  "createdAt": "timestamp",
  "expiresAt": "timestamp",
  "issue": "EnrichedIssueData",
  "criteria": "string",
  "verification": "string",
  "project": "string",
  "repo": "string",
  "role": "const:dev",
  "tool": "enum:claude|codex",
  "level": "enum:léger|standard|fort",
  "profile": {
    "model": "string",
    "effort": "enum:low|medium|high",
    "profilesVersion": "string"
  },
  "machine": null,
  "base": "MissionBase",
  "worktree": "path",
  "branch": "string",
  "context": {
    "parent": "nullable:EnrichedLink",
    "plan": "nullable:MissionPlan",
    "dependencies": [
      "EnrichedLink"
    ],
    "design": {
      "url": null
    },
    "untrusted": true
  },
  "qaProfiles": {
    "$record": "TestProfile"
  },
  "ready": {
    "ok": "boolean",
    "verified": "boolean",
    "checks": [
      "QualificationCheck"
    ],
    "missing": [
      "QualificationCheck"
    ]
  },
  "configRevision": "revision",
  "source": {
    "observedAt": "timestamp",
    "sourceHash": "revision",
    "untrusted": true
  },
  "workspacePlan": "Plan",
  "promptVersion": "const:dev-1",
  "prompt": "string"
}
```

### MissionCapacity

Observation locale hors mission figée, pas un comptage Tracker inventé. dev.used compte toutes les réservations dev et les V1 non arrêtées ; limite globale effective du lot 1. Les bornes projet/revue sont des minimums connus, total=null signifie non mesuré. Aucune déduction depuis un nom d’état Tracker.

```json
{
  "dev": {
    "used": "integer",
    "limit": "integer"
  },
  "projectDev": {
    "atLeast": "integer",
    "total": null,
    "limit": "integer"
  },
  "review": {
    "atLeast": "integer",
    "total": null,
    "limit": "integer"
  }
}
```

### MissionPreview

Lecture d’aperçu seulement. Plafonds, avertissements et confirmations restent hors mission. Provisoire : j’ai vu seulement si la borne connue de revue atteint le plafond, pas du seul fait que total est inconnu. launchBlockers contient toujours MISSION_LAUNCH_NOT_IMPLEMENTED, plus les blocages locaux déjà observés ; 4.3 devra tout recalculer.

```json
{
  "status": "const:preview",
  "mission": "Mission",
  "expectedHash": "revision",
  "expiresAt": "timestamp",
  "expired": false,
  "launchAllowed": false,
  "launchBlockers": [
    "code"
  ],
  "capacity": "MissionCapacity",
  "warnings": [
    {
      "code": "code",
      "message": "string"
    }
  ],
  "confirmation": {
    "required": true,
    "baseRequired": "boolean",
    "parallelRequired": "boolean",
    "reviewQueueAcknowledgementRequired": "boolean"
  }
}
```

### MissionRead

Restitution du snapshot publié, sans réseau/Git/configuration courante. expired calculé à la lecture, sans modifier le snapshot ni son empreinte. La restitution historique n’accorde aucun lancement.

```json
{
  "status": "const:read",
  "mission": "Mission",
  "expectedHash": "revision",
  "expiresAt": "timestamp",
  "expired": "boolean",
  "launchAllowed": false
}
```

### MissionRefusal

Refus d’aperçu, sans publication de mission. Une qualification non prête peut préciser les six règles ; les autres refus conservent un code fixe sans données distantes brutes.

```json
{
  "status": "const:refused",
  "code": "code",
  "message": "string",
  "agentLaunched": false,
  "launchAllowed": false,
  "qualification?": "TicketQualification",
  "preparationId?": "string"
}
```

### TicketStatus

État normalisé du connecteur et libellé réel du fournisseur.

```json
{
  "id": "nullable:string",
  "label": "nullable:string",
  "category": "enum:backlog|ready|active|done|canceled|unknown"
}
```

### TicketReference

Référence opaque dans une connexion.

```json
{
  "connection": "string",
  "id": "string"
}
```

### ConnectorEnrichedTicket

Projection enrichie exposée par le connecteur avec état normalisé et référence opaque.

```json
{
  "id": "string",
  "identifier": "nullable:string",
  "title": "nullable:string",
  "description": "nullable:string",
  "url": "nullable:string",
  "updatedAt": "nullable:string",
  "estimate": "nullable:number",
  "projectId": "nullable:string",
  "milestone": {
    "$oneOf": [
      null,
      {
        "id": "string",
        "name": "nullable:string",
        "targetDate": "nullable:string",
        "untrusted": true
      }
    ]
  },
  "parent": "nullable:EnrichedLink",
  "untrusted": true,
  "state": "EnrichedState",
  "classification": {
    "source": "enum:state-type|team-status-id|team-status-name|unresolved",
    "reason": "nullable:string"
  },
  "labels": "EnrichedLabelCollection",
  "children": "EnrichedLinkCollection",
  "dependencies": {
    "blocks": "EnrichedLinkCollection",
    "blockedBy": "EnrichedLinkCollection"
  },
  "complete": "boolean",
  "status": "TicketStatus",
  "reference": "TicketReference"
}
```

### TicketCollection

Collection avec preuve de complétude indépendante et curseur explicite.

```json
{
  "items": {
    "$oneOf": [
      null,
      [
        "any"
      ]
    ]
  },
  "complete": "boolean",
  "cursor": "nullable:string"
}
```

### TicketCapabilities

Lectures implémentées et possibilité d’écriture du transport de base ; disponibilité vérifiée à la lecture.

```json
{
  "projects": "boolean",
  "documents": "boolean",
  "milestones": "boolean",
  "comments": "boolean",
  "children": "boolean",
  "enriched": "boolean",
  "mutate": "boolean"
}
```

## Actions

### `read-config`

Lire la configuration normalisée et sa révision sans sauvegarder.

Source : [src/state.mjs](../src/state.mjs), [src/durable-storage.mjs](../src/durable-storage.mjs), [src/config.mjs](../src/config.mjs).

Entrée : {} ; champs additionnels ignorés.

Sortie : ReadConfig

Écritures : Aucune ; fichier absent => ConfigV1 vide, revision=null.

Confirmation : Aucune.

Rejeu : Nouvelle observation ; aucune conversion ni création de fichier.

Codes spécifiques : aucun ; voir aussi les codes communs.

### `config-save`

Enregistrer le document complet avec résolution des dépôts.

Source : [src/projects.mjs](../src/projects.mjs), [src/repository-config.mjs](../src/repository-config.mjs), [src/durable-storage.mjs](../src/durable-storage.mjs).

Entrée : {config:Config, baseRevision?:revision|null}. V2 exige baseRevision même null ; champs additionnels ignorés.

Sortie : SaveV1 ou SaveV2, selon la version.

Écritures : config.json, backups/config-save-<ancienne revision>.json si source présente ; operation.guard ; temporaires privés fsync. Jamais de journal de migration créé ici.

Confirmation : Pas de confirmed ; baseRevision V2 doit être celle du document édité. L’interface doit faire confirmer son enregistrement à l’utilisateur.

Rejeu : V2 : même ancienne révision après succès => CONFIG_CONFLICT ; relire, comparer et résoudre. V1 garde le comportement historique sans CAS client.

Codes spécifiques : `BASE_REVISION_REQUIRED`, `CONFIG_CONFLICT`, `MIGRATION_PENDING`, `MIGRATION_REQUIRED`, `STALE_CONFIG_VERSION`, `MIGRATION_CONFLICT` ; voir aussi les codes communs.

### `config-migrate`

Convertir explicitement V1 vers V2, avec sauvegarde octet pour octet et journal reprenable.

Source : [src/config-migration.mjs](../src/config-migration.mjs), [src/durable-storage.mjs](../src/durable-storage.mjs), [src/repository-config.mjs](../src/repository-config.mjs).

Entrée : {confirmed:true, worktreesRoot?:path, profiles?:Profiles}. worktreesRoot obligatoire pour une nouvelle conversion V1 ; autres clés refusées. teamId conservé s’il existe, kind produit pour alpha/gamma/delta sinon annexe ; color=#808080, dépôt legacy à vérifier, WIP 2/3/global2, launch each, profils unconfigured vides par défaut.

Sortie : Migration ; relire read-config pour la révision des octets effectivement écrits.

Écritures : config.json, migrations/config-v1-v2.json et backups/config-v1-<sourceHash>.json ; aucun dépôt/worktree créé.

Confirmation : confirmed === true (même pour rejouer).

Rejeu : prepared : reprise seulement si source/target/options/sauvegarde concordent. applied : already-migrated. V2 sans journal : already-v2. Ne jamais effacer un journal pour débloquer automatiquement.

Codes spécifiques : `CONFIRMATION_REQUIRED`, `MIGRATION_CONFLICT`, `MIGRATION_UNSUPPORTED_FIELDS` ; voir aussi les codes communs.

### `repo-preview`

Choisir un dépôt depuis le ticket fourni, puis vérifier sa racine physique.

Source : [src/repository-preview.mjs](../src/repository-preview.mjs), [src/config.mjs](../src/config.mjs).

Entrée : {issue:IssueSnapshot}, uniquement. Équipe explicite, association par équipe et éventuel projet ; plusieurs associations refusées. Un seul dépôt ne demande pas de label ; plusieurs dépôts exigent une seule clé sélectionnée par labels/aliases.

Sortie : Preview ou PreviewRefusal. La fonction pure previewRepository(config,issue) expose aussi status=selected sans gitCommonDir ; elle n’est pas une action CLI.

Écritures : Aucune écriture métier ; lectures Git locales, aucune requête Tracker.

Confirmation : Aucune ; launchAllowed=false, source=appelant.

Rejeu : Recalcul depuis le snapshot reçu ; aucune fraîcheur Tracker ni autorisation de lancement. Ambiguïté décidée par clés avant Git, même si même dépôt physique.

Codes spécifiques : `CONFIG_V2_REQUIRED`, `TEAM_REQUIRED`, `TEAM_NOT_CONFIGURED`, `TEAM_NOT_AUTHORIZED`, `PROJECT_REQUIRED`, `PROJECT_NOT_AUTHORIZED`, `AMBIGUOUS_PROJECT`, `REPO_LABEL_REQUIRED`, `REPO_AMBIGUOUS`, `REPO_UNAVAILABLE`, `REPO_NOT_WORKTREE`, `REPO_NOT_ROOT`, `REPO_UNSAFE_PATH` ; voir aussi les codes communs.

### `worktree-plan`

Recharger Tracker avec refresh:true et calculer un manifeste exact de préparation.

Source : [src/workspace-plans.mjs](../src/workspace-plans.mjs), [src/workspace-git.mjs](../src/workspace-git.mjs), [src/fetch-supervisor.mjs](../src/fetch-supervisor.mjs), [src/fetch-registry.mjs](../src/fetch-registry.mjs), [src/workspace-paths.mjs](../src/workspace-paths.mjs).

Entrée : PlanInput, aucune autre clé. Pas de ticket fourni, planId, chemin ou branche arbitraires acceptés.

Sortie : Plan, Refusal ou PreviewRefusal. Voir Base pour les deux axes téléchargement/vérification.

Écritures : workspace-state.json : nouveau plan à chaque succès, intention fetch avant lancement puis identité avant go ; objets Git et verrous transitoires. Jamais refs, reflogs, FETCH_HEAD, configuration, .keep persistant ; promisor.acceptFromServer=none. Aucun dossier de travail créé.

Confirmation : Pas de confirmation pour lire le distant/télécharger ses objets ; l’aperçu décrit ces écritures. needsConfirmation indique la future confirmation de préparation.

Rejeu : Chaque appel réussi crée un nouveau planId et observe à nouveau ; pas une réservation de capacité. Deux fetchs même dépôt attendent au plus 5 s puis FETCH_BUSY. Terminaison incertaine => pas de second fetch.

Codes spécifiques : `TICKET_ALREADY_RESERVED`, `BASE_UNAVAILABLE`, `GIT_UNSUPPORTED`, `FETCH_BUNDLE_UNSUPPORTED`, `FETCH_PREFLIGHT_FAILED`, `FETCH_TERMINATION_UNCONFIRMED`, `FETCH_RECOVERY_REQUIRED`, `FETCH_BUSY`, `FETCH_INTENT_CHANGED`, `REMOTE_BASE_UNAVAILABLE`, `REVIEW_COMMIT_UNAVAILABLE`, `BRANCH_COLLISION`, `WORKTREE_COLLISION`, `WORKTREES_ROOT_UNSAFE`, `WORKTREE_PATH_TOO_LONG` ; voir aussi les codes communs.

### `worktree-prepare`

Réserver puis créer le worktree isolé, sans agent ; revue détachée, dev détaché/verrouillé puis switch -c.

Source : [src/workspace-preparation.mjs](../src/workspace-preparation.mjs), [src/workspace-reservations.mjs](../src/workspace-reservations.mjs), [src/workspace-execution.mjs](../src/workspace-execution.mjs), [src/workspace-worker.mjs](../src/workspace-worker.mjs).

Entrée : {planId:string, confirmation?:{manifestHash:revision, parallel?:{reason:string,occupantIds:string[]}}}. raison parallèle non vide ≤500, sans contrôle ; IDs exacts des occupants courants.

Sortie : PreparationResult, Refusal ou PreviewRefusal. Un échec de worker peut être ok:true/status failed-certain ou uncertain avec preparation.errorCode.

Écritures : workspace-state.json (intention/identités/go/étapes), dossier revendiqué, git worktree add --detach --lock --reason fabrique-console:<preparationId>:<instanceId>, branche dev ; aucun push, agent ou mutation Tracker. Vérifie commit/arbre cible localement sans lazy-fetch, sans parents historiques.

Confirmation : confirmation exacte si needsConfirmation ; concurrence même Git exige aussi parallel/occupants/reason exacts. Champ présent avec mauvais manifeste => refus même si confirmation non exigée.

Rejeu : Même planId : réconciliation et reused=true ; attach seulement après preuve. Réponse perdue => même planId/reconcile, jamais nouveau plan à l’aveugle. Libération sans artefact automatique seulement réservée/create/go jamais envoyé/groupe absent/rien créé.

Codes spécifiques : `PLAN_NOT_FOUND`, `PLAN_CHANGED`, `CONFIRMATION_MISMATCH`, `BASE_CONFIRMATION_REQUIRED`, `MAPPING_CHANGED`, `GLOBAL_CAPACITY`, `REVIEW_CAPACITY`, `TICKET_ALREADY_RESERVED`, `LEGACY_RESERVATION_UNKNOWN`, `LANE_BUSY`, `PARALLEL_CONFIRMATION_MISMATCH`, `WORKSPACE_RESERVED`, `WORKER_START_UNCERTAIN`, `WORKER_OWNERSHIP`, `BRANCH_COLLISION`, `REMOTE_BASE_UNAVAILABLE`, `WORKTREE_UNCERTAIN`, `BASE_TREE_NOT_MATERIALIZED` ; voir aussi les codes communs.

### `worktree-reconcile`

Observer les preuves et mettre à jour la réservation sans relancer Git en écriture.

Source : [src/workspace-preparation.mjs](../src/workspace-preparation.mjs), [src/workspace-inspection.mjs](../src/workspace-inspection.mjs).

Entrée : {preparationId:string}, uniquement.

Sortie : PreparationResult ou Refusal ; un groupe incertain reste creating/uncertain. Une préparation libérée renvoie released sans inspection ni extras.

Écritures : workspace-state.json : statut, retraite d’identité réutilisée, preparedAt éventuel, ou libération automatique avant go strictement prouvée ; aucun dossier/branche supprimé.

Confirmation : Aucune.

Rejeu : Réinspection sûre ; résultat peut évoluer si le worker ou le disque évolue. Ne pas interpréter un temps écoulé comme une preuve de fin.

Codes spécifiques : `PREPARATION_NOT_FOUND`, `RECONCILE_CHANGED`, `BASE_TREE_NOT_MATERIALIZED` ; voir aussi les codes communs.

### `worktree-release`

Libérer une capacité, sans supprimer le dossier ni la branche.

Source : [src/workspace-preparation.mjs](../src/workspace-preparation.mjs), [src/forced-audit.mjs](../src/forced-audit.mjs).

Entrée : {preparationId:string,confirmed:true,expectedHash:revision,force?:boolean,reason?:string}. reason ≤500 sans contrôle ; champs inconnus refusés.

Sortie : PreparationResult (released, forced=true seulement si forcée) ou Refusal.

Écritures : workspace-state.json : released/failed-released ; force ajoute forcedRelease avec acteur OS, date, empreinte et état précédent. Aucune opération destructive ni signal.

Confirmation : confirmed === true + preparationHash courant. force=true exige une action humaine distincte ; interdite si état normalement prouvé ou worker identifié vivant.

Rejeu : Ancienne empreinte => CONFIRMATION_MISMATCH ; après succès appeler reconcile, pas répéter release. Même empreinte nouvelle d’un état déjà released ne rend pas release idempotent (PREPARATION_UNCERTAIN ; force => FORCE_NOT_REQUIRED).

Codes spécifiques : `CONFIRMATION_REQUIRED`, `CONFIRMATION_MISMATCH`, `FORCE_NOT_REQUIRED`, `WORKER_ACTIVE`, `PREPARATION_NOT_FOUND`, `PREPARATION_UNCERTAIN`, `RECONCILE_CHANGED` ; voir aussi les codes communs.

### `worktree-cleanup`

Exécuter uniquement la proposition rmdir du dossier vide appartenant à l’outil.

Source : [src/workspace-preparation.mjs](../src/workspace-preparation.mjs), [src/workspace-cleanup.mjs](../src/workspace-cleanup.mjs).

Entrée : {preparationId:string,confirmed:true,expectedHash:revision}. expectedHash = cleanupProposal.hash (pas preparationHash).

Sortie : PreparationResult ou Refusal ; une exécution échouée peut conserver preparation.errorCode.

Écritures : rmdir atomique du seul dossier vide après nouvelles preuves, étapes du registre. Jamais git worktree unlock/remove, suppression récursive, branche ou fichier supprimés. Ancien cleanup kind=git-worktree refusé avant tout Git.

Confirmation : Afficher commands exactes et requiresConfirmation ; confirmed true + hash actuel après action explicite.

Rejeu : Réconcilier ; si proposal absent, refus manuel. Après succès proposition consommée, réservation reste à libérer explicitement ; aucun second retrait aveugle.

Codes spécifiques : `CONFIRMATION_REQUIRED`, `CLEANUP_MANUAL_REQUIRED`, `CLEANUP_CHANGED`, `CLEANUP_UNAVAILABLE`, `CLEANUP_UNCERTAIN`, `PREPARATION_NOT_FOUND`, `WORKER_START_UNCERTAIN` ; voir aussi les codes communs.

### `fetch-inspect`

Lire les intentions de fetch encore enregistrées et leur preuve de fin.

Source : [src/fetch-registry.mjs](../src/fetch-registry.mjs).

Entrée : {fetchId?:string}, aucune autre clé ; filtre inconnu => liste vide.

Sortie : FetchInspection ou Refusal.

Écritures : Aucune ; lectures registre/processus/boot.

Confirmation : Aucune.

Rejeu : Toujours lecture seule ; terminationProven ne retire rien ici.

Codes spécifiques : aucun ; voir aussi les codes communs.

### `fetch-abandon`

Abandonner comptablement une intention dont la fin reste incertaine.

Source : [src/fetch-registry.mjs](../src/fetch-registry.mjs), [src/forced-audit.mjs](../src/forced-audit.mjs).

Entrée : {fetchId:string,confirmed:true,expectedHash:revision,reason?:string}, raison ≤500 sans contrôle.

Sortie : FetchAbandoned ou Refusal.

Écritures : Retire l’intention de workspace-state.json et ajoute fetchAbandonments (acteur/date/empreinte/état précédent) atomiquement. Ne tue rien et ne supprime aucun objet/fichier ; une opération inconnue peut continuer.

Confirmation : Action explicite distincte, confirmed true et confirmationHash exact ; worker identifié vivant => WORKER_ACTIVE, fin prouvée => FORCE_NOT_REQUIRED.

Rejeu : Empreinte périmée refusée, ID absent FETCH_INTENT_NOT_FOUND ; génération abandonnée ne peut retirer la suivante. Ne pas automatiser cette sortie.

Codes spécifiques : `CONFIRMATION_REQUIRED`, `CONFIRMATION_MISMATCH`, `FETCH_INTENT_NOT_FOUND`, `FORCE_NOT_REQUIRED`, `WORKER_ACTIVE` ; voir aussi les codes communs.

### `snapshot`

Lire les vues historiques/projections sans lancer de travail.

Source : [src/sessions.mjs](../src/sessions.mjs), [src/config.mjs](../src/config.mjs).

Entrée : {} ; champs additionnels ignorés.

Sortie : Snapshot ; sessions V1 et données inconnues distinctes des préparations V2.

Écritures : Aucune écriture de session/config ; le transport Tracker peut charger son cache/authentification dédiés.

Confirmation : Aucune.

Rejeu : Observation actualisée ; warnings ne prouvent pas qu’une session s’est arrêtée.

Codes spécifiques : `HC_UNAVAILABLE`, `HC_PROTOCOL` ; voir aussi les codes communs.

### `launch`

Lancement historique V1 ; volontairement bloqué en V2.

Source : [src/launch.mjs](../src/launch.mjs), [src/worktrees.mjs](../src/worktrees.mjs), [src/mission.mjs](../src/mission.mjs).

Entrée : {issueId:string,tool:claude|codex,resume?:boolean,review?:boolean}.

Sortie : V2 : exception CONFIG_V2_LAUNCH_UNAVAILABLE avant Tracker.detail/terminal. V1 : NOT_APPROVED tant qu’aucune mission en cours de l’issue (son issue, ou un ticket de son plan) n’a la copie figée de l’approbation (ticket M5), avant toute écriture et tout terminal, reprise (resume) et revue comprises ; une fois le plan de cette mission approuvé (copie figée et plan), le lancement passe par le couloir de la mission (dev-launch, src/dev-chain.mjs) : le ticket du plan que l’issue est, sinon (l’issue de la mission elle-même) les tickets que son plan développe, avec l’agent, le modèle et l’effort du plan, reprise comprise ({mission,via:"lane",worktree,launched}) ; jamais deux devs vivants pour une mission ; une revue y est refusée (REVIEW_IN_LANE : les relecteurs sont ceux de la chaîne). Sinon {session:SessionV1,reused:boolean,warning?:string}.

Écritures : V1 seulement : state.json/intention, worktree, branche, hc run et agent. Pas utilisé par la préparation V2.

Confirmation : Confirmation orchestrée par l’appelant ; aucun nouveau lancement V2 disponible.

Rejeu : V1 terminal possédé vivant => reused ; historique => resume explicite ; incertitude => réconcilier avant relance.

Codes spécifiques : `REVIEW_IN_LANE`, `CONFIG_V2_LAUNCH_UNAVAILABLE`, `NOT_APPROVED`, `ENVIRONMENT_NOT_READY`, `LAUNCH_UNCERTAIN`, `TERMINAL_OWNERSHIP`, `RESUME_REQUIRED`, `MAPPING_CHANGED`, `UNMAPPED_PROJECT`, `AMBIGUOUS_PROJECT`, `REVIEW_SOURCE_REQUIRED`, `REVIEW_SNAPSHOT`, `WORKTREE_COLLISION`, `WORKTREE_MISSING`, `WORKTREE_CHANGED`, `UNSAFE_WORKTREE` ; voir aussi les codes communs.

### `ticket-list`

Lecture Tracker via transport choisi.

Source : [src/ticket-read.mjs](../src/ticket-read.mjs), [integrations/tickets/factory.mjs](../integrations/tickets/factory.mjs).

Entrée : {projectId?:string,teamId?:string,refresh?:boolean} ; contrat du transport.

Sortie : {issues:Issue[],updatedAt:timestamp,cached?:boolean,complete?:boolean,...pagination éventuelle} ; champs Tracker non fiables.

Écritures : Cache et authentification dédiés selon transport ; pas de mutation Tracker.

Confirmation : Aucune.

Rejeu : Cache permis sauf refresh true.

Codes spécifiques : `TICKET_API`, `TICKET_AUTH`, `TICKET_NOT_CONFIGURED`, `TICKET_UNAVAILABLE`, `TICKET_RATE_LIMIT`, `TICKET_PAGINATION`, `TICKET_MCP_API`, `TICKET_MCP_UNAVAILABLE` ; voir aussi les codes communs.

### `ticket-detail`

Lecture d’un ticket complet.

Source : [src/ticket-read.mjs](../src/ticket-read.mjs), [integrations/tickets/factory.mjs](../integrations/tickets/factory.mjs).

Entrée : {id:string,refresh?:boolean} ; id ≤200.

Sortie : {issue:Issue (avec children:Child[], childrenComplete:boolean, childrenReason:null|'unavailable'|'truncated'|'unidentified'|'incomplete-fields'|'unverified'),...métadonnées du transport}. Child : {id,identifier,title,state,labels,labelsComplete,blockedBy (ids),blockedByComplete,url,model:null|string,effort:null|string,modelIssue:null|string (texte français affichable : modèle refusé)}. childrenComplete false couvre aussi les champs incomplets d’un enfant.

Écritures : Cache/authentification selon transport, aucune mutation.

Confirmation : Aucune.

Rejeu : refresh true recharge le ticket.

Codes spécifiques : `NOT_FOUND`, `TICKET_API`, `TICKET_AUTH`, `TICKET_NOT_CONFIGURED`, `TICKET_MCP_API` ; voir aussi les codes communs.

### `ticket-meta`

Lecture des métadonnées de workflow.

Source : [src/ticket-read.mjs](../src/ticket-read.mjs), [integrations/tickets/factory.mjs](../integrations/tickets/factory.mjs).

Entrée : {refresh?:boolean}.

Sortie : {states:object[],...métadonnées du transport}.

Écritures : Cache/authentification dédiés, pas de mutation.

Confirmation : Aucune.

Rejeu : Lecture réexécutable.

Codes spécifiques : `TICKET_API`, `TICKET_AUTH`, `TICKET_NOT_CONFIGURED`, `TICKET_MCP_API` ; voir aussi les codes communs.

### `project-summary`

Compter les tickets ouverts d’un projet configuré.

Source : [src/projects.mjs](../src/projects.mjs).

Entrée : {key:string,refresh?:boolean} ; key ≤48, refresh booléen strict.

Sortie : {key,open:integer|null,total:integer,unknown:integer,updatedAt:timestamp,cached?:boolean,source:tracker,complete:true}. Types inconnus => open=null.

Écritures : Cache/authentification de lecture seulement.

Confirmation : Aucune.

Rejeu : Observation réexécutable ; délai 25 s, refus d’une liste incomplète.

Codes spécifiques : `NOT_FOUND`, `TICKET_TIMEOUT`, `TICKET_INCOMPLETE`, `TICKET_API` ; voir aussi les codes communs.

### `git`

Inspecter une session V1 existante.

Source : [src/worktrees.mjs](../src/worktrees.mjs).

Entrée : {sessionId:string} ≤200.

Sortie : {branch:string,status:string,diff:string,stat:string,commits:string}.

Écritures : Aucune écriture Git métier.

Confirmation : Aucune.

Rejeu : Relit le worktree ; changement de branche/chemin est refusé.

Codes spécifiques : `NOT_FOUND`, `WORKTREE_MISSING`, `WORKTREE_CHANGED`, `UNSAFE_WORKTREE`, `GIT_ERROR` ; voir aussi les codes communs.

### `qa`

Lancer un profil configuré pour une session et produire une preuve C5 immuable.

Source : [src/proofs.mjs](../src/proofs.mjs), [src/qa-worker.mjs](../src/qa-worker.mjs), [src/proof-code.mjs](../src/proof-code.mjs), [src/proof-store.mjs](../src/proof-store.mjs).

Entrée : {sessionId:string,profile:string}, paramètres historiques.

Sortie : {run:QaRun}, enveloppe historique conservée. Le résultat observé est recalculé avant retour ; lire test-proofs pour toutes les preuves et leur statut C5.

Écritures : qa/<id>.json, éventuel terminal sidecar, state.json.qaId ; proofs/<id>.intent.json avant lancement et proofs/<id>.json à la fin, publiés atomiquement et jamais réécrits. Worker/terminal du profil ; pas d’agent V2.

Confirmation : Action explicite ; argv configurés directs, aucun shell implicite.

Rejeu : Réservation sérialisée avant spawn, puis verrou relâché pendant le test. Attente bornée 5 s si verrou occupé ; un second lancement voit QA_RUNNING ou QA_UNCERTAIN et ne remplace aucune preuve. Une fin non constatée reste inconnue.

Codes spécifiques : `QA_NOT_CONFIGURED`, `QA_RUNNING`, `QA_UNCERTAIN`, `MAPPING_CHANGED`, `WORKTREE_MISSING`, `WORKTREE_CHANGED`, `QA_LAUNCH_UNCERTAIN`, `QA_WORKER_GONE`, `QA_TERMINAL_GONE`, `HC_UNAVAILABLE`, `PROOF_UNSERIALIZABLE`, `MIGRATION_CONFLICT` ; voir aussi les codes communs.
Raisons d’observation (pas des exceptions) : `QA_PROOF_STALE`, `QA_PROOF_UNKNOWN`, `QA_CODE_UNREADABLE`.

### `stop`

Arrêter explicitement une session historique par labels d’appartenance.

Source : [src/sessions.mjs](../src/sessions.mjs).

Entrée : {sessionId:string,confirmed:true}.

Sortie : {session:SessionV1} avec status=historical, stoppedAt/updatedAt.

Écritures : hc kill du terminal possédé, state.json ; aucun nettoyage du worktree.

Confirmation : confirmed === true.

Rejeu : Si déjà absent, enregistre l’arrêt ; jamais tuer un ID attribué à un autre propriétaire. stoppedAt doit être postérieur au dernier launchAttemptAt pour sortir du plafond V2.

Codes spécifiques : `CONFIRMATION_REQUIRED`, `TERMINAL_OWNERSHIP`, `STOP_FAILED`, `NOT_FOUND` ; voir aussi les codes communs.

### `propose`

Préparer un rapport et un commentaire/PR locaux, sans publication.

Source : [src/reports.mjs](../src/reports.mjs), [src/proof-code.mjs](../src/proof-code.mjs).

Entrée : {sessionId:string}.

Sortie : {path:path,content:string,proposal:{issueId,comment},pr:{title,base,head,body}}.. Champ report:CommitReport avec baseSha/headSha/currentSha et validité de commit recalculée ; les mêmes commits figurent dans content.

Écritures : reports/<sessionId>.md (remplacé au rejeu) ; aucune création de PR distante ni mutation Tracker.

Confirmation : Aucune pour le brouillon ; publication ultérieure hors de cette action.

Rejeu : Régénère depuis les preuves actuelles.

Codes spécifiques : `NOT_FOUND`, `WORKTREE_MISSING`, `WORKTREE_CHANGED`, `UNSAFE_WORKTREE`, `GIT_ERROR` ; voir aussi les codes communs.

### `ticket-mutate`

Circuit historique d’écriture confirmé, distinct des actions V2 de préparation.

Source : [integrations/tickets/factory.mjs](../integrations/tickets/factory.mjs).

Entrée : {payload:{issueId:string,stateId?:string,comment?:string},confirmed:true,confirmedPayload:payload}. Au moins stateId/comment ; commentaire ≤20000 ; clés payload inconnues refusées.

Sortie : Résultat du transport avec success:true ; un échec/incertain n’est pas une clôture de ticket.

Écritures : Mutation distante confirmée et mutations/<payloadHash>.json local ; aucun appel de cette action n’est fait par le lot 1.5.

Confirmation : confirmed true et égalité canonique exacte du payload confirmé ; stateId vérifié dans l’équipe fraîche du ticket.

Rejeu : applied renvoie le résultat ; rejected peut être rejoué ; pending/uncertain bloque pour réconciliation distante avant nouveau payload.

Codes spécifiques : `CONFIRMATION_REQUIRED`, `INVALID_STATE`, `TICKET_MUTATION_FAILED`, `TICKET_MUTATION_PARTIAL`, `TICKET_MUTATION_UNCERTAIN`, `TICKET_READ_ONLY`, `TICKET_MCP_UNSUPPORTED` ; voir aussi les codes communs.

### `ticket-projects`

Lecture enrichie projects par clé API, équipe déterminée par le projet local configuré. Sans clé : indisponible, sans changer MCP.

Source : [src/ticket-read.mjs](../src/ticket-read.mjs), [integrations/tickets/factory.mjs](../integrations/tickets/factory.mjs).

Entrée : {key:string,refresh?:boolean} ; aucun champ supplémentaire. key est la clé du projet local, jamais un secret.

Sortie : EnrichedProjects ; status/complete/partialReasons et complétude par collection obligatoires. total=null si inconnu.

Écritures : Cache privé dédié uniquement ; aucune mutation Tracker, aucun lancement de terminal.

Confirmation : Lecture autorisée ; aucune confirmation de mutation.

Rejeu : Cache complet de 60 s par identité de clé et paramètres ; refresh=true force la lecture. Les réponses partielles ne sont pas mises en cache.

Codes spécifiques : `INVALID_ARGUMENT`, `NOT_FOUND`, `TEAM_NOT_CONFIGURED`, `TICKET_SCOPE`, `TICKET_AUTH`, `TICKET_SECRET_RESPONSE` ; voir aussi les codes communs.

### `ticket-issues-enriched`

Lecture enrichie issues par clé API, équipe déterminée par le projet local configuré. Sans clé : indisponible, sans changer MCP.

Source : [src/ticket-read.mjs](../src/ticket-read.mjs), [integrations/tickets/factory.mjs](../integrations/tickets/factory.mjs).

Entrée : {key:string,projectId?:string,refresh?:boolean} ; aucun champ supplémentaire. key est la clé du projet local, jamais un secret.

Sortie : EnrichedIssues ; status/complete/partialReasons et complétude par collection obligatoires. total=null si inconnu.

Écritures : Cache privé dédié uniquement ; aucune mutation Tracker, aucun lancement de terminal.

Confirmation : Lecture autorisée ; aucune confirmation de mutation.

Rejeu : Cache complet de 60 s par identité de clé et paramètres ; refresh=true force la lecture. Les réponses partielles ne sont pas mises en cache.

Codes spécifiques : `INVALID_ARGUMENT`, `NOT_FOUND`, `TEAM_NOT_CONFIGURED`, `TICKET_SCOPE`, `TICKET_AUTH`, `TICKET_SECRET_RESPONSE` ; voir aussi les codes communs.

### `ticket-issue-enriched`

Lecture enrichie issue par clé API, équipe déterminée par le projet local configuré. Sans clé : indisponible, sans changer MCP.

Source : [src/ticket-read.mjs](../src/ticket-read.mjs), [integrations/tickets/factory.mjs](../integrations/tickets/factory.mjs).

Entrée : {key:string,issueId:string,refresh?:boolean} ; aucun champ supplémentaire. key est la clé du projet local, jamais un secret.

Sortie : EnrichedIssue ; status/complete/partialReasons et complétude par collection obligatoires. total=null si inconnu.

Écritures : Cache privé dédié uniquement ; aucune mutation Tracker, aucun lancement de terminal.

Confirmation : Lecture autorisée ; aucune confirmation de mutation.

Rejeu : Cache complet de 60 s par identité de clé et paramètres ; refresh=true force la lecture. Les réponses partielles ne sont pas mises en cache.

Codes spécifiques : `INVALID_ARGUMENT`, `NOT_FOUND`, `TEAM_NOT_CONFIGURED`, `TICKET_SCOPE`, `TICKET_AUTH`, `TICKET_SECRET_RESPONSE` ; voir aussi les codes communs.

### `ticket-document`

Lecture enrichie document par clé API, équipe déterminée par le projet local configuré. Sans clé : indisponible, sans changer MCP.

Source : [src/ticket-read.mjs](../src/ticket-read.mjs), [integrations/tickets/factory.mjs](../integrations/tickets/factory.mjs).

Entrée : {key:string,projectId:string,documentId:string,refresh?:boolean} ; aucun champ supplémentaire. key est la clé du projet local, jamais un secret.

Sortie : EnrichedDocument ; status/complete/partialReasons et complétude par collection obligatoires. total=null si inconnu.

Écritures : Cache privé dédié uniquement ; aucune mutation Tracker, aucun lancement de terminal.

Confirmation : Lecture autorisée ; aucune confirmation de mutation.

Rejeu : Cache complet de 60 s par identité de clé et paramètres ; refresh=true force la lecture. Les réponses partielles ne sont pas mises en cache.

Codes spécifiques : `INVALID_ARGUMENT`, `NOT_FOUND`, `TEAM_NOT_CONFIGURED`, `TICKET_SCOPE`, `TICKET_AUTH`, `TICKET_SECRET_RESPONSE` ; voir aussi les codes communs.

### `test-proofs`

Lire les preuves de test par session ou ticket, avec validité recalculée par rapport au worktree actuel.

Source : [src/proofs.mjs](../src/proofs.mjs), [src/proof-code.mjs](../src/proof-code.mjs), [src/proof-store.mjs](../src/proof-store.mjs).

Entrée : Exactement un sélecteur : {sessionId:string} ou {issueId:string}. Un ticket sans session rend proofs:[].

Sortie : TestProofs. status = réussi/échoué/inconnu/périmé ; originalStatus reste inchangé. HEAD ou empreinte illisible : inconnu, jamais réussi. QA_CODE_UNREADABLE est une raison dans CodeSnapshot.reason, pas une exception de l’action. Identifiant QA incohérent avec son nom de fichier : INVALID_DATA.

Écritures : Aucune. Relit les journaux QA et les enregistrements immuables, observe Git sans rafraîchissement de l’index ni téléchargement implicite.

Confirmation : Aucune pour cette lecture locale.

Rejeu : Recalcule à chaque appel ; comparer avant/après du test et le code actuel. Retourner exactement au même état peut rendre de nouveau valable une preuve correspondante. Aucun ancien journal converti en preuve valable.

Codes spécifiques : `NOT_FOUND`, `INVALID_ARGUMENT`, `INVALID_DATA` ; voir aussi les codes communs.
Raisons d’observation (pas des exceptions) : `QA_CODE_UNREADABLE`.

### `ticket-qualify`

Recalculer les six règles A4 sur un ticket rechargé, sans mission ni lancement.

Source : [src/ticket-qualification.mjs](../src/ticket-qualification.mjs), [src/ticket-qualification-read.mjs](../src/ticket-qualification-read.mjs), [src/backend.mjs](../src/backend.mjs), [src/repository-preview.mjs](../src/repository-preview.mjs), [integrations/tickets/factory.mjs](../integrations/tickets/factory.mjs), [src/ticket-markdown.mjs](../src/ticket-markdown.mjs).

Entrée : {key:string,issueId:string} uniquement. issueId est l’identifiant interne Tracker exact (issue.id), pas XJ-12 ; un identifiant métier résolu par Tracker reste QUALIFICATION_SCOPE_UNVERIFIED, six règles unverified. key non vide ≤48, issueId non vide ≤200, sans NUL. Toute autre clé (outil, modèle, effort, rôle, refresh…) est refusée.

Sortie : TicketQualification. Six checks et liste des manques motivés/datés ; résultats satisfied, missing ou unverified. Une source partielle/indisponible ne rend jamais ready.ok=true. launchAllowed=false même quand A4 est satisfait.

Écritures : Lecture du cache enrichi et mise à jour privée du cache/guard comme en 3a. Aucun Git, HC, outil agent, worktree, mission, session ni mutation Tracker. Configuration réelle jamais nécessaire aux tests.

Confirmation : Aucune, action de lecture ; ne constitue pas une approbation de mission ou de plan.

Rejeu : Lecture Tracker enrichie refresh:true obligatoire, jamais de repli sur un ticket prêt en cache ni sur MCP. Configuration relue après le ticket ; révision différente => règle 2 unverified. Une erreur pendant la lecture enrichie (réseau, portée ou cache) donne un diagnostic non vérifié sans message distant brut ; les erreurs des lectures de configuration avant/après restent des exceptions.

Codes spécifiques : `INVALID_ARGUMENT`, `CONFIG_V2_REQUIRED`, `NOT_FOUND` ; voir aussi les codes communs.
Raisons d’observation (pas des exceptions) : `QUALIFICATION_SOURCE_UNAVAILABLE`, `QUALIFICATION_SCOPE_UNVERIFIED`, `QUALIFICATION_SOURCE_NOT_FRESH`, `QUALIFICATION_LABELS_UNVERIFIED`, `QUALIFICATION_READY_REQUIRED`, `QUALIFICATION_CONFIG_CHANGED`, `QUALIFICATION_REPOSITORY_UNVERIFIED`, `QUALIFICATION_AGENT_REQUIRED`, `QUALIFICATION_AGENT_AMBIGUOUS`, `QUALIFICATION_AGENT_UNSUPPORTED`, `QUALIFICATION_LEVEL_REQUIRED`, `QUALIFICATION_LEVEL_AMBIGUOUS`, `QUALIFICATION_LEVEL_UNSUPPORTED`, `QUALIFICATION_DESCRIPTION_UNVERIFIED`, `QUALIFICATION_SECTIONS_AMBIGUOUS`, `QUALIFICATION_SECTIONS_MISSING`, `QUALIFICATION_DEPENDENCIES_UNVERIFIED`, `QUALIFICATION_DEPENDENCY_STATE_UNKNOWN`, `QUALIFICATION_DEPENDENCY_OPEN`, `QUALIFICATION_STATUS_NOT_STARTABLE`, `QUALIFICATION_STATUS_UNKNOWN`, `QUALIFICATION_SOURCE_PARTIAL`, `TEAM_REQUIRED`, `TEAM_NOT_CONFIGURED`, `TEAM_NOT_AUTHORIZED`, `PROJECT_REQUIRED`, `PROJECT_NOT_AUTHORIZED`, `AMBIGUOUS_PROJECT`, `REPO_LABEL_REQUIRED`, `REPO_AMBIGUOUS`, `QUALIFICATION_DESCRIPTION_LIMIT`.

### `mission-preview`

Publier une mission dev C3 immuable montrant le ticket, le plan lu et la consigne exacte, sans préparation ni lancement.

Source : [src/missions.mjs](../src/missions.mjs), [src/mission-source.mjs](../src/mission-source.mjs), [src/mission-prompt.mjs](../src/mission-prompt.mjs), [src/mission-store.mjs](../src/mission-store.mjs), [src/workspace-plans.mjs](../src/workspace-plans.mjs).

Entrée : {key:string,issueId:string,role:dev,baseSource?:local|origin,plan?:{projectId:string,documentId:string}}. issueId interne. Seuls ces champs, plus sourceRunId/continuationOf reconnus mais refusés comme indisponibles avant 4.3, sont admis. Autres rôles déclarés : MISSION_ROLE_UNAVAILABLE. Outil, modèle, effort, profil et contenu libres sont interdits.

Sortie : MissionPreview | MissionRefusal. expectedHash = SHA-256 sur les octets du fichier publié, pas un champ du contenu. mission-read restitue exactement mission. launchAllowed=false sans exception.

Écritures : Cache enrichi et téléchargements d’objets Git selon le lot 1 (aucune référence écrite, notice dans mission.base.fetch), missions/<UUID>.json immuable 0600 sous dossier 0700, puis transaction workspace-state.json ajoutant ensemble le plan observé et missionPreviews. Aucun worktree, branche, réservation de capacité, session ou agent créé ; aucun Tracker écrit.

Confirmation : Aucune pour l’aperçu. TTL 15 min ; la future confirmation 4.3 doit citer expectedHash complet, montrer le plan et tout revalider. Le booléen approved du snapshot reste false, l’accord futur appartient à l’exécution.

Rejeu : Chaque appel crée un nouvel identifiant sans réécrire les snapshots précédents. Ticket+plan sont relus refresh:true dans un budget réseau commun ≤23 s, sans cache périmé ni MCP. Git reprend les budgets bornés du lot 1 (fetch ≤30 s par défaut) ; un appel complet peut dépasser 30 s, prévoir le délai client en conséquence. Le fichier est publié avant le registre : un éventuel orphelin ne peut pas être lu comme un aperçu publié. Configuration relue après les sources, après Git et sous transaction avant référence.

Codes spécifiques : `INVALID_ARGUMENT`, `CONFIG_V2_REQUIRED`, `NOT_FOUND`, `TICKET_ALREADY_RESERVED`, `BASE_UNAVAILABLE`, `GIT_UNSUPPORTED`, `FETCH_BUNDLE_UNSUPPORTED`, `FETCH_PREFLIGHT_FAILED`, `FETCH_TERMINATION_UNCONFIRMED`, `FETCH_RECOVERY_REQUIRED`, `FETCH_BUSY`, `FETCH_INTENT_CHANGED`, `REMOTE_BASE_UNAVAILABLE`, `REVIEW_COMMIT_UNAVAILABLE`, `BRANCH_COLLISION`, `WORKTREE_COLLISION`, `WORKTREES_ROOT_UNSAFE`, `WORKTREE_PATH_TOO_LONG`, `TICKET_NOT_READY`, `MISSION_PLAN_REQUIRED`, `MISSION_PLAN_SCOPE`, `MISSION_PLAN_UNVERIFIED`, `MISSION_PROFILE_REQUIRED`, `MISSION_SOURCE_CHANGED`, `MISSION_ROLE_UNAVAILABLE`, `MISSION_CONTINUATION_UNAVAILABLE`, `MISSION_PROMPT_TOO_LARGE`, `MISSION_UNSERIALIZABLE` ; voir aussi les codes communs.
Raisons d’observation (pas des exceptions) : `MISSION_LAUNCH_NOT_IMPLEMENTED`, `GLOBAL_CAPACITY`, `LEGACY_RESERVATION_UNKNOWN`, `REVIEW_QUEUE_UNMEASURED`, `REVIEW_QUEUE_LIMIT`, `PROJECT_DEV_LIMIT`.

### `mission-read`

Lire une mission durable M-n (registre V4) avec ce que dit sa chaîne, ou restituer un aperçu publié en vérifiant le hash complet et son rattachement au registre. Clôture automatique : mission.closure expose l’accord et les étapes push/pr/merge (asking/done/uncertain) ainsi que pullRequest ; après Reopen, closureHistory conserve les cinq dernières livraisons, sans leur rendre valeur d’accord.

Source : [src/mission.mjs](../src/mission.mjs), [src/missions.mjs](../src/missions.mjs), [src/mission-store.mjs](../src/mission-store.mjs), [src/questions.mjs](../src/questions.mjs), [src/requests.mjs](../src/requests.mjs), [src/visits.mjs](../src/visits.mjs), [src/environment-view.mjs](../src/environment-view.mjs).

Entrée : {mission:"M-<n>"} (mission durable) ; ou {missionId:uuid} seul (aperçu) : chemin, nom libre, expectedHash ou autre champ refusés.

Sortie : Mission durable : {mission:Mission,on:boolean,journal:Array<{at,text,tone,detail}>,metrics:{<ticket>:{…}},timings?:{<ticket>:Array<{step,minutes:number|null}>},pause:{state:"none"|"requested"|"paused",at?,pausedAt?,waiting?,agent?,alert?} (ticket M11 : none sans pause, requested tant que quelque chose peut tourner, avec ce qu’elle attend (waiting, voir mission-pause) et une alerte si cela dure, paused quand plus rien ne peut tourner ; absent pour un aperçu),reports:Array<compte rendu d’agent>,qa:{at,verdict,summary,tests,plan:Array,marks}|null,questions:Array<Question non résolue>,items:Array<Demande non résolue de la mission>,approval?:{at,revision,tickets,simple?,branch,openQuestions,manual?,coverage,outside?,kind?,approves?,history?:Array<{at,revision,tickets,kind?,simple?,branch,openQuestions?,manual?,approves?}>,by,via},drift?:Array<{ticket:string|null,part?:string,kind:"added"|"removed"|"changed",fields?:Array<string>,changes?:Array<{field,from?,to?,added?,removed?,changed?,entries?:Array<{name,kind,from,to}>,order?:{from:Array<string>,to:Array<string>}}>,values?:{tool,model,effort,level},title?,at:string|null}>,driftSeen?:string|null,visit?:{since:ISO|null,upTo:ISO|null}|{unavailable:true},overnight?:{accepted:number,since:string,events:Array<{kind:"accepted"|"verdict",ticket,at,note?,item?}>},decisions:Array<{id:"D-<n>",item:"I-<n>",kind:"question"|"suggestion"|"verdict"|"copy"|"dev"|"lead",short,said,title,answer,at,ticket?,variant?}>}. decisions : les réponses de the user à cette mission, la plus récente d’abord, comme « Your decisions » les lit (ticket M4) : seulement celles que les demandes ont enregistrées, sur la version de leur demande, mot pour mot (comme vouchedDecisions) ; une demande confiée au Lead n’en donne pas. short : le court énoncé de la demande, sinon son titre ; said et answer : le choix cliqué (ou le texte) ; pour un choix de texte ou de maquette, la variante par sa lettre (« variant B », « Variant B : <texte> », variant:"B") ; kind : celui de la demande, sinon dev pour la question d’un dev, lead pour une question du Lead sur un ticket posée après la demande de lancement (launchAskedAt), sinon question ; at : l’instant de la réponse. questions : les questions de state/questions, en consultation seulement ; une réponse de the user qui y figure ne vaut accord que livrée par les demandes (requests.vouches), jamais lue ici. La bascule est faite avant toute lecture de l’état, y compris ici (décision 61) : la toute première lecture après une installation ne rend jamais une ancienne autorisation. Les questions qui portaient une ancienne réponse de the user qu’aucune demande n’y avait posée sont archivées à la bascule et n’y figurent plus : aucun écran ne lisait ces questions, seuls Pilot et le Lead, et aucun accord n’en est tiré. items : les demandes de state/requests seulement (les anciennes sont dans inbox-list). Aperçu : MissionRead ; expired peut devenir true sans modifier les octets ni le hash ; aucune autorisation de lancement. approval : la copie figée du plan approuvé (ticket M5), telle qu’enregistrée par mission-launch, sans le plan entier qu’elle garde ; absente tant que le plan n’est pas approuvé (rien n’est affirmé). outside : les sous-tickets tenus hors de l’approbation pour de bon (décision 82) : ceux que le tracker avait avant la première approbation et que le plan ne nomme pas, quel que soit leur état (lus avec le plan par lead-plan, ou par la chaîne), et ceux qu’une approbation a retirés du plan ; ni approuvés ni écart, jamais lancés, gardés à travers une annulation, une réouverture et chaque réapprobation ; ils ne comptent pas pour la fin de la livraison (la mission passe en Validation sans eux) et la chaîne ne les annule jamais dans le tracker : c’est une décision de the user (décision 84). drift (ticket M7) : ce que le plan d’aujourd’hui et le tracker ont de plus ou d’autre que la copie figée, absent tant que le plan n’est pas approuvé, [] s’il n’y a rien : un ticket du plan absent de la copie (added), un ticket de la copie absent du plan (removed ; running:true quand son dev tourne encore, décision 85), un ticket des deux donné autrement (changed, fields : les champs qui diffèrent, jamais uid), un sous-ticket du tracker que le plan ne nomme pas, encore à faire, hors d’outside (added, une correction demandée en Validation ; changed si elle a bougé depuis son approbation, son niveau compris ; terminée, annulée ou disparue, aucun écart) ; toute autre partie du plan ajoutée, retirée ou changée (ticket:null, part : approach, phases, migrations, requests, simple, points, toPlan.manual, toPlan.risks, toPlan.copy, toPlan.accounts) ; la branche du worktree, une fois créé, autre que celle de la copie (ticket:null, part:"branch", décision 73). values : ce qui sera approuvé pour un ticket ajouté ou changé (outil, modèle, effort, niveau, en mots du tracker : léger, standard, fort) ; changes : chaque changement, en entier (décision 84 : la réapprobation n’approuve que ce qui est montré) : un champ simple (un texte long compris, jamais coupé), une liste de mots courts ou de nombres, ou le résumé d’une partie par ce qu’il était et ce qu’il est ({field,from,to}, null pour rien : une migration ajoutée donne sa valeur) ; une liste d’entrées par les entrées ajoutées, retirées et changées ({field,added,removed,changed}, chacune par son titre, ses quelques mots ou son id, sinon sa place #2), chacune en entier avant et après (entries : {name,kind,from,to}, décision 85) et la liste entière avant et après dès qu’elle change d’ordre, gagne ou perd une entrée (order, décision 86) ; un objet par chacun de ses champs changés (field : le nom du champ dans la partie, items, note, paragraphs…) ; toute autre valeur par son texte entier avant et après. Un ticket ajouté ou retiré, du plan ou du tracker (un nouveau sous-ticket), donne aussi chacun de ses champs (ce qu’il est ou était, décision 86). Un plan réenregistré tel qu’approuvé, quelle que soit sa révision, ne donne aucun écart. title : le titre du ticket (celui de la copie pour un ticket retiré). at : l’instant où le moteur a vu cet écart pour la première fois sous cette forme (en enregistrant le plan ou les tickets), null s’il ne l’a pas vu ; jamais inventé. driftSeen : la version de cet écart et de tout ce que la copie figerait (le plan entier, la branche), 16 caractères hexadécimaux, celle que mission-reapprove demande ; tout changement après le dessin en donne une autre ; null sans écart. kind, approves, history (M7) : une copie approuvée de nouveau (kind:"reapproval"), ce qu’elle a approuvé, et les approbations d’avant, sans leurs plans, avec ce que chacune disait (date, tickets, branche, questions, gestes, ce qu’elle approuvait) : l’ancienne approbation reste consultable depuis la fiche de la copie figée (décision 82). tokens? (ticket M13, décisions 101 et 106) : les jetons de la mission, {estimate:true,tickets:{<ticket>:{in,out,input,cacheRead,cacheWrite,unknown,agents:Array<{role,tool,turn,state:"counted"|"unknown",reason?:"trace"|"session"|"unreadable"|"too-large"|"shared",partial?:true,in,out,input,cacheRead,cacheWrite}>}},agents:Array<{role,tool,in,out,input,cacheRead,cacheWrite}>}, absent quand le moteur n’en a pas. estimate:true : chaque nombre est une estimation de la consommation (la page pourra afficher une estimation grâce à estimate:true), jamais une garantie ; null seulement quand rien n’est lisible pour ce lancement, avec sa raison, et tout total qui le contient l’est aussi. partial:true : la session a bougé pendant la lecture (un agent au travail), le nombre vient de ce qui a été lu. Limites écrites : une session écrite aussi par une autre mission n’est pas vue comme partagée (ses jetons comptent pour le lancement de cette mission) ; une réécriture pendant la lecture qui remet la taille et la date à l’identique n’est pas vue (le nombre peut mêler les deux versions). visit et overnight (ticket M14) : ce qui s’est passé depuis le dernier accusé de lecture de la page du ticket, pour tout lecteur ; une lecture ne fait jamais avancer le curseur (seul mission-visit-seen, commande des écrans). visit.since : l’instant du dernier accusé (null avant le premier) ; visit.upTo : le curseur (null avant le premier accusé). Une première visite montre les faits depuis la création de la mission ; la page n’accuse que ce qu’elle a dessiné, et rien tant qu’aucune ligne n’est affichée. visit {unavailable:true} : le curseur ou la chaîne est illisible, le récapitulatif est inconnu (jamais « rien »), la mission est lue quand même, overnight absent. overnight : les faits d’après le curseur, le plus récent d’abord : accepted (un ticket accepté par la chaîne, à l’instant de sa dernière acceptation, marque ok| de state/devchain-M-<n>.json ; note : ses tours de correction et ses revues, d’après timings) et verdict (une demande de verdict encore sans réponse ; item : sa demande). since : visit.since. accepted : le nombre de tickets acceptés. Absent quand rien ne s’est passé ; since vaut null pour une première visite. environment? (M6 b, src/environment-view.mjs, présent quand la mission a un projet) : {state:"ready"|"failed"|"unchecked"|"stale"|"checking"|"interrupted"|"unknown"|"not-configured",ok:true|false|null,recheck:boolean,cause?,detail?,pending?,missing?:Array<nom>,at?,sha?,interrupted?:true,checks:Array<{key:"database"|"migrations"|"accounts",ok:true|false|null,status,cause?,detail?,journal?,pending?,accounts?:{<nom>:boolean}}>}. ok vaut true seulement pour un dernier contrôle vert, pour la configuration et l’enregistrement d’aujourd’hui ; null seulement quand le projet ne déclare aucun environnement (lancement non retenu, décision 93) ; une lecture qui échoue donne unknown, jamais vert. Le verrou noyau est essayé à chaque lecture, marques présentes ou non, et relâché aussitôt (rien n’est repris) : tenu, un contrôle tourne, lancé de n’importe où : checking (cause CHECKING, recheck:false) ; illisible, invalide ou inaccessible, une marque qui n’est pas un fichier ou un dossier de marques illisible : unknown ; libre avec au moins une marque (contrôle mort avant sa sauvegarde) : interrupted (cause INTERRUPTED) ; libre sans marque : le dernier résultat. Chaque contrôle écrit sa propre marque .running-<id> avant d’essayer le verrou et ne retire que la sienne, après avoir sauvegardé son résultat (refusé, il la retire aussitôt) : aucun vert d’avant ne survit à un contrôle en cours ou interrompu, à aucun instant, quel que soit l’entrelacement de deux contrôles. Un ancien .running compte comme une marque. tokens.budgets : quatre lignes {role,consumed:number|null,budget:number,state:"ok"|"exceeded"|"stopped"|"unknown",partial:boolean}, détails dans simulation/CONTRAT.md. Aucun mod modifié par le lot 1D.

Écritures : Aucune, sauf la bascule tant qu’elle n’est pas faite (voir le déroulé « Bascule ») ; elle échoue avec LEGACY_ARCHIVE_FAILED et rien n’est lu. Mission durable : lecture de state/missions/M-<n>.json et de state/devchain-M-<n>.json  et, en lecture seule, state/visits/M-<n>.json (le curseur de M14). Aperçu : lecture privée du registre et du fichier ; aucun réseau, Git, configuration courante, terminal ou agent.

Confirmation : Aucune pour la lecture historique ; aucune confirmation de lancement dans ce lot.

Rejeu : Même snapshot et hash tant que le fichier correspond au registre. Un fichier inventé sans entrée de registre est NOT_FOUND ; fichier altéré => MISSION_INTEGRITY (JSON invalide => INVALID_DATA). Lien symbolique, fichier spécial/FIFO refusé sans attente, ouverture O_NOFOLLOW|O_NONBLOCK puis fstat.

Codes spécifiques : `INVALID_ARGUMENT`, `NOT_FOUND`, `MISSION_INTEGRITY`, `INVALID_DATA`, `UNSAFE_STORAGE` ; voir aussi les codes communs.

### `mission-visit-seen`

Accusé de lecture de « Since your last visit » (ticket M14) : la page du ticket l’envoie après avoir affiché au moins une ligne du récapitulatif, et seulement quand elle est visible (sa mise en page affichée dans la fenêtre qui a le focus, window().active ; signal absent : pas d’accusé). Le curseur avance jusqu’à upTo, l’instant du dernier fait affiché ; ce qui est accepté après cet instant reste à montrer.

Source : [src/mission.mjs](../src/mission.mjs), [src/visits.mjs](../src/visits.mjs), [src/backend.mjs](../src/backend.mjs).

Entrée : {mission:"M-<n>",upTo:ISO} : upTo, un instant ISO (Z) ; un instant à venir est ramené à maintenant (un fait à venir n’est jamais accusé). Tout autre champ refusé.

Sortie : {mission:"M-<n>",upTo:ISO,at:ISO} : le curseur tel qu’il est écrit (jamais en arrière : le plus tardif des deux) et l’instant de l’accusé.

Écritures : state/visits/M-<n>.json {upTo,at}, sous le verrou state/visits-lock ; rien d’autre de la mission. Un registre illisible (null ou toute valeur qui n’est pas un curseur compris) n’est jamais réécrit (INVALID_DATA).

Confirmation : L’affichage de la page vaut accusé : commande des écrans seulement, refusée depuis une session d’agent lancée par l’outil (AGENT_SESSION, même barrière que mission-pause, décision 70, avec la même limite) : un agent ne peut pas masquer un fait à the user.

Rejeu : Envoyé de nouveau, ou par deux pages dans n’importe quel ordre, le curseur garde le plus tardif ; seul at change.

Codes spécifiques : `INVALID_ARGUMENT`, `NOT_FOUND`, `AGENT_SESSION`, `INVALID_DATA`, `UNSAFE_STORAGE` ; voir aussi les codes communs.

### `ticket-backlog`

Backlog de la team du projet configuré : issues sans project Tracker, statut de type backlog, plus récentes d’abord. Ce que la page Issues affiche. Avec all:true, toutes les issues de la team (liste « Toutes »), toujours dans le périmètre du teamId configuré.

Source : [src/ticket-read.mjs](../src/ticket-read.mjs), [integrations/tickets/factory.mjs](../integrations/tickets/factory.mjs).

Entrée : {key:string,all?:boolean,refresh?:boolean} ; key est la clé du projet local (≤48), qui doit porter un teamId.

Sortie : {issues:LegacyIssue[],cached:boolean,updatedAt:string,teamId:string}. GraphQL filtre côté Tracker (project null, state.type backlog) ; MCP lit la liste de l’équipe et filtre localement.

Écritures : Cache selon transport ; aucune mutation.

Confirmation : Aucune.

Rejeu : refresh true recharge la liste.

Codes spécifiques : `NOT_FOUND`, `TEAM_NOT_CONFIGURED`, `INVALID_ARGUMENT`, `TICKET_API`, `TICKET_AUTH`, `TICKET_NOT_CONFIGURED`, `TICKET_MCP_API` ; voir aussi les codes communs.

### `ticket-create`

Création d’une issue dans le Backlog de la team du projet configuré (page Issues). Seule mutation de création ; le reste du cycle de vie passe par ticket-mutate.

Source : [integrations/tickets/factory.mjs](../integrations/tickets/factory.mjs).

Entrée : {key:string,title:string,operationId:uuid,another?:true,confirmed:true} ; titre ≤255 non vide ; operationId = identité de la soumission, choisie par l’écran au clic et gardée tant que le même titre est renvoyé ; another:true = créer une autre issue malgré une création identique encore incertaine. Le statut choisi est celui de type backlog de l’équipe (lu dans ticket-meta), sinon le statut par défaut de l’équipe.

Sortie : {issue:LegacyIssue,replayed?:true} tel que Tracker l’a renvoyé ; replayed quand l’issue de cette opération existait déjà (relue, pas recréée). Ou {issue:null,pending:{operationId,title,attemptedAt}} quand une création du même payload est encore incertaine sous une autre opération : rien n’est envoyé ; reprendre avec pending.operationId, ou renvoyer avec another:true.

Écritures : Mutation distante issueCreate avec un id d’issue choisi avant l’appel, et journal mutations/create-<operationId>.json {kind,operationId,issueId,payloadHash,status pending → applied | rejected | uncertain}. Le cache du backlog de l’équipe est oublié après une création.

Confirmation : confirmed true obligatoire ; l’appui sur le bouton de création de l’écran vaut confirmation.

Rejeu : Même operationId : applied => l’issue est relue (replayed) ; uncertain => l’issue est cherchée par son id, trouvée => applied sans nouvel envoi, absente => renvoyée avec le même id (Tracker refuse un doublon d’id) ; autre payload => INVALID_ARGUMENT. Deux soumissions de même titre sous deux opérations sont deux issues. Avant une opération nouvelle, les journaux publiés (create-<uuid>.json) sont parcourus : dossier absent = aucune création incertaine ; dossier illisible => MUTATION_JOURNAL_UNREADABLE, journal corrompu => INVALID_DATA, rien n’est envoyé ; les temporaires d’écriture sont ignorés.

Codes spécifiques : `CONFIRMATION_REQUIRED`, `INVALID_ARGUMENT`, `NOT_FOUND`, `TEAM_NOT_CONFIGURED`, `TICKET_MUTATION_FAILED`, `TICKET_READ_ONLY`, `TICKET_API`, `TICKET_AUTH`, `TICKET_NOT_CONFIGURED`, `MUTATION_JOURNAL_UNREADABLE`, `INVALID_DATA` ; voir aussi les codes communs.

### `po-launch`

Lancement de la session PO (rôle roles/po.md) sur une issue de la team, dans un pane Herdr, avec l’outil de la table d’agents (src/agents.mjs) choisi par la config : preferredAgent du projet, sinon de la config, sinon Claude. Pas de worktree : le PO lit le code, il ne le modifie pas.

Source : [src/po-launch.mjs](../src/po-launch.mjs), [src/agents.mjs](../src/agents.mjs).

Entrée : {key:string,issueId:string,confirmed:true}. L’issue est relue en entier au lancement et doit appartenir à la team du projet.

Sortie : {session:SessionPO,reused:boolean,warning?:string} ; SessionPO = SessionV1 avec role:'po', worktree/branch/mainBranch/baseCommit null, repo = dossier de travail (dépôt du projet, ou dossier commun de ses dépôts) ; warning quand la consigne n’a pas été remise au terminal (firstMessageSent false).

Écritures : state.json (intention écrite seulement après lecture du rôle et construction du prompt, puis terminal), hc run (argv construit par hcRunArgs : claude <prompt> ou codex --no-daemon <prompt>) avec labels herdr.space=fabrique-console-<key>, herdr.tab=fabrique-console-<session>, fabrique-console.app, fabrique-console.issue, fabrique-console.session, fabrique-console.role=po ; prompt = rôle + contexte + issue balisée <ticket-data-untrusted>, ≤65536 octets.

Confirmation : confirmed true obligatoire ; le bouton « Lancer » de l’écran vaut confirmation.

Rejeu : Terminal possédé vivant => reused:true sans nouveau lancement (la session garde son outil même si la config a changé) ; la remise de la consigne est relue sur le terminal (first_message.sent) quand la réponse du lancement s’était perdue, avec warning si elle n’a jamais été remise ; terminal disparu => nouveau terminal pour la même session, le PO relit Tracker ; launchUncertain => réconcilier avant relance ; consigne jamais remise => PO_PROMPT_UNDELIVERED, arrêter la session (stop) avant de relancer, la session arrêtée n’est plus reprise ; labels contradictoires ou plusieurs terminaux => TERMINAL_OWNERSHIP.

Codes spécifiques : `CONFIRMATION_REQUIRED`, `NOT_FOUND`, `TEAM_NOT_CONFIGURED`, `PO_FOLDER_UNAVAILABLE`, `ISSUE_NOT_IN_TEAM`, `PO_PROMPT_TOO_LARGE`, `LAUNCH_UNCERTAIN`, `PO_PROMPT_UNDELIVERED`, `TERMINAL_OWNERSHIP`, `HC_UNAVAILABLE`, `HC_PROTOCOL` ; voir aussi les codes communs.

### `agent-start`

Démarrage de l’assistant général d’un outil (page Agent) : un terminal par outil, hors team, dans ~/Developer, dans l’espace Herdr fabrique-console-agent ; argv de la table d’agents, sans prompt.

Source : [src/agent-start.mjs](../src/agent-start.mjs), [src/agents.mjs](../src/agents.mjs).

Entrée : {tool:'claude'|'codex'}.

Sortie : {terminalId:string,tool:string}.

Écritures : Aucun fichier local ; hc run --name fabrique-console-agent-<tool> (nom unique parmi les terminaux vivants : un second démarrage du même outil est refusé par hc) avec labels herdr.space=fabrique-console-agent, herdr.tab=fabrique-console-agent-<tool>, fabrique-console.app, fabrique-console.role=agent, fabrique-console.tool=<tool>.

Confirmation : Aucune : le bouton « Démarrer » de la page Agent lance ; pas de session dans state.json (l’assistant n’est pas un PO).

Rejeu : Pas d’idempotence locale : l’unicité tient au nom hc ; un refus de hc (nom pris, réponse perdue) remonte LAUNCH_UNCERTAIN et l’écran relit les terminaux pour afficher l’assistant vivant.

Codes spécifiques : `INVALID_ARGUMENT`, `LAUNCH_UNCERTAIN`, `HC_UNAVAILABLE`, `HC_PROTOCOL` ; voir aussi les codes communs.

### `issue-worktree`

Worktree d’intégration de l’issue, sous ~/Developer/worktrees/<dépôt>/<ISSUE>, branche <issue>. Chaque dépôt Git imbriqué direct y a son worktree au même endroit. Les agents du nouveau flux utilisent ticket-branch pour leur worktree dédié, puis ticket-merge après acceptation.

Source : [src/issue-worktree.mjs](../src/issue-worktree.mjs).

Entrée : {sessionId:string,base?:string (branche de base, ex. release/backoffice-v2),rebase?:boolean}.

Sortie : {path:string,branch:string,base:string|null,created:string[],rebased:Array<{repo,result:"rebased"|"dirty"|"conflict"}>}.

Écritures : git fetch origin <base> puis git worktree add depuis origin/<base> (sinon HEAD) pour le dépôt du PO et chaque dépôt imbriqué absent ; avec rebase:true, chaque worktree propre déjà là est rebasé sur origin/<base> (un conflit est annulé par rebase --abort et rendu) ; state.json : session.worktree, branch, base.

Confirmation : Aucune autre : le clic « Lancer les devs ».

Rejeu : Idempotent : un worktree déjà là est gardé tel quel ; seuls les manquants sont créés.

Codes spécifiques : `NOT_FOUND`, `INVALID_ARGUMENT`, `WORKTREE_FAILED` ; voir aussi les codes communs.

### `dev-reports`

Comptes rendus des agents d’une issue, lus dans <worktree>/.fabrique-console/ : <ticket>.dev.json (dev : commit, résumé) et <ticket>.review-<n>.json (relecteur : commit, verdict accepted|changes_requested, résumé). La page Issue s’en sert pour lancer la revue puis les tickets qui attendaient. La commande scripts/fabrique-console-report.mjs écrit et vérifie le format ; les notes non bloquantes de revue sont rendues dans notes[]. Dans un worktree de ticket, baseCommit et repositories[] fixent les diffs baseCommit → commit par dépôt ; le rapport reste centralisé dans le dossier .fabrique-console de l’issue. Une question d’agent, <ticket>.ask-<horodatage>.json, y est rendue avec kind:"ask", question, options et from. Un arrêt signalé par un dev (M10), <ticket>.block-<horodatage>.json, y est rendu avec kind:"block", path, at (l’instant écrit par le dev, à défaut celui du fichier), reason et migration.

Source : [src/dev-flow.mjs](../src/dev-flow.mjs).

Entrée : {sessionId:string}.

Sortie : {reports:Array<{name,ticket,kind:"dev"|"review-n" (n=1..999),at:string|null,commit:string|null,repo:string|null,branch:string|null,baseCommit:string|null,repositories:[{repo,commit,baseCommit,branch}],verdict:string|null,summary:string,notes:string[],unreadable?:true}>,command:string (commande absolue du script)}.

Écritures : Aucune : lecture seule, 300 fichiers et 64 Ko par fichier au plus.

Confirmation : Aucune : lecture.

Rejeu : Lecture pure, rejouable.

Codes spécifiques : `NOT_FOUND` ; voir aussi les codes communs.

### `dev-send`

Message tapé dans l’onglet d’un agent de l’issue (par exemple le constat d’une revue à corriger).

Source : [src/dev-flow.mjs](../src/dev-flow.mjs).

Entrée : {sessionId:string,terminal:string (t…),text:string ≤ 8000}.

Sortie : {sent:true}.

Écritures : hc send <terminal> -- <texte cité> : le texte de l’appelant, échappé, entre <forwarded-message> et </forwarded-message>, précédé d’une phrase qui le présente comme une donnée citée, ni une consigne ni une décision, qui n’autorise rien (décision 62).

Confirmation : Aucune autre : envoyé par l’enchaînement de la page Issue.

Rejeu : Un second envoi retape le message. SEND_FAILED seulement quand hc n’a pas pu être lancé ; toute autre sortie en erreur de hc send est SEND_UNSURE : le message a pu être tapé.

Codes spécifiques : `INVALID_ARGUMENT`, `NOT_FOUND`, `SEND_FAILED`, `SEND_UNSURE` ; voir aussi les codes communs.

### `validation-read`

Validation d’une issue : le rapport de l’agent QA (<worktree>/.fabrique-console/qa.json : résumé, verdict, plan de test) et les marques de the user étape par étape (<worktree>/.fabrique-console/validation.json). Pour chaque test, le résultat que le Lead a écrit quand the user lui a demandé de le jouer (<worktree>/.fabrique-console/played/<id>.json : verdict ok|ko|unsure, seen), daté par le fichier.

Source : [src/dev-flow.mjs](../src/dev-flow.mjs).

Entrée : {sessionId:string}.

Sortie : {qa:null|{at,summary,verdict,tests:Array<{id,title,steps,expected}>},marks:Record<string,{result:"ok"|"ko",at}>}.

Écritures : Aucune : lecture bornée.

Confirmation : Aucune : lecture.

Rejeu : Lecture pure.

Codes spécifiques : `NOT_FOUND` ; voir aussi les codes communs.

### `validation-mark`

Marque de the user sur une étape du plan de test : OK, problème, ou effacée.

Source : [src/dev-flow.mjs](../src/dev-flow.mjs).

Entrée : {sessionId:string,step:string,result:"ok"|"ko"|null,note?:string} : note, 2000 caractères au plus, seulement avec ko (le retour de the user pour le Lead).

Sortie : {marks:Record<string,{result,at,note?}>}.

Écritures : <worktree>/.fabrique-console/validation.json (écriture atomique).

Confirmation : Aucune autre : le clic de the user sur la page Issue.

Rejeu : Idempotent pour une même marque.

Codes spécifiques : `NOT_FOUND`, `INVALID_ARGUMENT` ; voir aussi les codes communs.

### `watch-start`

Démarre le veilleur (src/watch-run.mjs, boucle de src/watch.mjs) : un processus résident, détaché, qui lit l’état herdr-core toutes les 2 s et Tracker (backlog de chaque team, My issues) toutes les 60 s, et écrit chaque réponse datée sous <root>/state/ ; la barre V3 suit ce dossier (watchFolder) et partage les fichiers changés. Aucun écran ne lit herdr-core ou Tracker sur minuteur.

Source : [src/watch.mjs](../src/watch.mjs), [src/watch-run.mjs](../src/watch-run.mjs).

Entrée : {} ; sans argument.

Sortie : {started:boolean,pid:number|null} ; started false quand un veilleur bat déjà (watcher.json récent et processus vivant).

Écritures : state/lease (renouvelé), puis spawn détaché de node src/watch-run.mjs avec FABRIQUE_CONSOLE_HOME=<root> ; le veilleur écrit state/watcher.json {pid,startedAt,at} à chaque cycle, state/snapshot.json, state/inbox.json, state/my-issues.json, state/issues-<key>.json (toutes les issues de la team) ({at,data} ; data = {error} quand la lecture a échoué), écritures atomiques (tmp puis rename).

Confirmation : Aucune.

Rejeu : Idempotent : un veilleur vivant n’est pas doublé ; state/watcher.json est aussi le verrou (le processus qu’il nomme possède le dossier) ; prise, battement, publication et retrait passent par le mutex state/watcher.lock (dossier préparé avec son pid puis rename atomique ; un mutex dont le détenteur est mort est retiré par un seul nettoyeur, dont le droit est un fichier tomb-<pid>.<k> créé en exclusivité dans l’instance morte ; libération par rename de côté puis suppression ; contention au-delà de 5 s = MUTEX_BUSY), si bien qu’un veilleur ayant lu un battement ancien ne peut ni reprendre un verrou pris depuis, ni publier par-dessus son propriétaire ; un verrou périmé, absent ou illisible (écriture coupée) est remplacé d’une écriture atomique ; un second veilleur se termine (WATCHER_RUNNING, sortie 0) ; un veilleur dont le verrou a été repris, ou qui a vu stop, s’arrête dans le cycle, sans y toucher et sans attendre ses lectures en cours, qui ne publient plus. Le veilleur s’arrête quand state/lease n’est plus renouvelé depuis 10 min, ou qu’un fichier state/stop existe. Les lectures ne bloquent ni le battement ni le snapshot (toutes les 2 s) ; une lecture sans réponse après 120 s est publiée TIMEOUT.

Codes spécifiques : `HC_UNAVAILABLE`, `HC_PROTOCOL`, `TIMEOUT`, `MUTEX_BUSY` ; voir aussi les codes communs.

### `watch-status`

État du veilleur tel que les écrans le voient.

Source : [src/watch.mjs](../src/watch.mjs).

Entrée : {}.

Sortie : {running:boolean,pid:number|null,at:string|null} ; running = battement de moins de 15 s et processus vivant.

Écritures : Aucun.

Confirmation : Aucune.

Rejeu : Lecture seule.

Codes spécifiques : aucun ; voir aussi les codes communs.

### `watch-poke`

Demande au veilleur de relire Tracker maintenant (refresh), pour les boutons Actualiser.

Source : [src/watch.mjs](../src/watch.mjs).

Entrée : {}.

Sortie : {poked:true}.

Écritures : state/poke (texte ISO), consommé par le veilleur à son prochain cycle.

Confirmation : Aucune.

Rejeu : Sans effet si aucun veilleur ne tourne (le fichier reste jusqu’au prochain).

Codes spécifiques : aucun ; voir aussi les codes communs.

### `ticket-my-issues`

Les projects Tracker de chaque team configurée, avec toutes leurs issues, et l’activité (toutes les issues par dernière mise à jour) : ce que la page « My issues » liste (onglets Projects et Activity).

Source : [src/ticket-read.mjs](../src/ticket-read.mjs), [integrations/tickets/factory.mjs](../integrations/tickets/factory.mjs).

Entrée : {refresh?:boolean}. Une lecture de liste par team portant un teamId.

Sortie : {teams:[{key,name,teamId,projects:[{id,name,counts:{<state.type>:n},states:[{name,type,count}] (noms des statuts Tracker, dans l’ordre des types),total,issues:[{id,identifier,title,url,priority,state,assignee,labels:[{name,color?}],createdAt,updatedAt,parentId:string|null,blocks:number,blockedBy:number}]}],error?:{code,message}}],activity:[{…issue,team:{key,name},project:{id,name}|null}] (300 plus récentes par updatedAt, teams lisibles),relations:'full'|'parent'|'none',cached:boolean,updatedAt:string|null}. Toutes les issues du project sont listées, triées par état (started, triage, unstarted, backlog, completed, canceled, unknown) puis identifiant ; counts.unknown compte les issues dont l’état n’a pas pu être classé. Une team illisible porte error, les autres restent listées. parentId désigne le parent lu, sinon null. blocks et blockedBy comptent les issues distinctes aux extrémités des relations blocks sortantes et inverses, sans filtrer leur statut. full = parent et deux sens lus intégralement (pagination bornée, relations archivées exclues) ; parent = hiérarchie seule lue ; none = ni parent ni relations établis. La capacité est le minimum des équipes lisibles, none si aucune ne l'est. Hors full, les compteurs non lus restent à 0 : ce zéro ne prouve pas une absence de dépendance. MCP n'ajoute aucun appel par issue ; parentId est conservé seulement lorsqu'il est fourni, ou demandé si le catalogue l'annonce.

Écritures : Cache selon transport ; aucune mutation.

Confirmation : Aucune.

Rejeu : refresh true recharge chaque liste. Les versions de cache des listes changent pour ne pas réutiliser une ancienne réponse sans métadonnées de relations.

Codes spécifiques : `INVALID_ARGUMENT`, `TICKET_NOT_CONFIGURED` ; voir aussi les codes communs.

### `po-ask`

Question d’un PO à the user, par l’outil et non par l’écran du terminal : elle apparaît dans l’Inbox (section « Vous attend ») avec ses réponses exactes. La commande est donnée au PO dans son contexte de lancement (po-launch). Une question portant une porte (gate) clôt une étape de la méthode (Plan, Découpage, Réalisation, Validation) : sa première réponse est la validation de the user.

Source : [src/po-questions.mjs](../src/po-questions.mjs).

Entrée : {sessionId:string,id:string (/^[a-z0-9][a-z0-9-]{0,31}$/, distinct par question),question:string (≤ 500),options?:string[] (0 à 4 réponses ≤ 60 caractères, distinctes, sans retour à la ligne),gate?:'plan'|'split'|'launch'|'check' (porte de fin d’étape : la première réponse de options est la validation)}.

Sortie : {asked:true,question:{id,text,options,askedAt,gate?}}.

Écritures : state.json : session.question (remplace la précédente), session.askedIds (les 500 derniers ids employés), session.readyAt = null, session.updatedAt.

Confirmation : Aucune (la session PO existe et n’est pas arrêtée).

Rejeu : La même question (même id, texte, réponses et porte) reposée est idempotente ; un id déjà employé pour une autre question est refusé (QUESTION_ID_USED) : une réponse donnée à une proposition ne vaut jamais pour la suivante. Une nouvelle question remplace l’ancienne (une seule question active par session).

Codes spécifiques : `INVALID_ARGUMENT`, `NOT_FOUND`, `SESSION_STOPPED`, `QUESTION_ID_USED` ; voir aussi les codes communs.

### `po-answer`

Réponse de the user à la question active d’un PO, depuis la carte de l’Inbox ou la page Issue : l’une des réponses proposées ou un texte libre, remise au terminal du PO par hc send.

Source : [src/po-questions.mjs](../src/po-questions.mjs).

Entrée : {sessionId:string,id:string (l’id de la question active),askedAt:string (son heure, telle que le snapshot la donne),text:string (≤ 2000),optionIndex?:integer (place de la réponse choisie ; 0 avec le texte exact de la première réponse seul valide une porte)}.

Sortie : {sent:true,terminalId:string}.

Écritures : hc send [--if idle] <terminal> -- <texte> sur le seul terminal qui porte le label fabrique-console.session de cette session, sans label d’un autre travail (rôle, issue), et seulement s’il est idle (envoi gardé par --if idle) ou done (tour fini : l’état et l’appartenance du terminal sont relus juste avant l’envoi, sans garde hc possible) ; puis state.json : session.question = null, session.answeredAt. Porte validée (optionIndex 0 et texte exact de la première réponse), depuis son étape de départ seulement (plan depuis plan, split depuis plan ou split (valider le découpage vaut aussi validation du plan), launch depuis plan, split ou dev, check depuis check) : session.step avance (plan → split, split → dev, launch → dev, check → close avec session.readyAt comme po-ready), session.stepAt. Sans optionIndex, toute autre réponse, ou une porte périmée (étape déjà passée) : réponse remise, step, stepAt et readyAt inchangés.

Confirmation : Aucune.

Rejeu : Une question répondue ou remplacée, ou dont l’heure ne correspond pas (même id reposé plus tard), est QUESTION_GONE : pas de double envoi. Un envoi refusé (SEND_FAILED) garde la question ; lire le terminal avant de renvoyer.

Codes spécifiques : `INVALID_ARGUMENT`, `NOT_FOUND`, `SESSION_STOPPED`, `QUESTION_GONE`, `QUESTION_STALE`, `TERMINAL_GONE`, `TERMINAL_OWNERSHIP`, `SEND_FAILED` ; voir aussi les codes communs.

### `po-ready`

Le PO dit que tout est validé et n’attend plus que la clôture de the user : la session passe à l’étape « À clôturer » (Inbox).

Source : [src/po-questions.mjs](../src/po-questions.mjs).

Entrée : {sessionId:string}.

Sortie : {ready:true,readyAt:string}.

Écritures : state.json : session.readyAt, session.question = null, session.step = close, session.stepAt.

Confirmation : Aucune.

Rejeu : Idempotent (readyAt renouvelé) ; une question posée ensuite (po-ask) retire readyAt.

Codes spécifiques : `INVALID_ARGUMENT`, `NOT_FOUND`, `SESSION_STOPPED` ; voir aussi les codes communs.

### `po-step`

Le PO annonce l’étape où il entre (plan, split, dev, check, close), en secours quand the user a validé dans le terminal : la page Issue la montre dans sa barre d’étapes. Les anciennes étapes (issue, analysis, plan ancien) et une étape absente se lisent plan ; aucune validation n’en est déduite.

Source : [src/po-questions.mjs](../src/po-questions.mjs).

Entrée : {sessionId:string, step:'plan'|'split'|'dev'|'check'|'close'}.

Sortie : {step:string, stepAt:string}.

Écritures : state.json : session.step, session.stepAt (seulement si l’étape change) ; une étape autre que close après po-ready retire session.readyAt (le PO a repris).

Confirmation : Aucune.

Rejeu : Idempotent : la même étape redite ne change rien.

Codes spécifiques : `INVALID_ARGUMENT`, `NOT_FOUND`, `SESSION_STOPPED` ; voir aussi les codes communs.

### `ticket-branch`

Prépare un worktree et une branche dédiés au ticket depuis les HEAD courants des branches de l’issue, pour le dépôt racine et ses dépôts Git imbriqués directs, comme issue-worktree. Choix confirmé : branche <issue>--<ticket> ; Git ne permet pas <issue>/<ticket> quand <issue> existe déjà.

Source : [src/ticket-worktree.mjs](../src/ticket-worktree.mjs).

Entrée : {sessionId:string,ticket:string (identifiant Tracker, ex. XJ-690)}.

Sortie : {path:string,branch:string,issuePath:string,issueBranch:string,reused:boolean,repositories:[{repo:string ("." ou nom du dépôt imbriqué),path:string,baseCommit:string,branch:string}]}.

Écritures : git worktree add -b <issue>--<ticket> <racine>/<ISSUE>-<TICKET> <baseCommit> dans chaque dépôt ; .fabrique-console/ticket.json du worktree ticket conserve les bases et le dossier de l’issue. Exclusion locale .fabrique-console/ ajoutée si absente. Aucun fetch, push, reset ni suppression.

Confirmation : Commande interne d’enchaînement après lancement de l’issue ; aucune confirmation supplémentaire.

Rejeu : Reprend le même worktree reconnu et les mêmes bases, y compris après nouvelle session PO de la même issue. Collision de dossier/branche non reconnue refusée, sans suppression. Une préparation partielle conserve ses fichiers et peut reprendre les dépôts manquants.

Codes spécifiques : `INVALID_ARGUMENT`, `NOT_FOUND`, `WORKTREE_CHANGED`, `WORKTREE_COLLISION`, `WORKTREE_FAILED` ; voir aussi les codes communs.

### `ticket-merge`

Fusionne les commits de chaque dépôt touché du ticket dans la branche d’intégration de l’issue, après la revue gérée par l’appelant.

Source : [src/ticket-worktree.mjs](../src/ticket-worktree.mjs).

Entrée : {sessionId:string,ticket:string (identifiant Tracker)}.

Sortie : {status:"merged"|"conflict",path:string (worktree issue),branch:string (branche issue),merged:[{repo,previousCommit,commit}],unchanged:string[],conflicts:[{repo,files:string[]}]}.

Écritures : Avant toute fusion : toutes les cibles et leurs branches sont vérifiées, les dépôts touchés doivent être propres et sans opération Git en cours. git merge-tree --write-tree --name-only -z prévisualise tous les dépôts (objets seulement) : conflit ⇒ aucune branche/index/arbre déplacé. Sinon git merge --no-edit <SHA> dans chaque dépôt d’issue touché : fast-forward ou commit de fusion. Un conflit imprévu est annulé avec merge --abort. Aucun push et aucune suppression de branche/worktree.

Confirmation : L’enchaînement appelle cette action après acceptation ; l’action ne décide ni la revue ni le statut Tracker.

Rejeu : Un commit déjà intégré est rendu unchanged. Les rapports disponibles figent les SHA attendus : un ticket avancé depuis son rapport donne REPORT_STALE. Panne Git autre qu’un conflit après une fusion réussie : MERGE_FAILED, fusions déjà réussies conservées, inspection/rejeu nécessaire ; aucune restauration forcée de l’historique.

Codes spécifiques : `INVALID_ARGUMENT`, `NOT_FOUND`, `WORKTREE_CHANGED`, `WORKTREE_COLLISION`, `WORKTREE_FAILED`, `WORKTREE_DIRTY`, `REPORT_STALE`, `MERGE_FAILED` ; voir aussi les codes communs.

### `dev-launch`

Lance le dev d’un ticket d’une mission, depuis le plan que son Lead y a enregistré (lead-plan), à la demande du Lead ou de l’enchaînement quand vient le tour d’un ticket : worktree de l’issue, puis pour le ticket son worktree et sa branche (ticket-branch, partie de la branche de l’issue telle qu’elle est) et un terminal d’agent de herdr-core, montré dans un onglet à côté du Lead dans la fenêtre Herdr App. Un seul dev vivant par mission : il n’est demandé que sous le verrou du couloir de la mission (state/devlane/M-<n>), tenu pendant tout le lancement, pour le ticket qui tient le couloir, après que herdr-core a répondu qu’aucun autre ne vit ; herdr-core lui-même refuse un second terminal vivant sous le nom de la mission (hc run --name mc-dev-<empreinte>). La garantie porte sur les terminaux de dev lancés ainsi et sur leur arrêt vu dans herdr-core : un terminal ouvert sans l’outil, ou un programme que le dev a détaché, n’est ni vu ni arrêté. Un ticket ne part que si ce qu’il attend est fini et que le couloir est libre (le ticket précédent accepté et fusionné, ou annulé, et son dev constaté arrêté dans herdr-core). Une mission sans plan enregistré (ancien format, ou pas encore planifiée) est refusée avant toute écriture ; une mission dont les devs ont été lancés par l’ancien mécanisme (fichier de chaîne sans couloir) aussi (DEV_LANE_OLD), définitivement : aucune commande ne la remet à plat.

Source : [src/dev-chain.mjs](../src/dev-chain.mjs), [src/dev-lane.mjs](../src/dev-lane.mjs), [src/mission.mjs](../src/mission.mjs).

Entrée : {sessionId:string (session du Lead) | mission:"M-<n>",tickets:Array<{identifier:string,tool:"claude"|"codex",model:string,effort:"low"|"medium"|"high"}>,fresh?:boolean (false : lancement par le Lead ou l’enchaînement),resume?:boolean}. Pour un ticket du plan, tool, model et effort sont ceux du plan : une demande qui en donne d’autres n’est pas lancée.

Sortie : {worktree:{path,branch,base,created,rebased,command},launched:Array<{identifier,launched:boolean,reason?:string}>}. reason : "waits" (ce qu’il attend n’est pas fini), "serial" (un autre ticket tient le couloir, ou un ticket lancé et pas fini passe avant lui), "rank" (un ticket du plan, avant lui par son rang, est prêt : c’est lui qui part, quelle que soit la liste demandée), "already" (son dev vit dans herdr-core ; ou son dev est arrêté et la demande n’est pas une relance), "over" (relance d’un ticket déjà accepté et fusionné : plus rien à y lancer), "not-in-copy" et "copy-changed" (hors de la copie figée du plan approuvé, ou changé depuis : NOT_IN_COPY, COPY_CHANGED, décision 77 ; dit une fois dans le journal de la mission, le lancement automatique du veilleur compris : « Launch blocked for <ticket>. », la raison dans les mots de l’interface, décision 87), "canceled" (annulé dans le tracker), "blocked" (un terminal vit sous le nom du dev de la mission et n’est pas le dev que le couloir connaît : rien n’est lancé ni arrêté tant qu’il vit), "plan-differs" (agent, modèle ou effort autres que ceux du plan), "not-developed" (ticket de conception, différé, associé ou intégré par un autre : jamais lancé), "unverified" (son identité n’a jamais été lue dans le tracker, ou ce n’est ni un ticket du plan ni un sous-ticket de l’issue), ou le message de l’échec du lancement (dont : herdr-core n’a pas confirmé le dev ; le couloir reste alors « demandé » et le passage suivant du veilleur lit herdr-core).

Écritures : Rien pour une mission sans plan, pour une mission de l’ancien mécanisme ni pour une session sans mission (refus). Sinon : verrou state/devlane/M-<n>/operation.guard, tenu jusqu’à la fin ; espace Herdr de la mission retrouvé par son nom (fabrique-console-<projet>-<issue>), à défaut celui du terminal du Lead, créé sinon (herdr-app do space.new) ; issue-worktree puis ticket-branch pour le ticket ; hc get (nom de la mission, adresse du couloir), puis un seul hc run --bg --keep --name mc-dev-<empreinte> avec les étiquettes fabrique-console.mission, fabrique-console.ticket, fabrique-console.launch, herdr.space, herdr.tab ; herdr-app do tab.rename (nom affiché « <ticket> · dev », redemandé au passage suivant s’il échoue), puis space.select/tab.select pour remontrer l’onglet du Lead (bouton) ou celui que regardait the user (enchaînement) ; state/missions/M-<n>.json (worktree, branche, base, étape building) ; <root>/state/devchain-M-<n>.json : on, couloir (lane : {ticket,launch,tab:"asked"|"seen",terminal}, écrit « asked » avant la demande à herdr-core et jamais effacé par un échec), date du premier lancement (dev|<ticket>), base notée avant le lancement de chaque ticket (bases.<ticket> : {at,branch,repositories:[{repo,commit}]}), fil des événements.

Confirmation : Aucune autre : la demande de lancement de the user, transmise par le Lead (lead-request).

Rejeu : Rejouable : sous le verrou du couloir, une demande pour un ticket dont le dev vit rend already, pour un autre ticket rend serial. Deux demandes simultanées passent l’une après l’autre (la seconde attend le verrou dix secondes au plus, puis DEV_LANE_BUSY) et ne lancent qu’un dev. Après une demande dont la réponse s’est perdue, le couloir reste « demandé » : le veilleur le constate « vu » si herdr-core montre le terminal, sinon s’arrête et le signale une fois dans l’Inbox sans réessayer seul ; la même demande rejouée par l’utilisateur relance hc run sous le même nom, que herdr-core refuse si le premier terminal vit.

Codes spécifiques : `NOT_FOUND`, `INVALID_ARGUMENT`, `NO_SPACE`, `WORKTREE_FAILED`, `MISSION_FORMAT_OLD`, `SESSION_STOPPED`, `DEV_LANE_OLD`, `DEV_LANE_BUSY`, `TRACKER_UNAVAILABLE`, `HC_UNAVAILABLE`, `INVALID_DATA`, `NOT_APPROVED`, `ENVIRONMENT_NOT_READY`, `MISSION_PAUSED` ; voir aussi les codes communs.

### `dev-chain-read`

Ce que la page Issue affiche de l’enchaînement : les comptes rendus des agents (comme dev-reports), le fil des événements, si l’enchaînement tourne, et les mesures par ticket.

Source : [src/dev-chain.mjs](../src/dev-chain.mjs).

Entrée : {sessionId:string} ou {mission:"M-<n>"}.

Sortie : {reports:[…comme dev-reports],command:string,log:Array<{at:"HH:MM",text,tone,detail}>,on:boolean,metrics:{<ticket>:{rounds,fixes,devMin|null,reviewMin|null,totalMin|null}},timings:{<ticket>:Array<{step:"dev"|"review-1"|"review-2"|"fix",minutes:number|null,commit?:string,delivered?:string,verdict?:"accepted"|"changes_requested"|null}>}}. timings (ticket M8) : la durée de chaque étape d’un ticket, dans l’ordre où la page les dessine (le dev, chaque revue dont le verdict est connu avec la correction après celle qui demande des changements, puis les revues en cours de la dernière livraison), mesurée sur les marques durables de la chaîne (dev demandé au noyau, livraison vue, une par tour, relecteur lancé, verdict vu, corrections envoyées) et non sur les comptes rendus, que chaque tour remplace : les étapes des tours d’avant restent ; chaque revue et chaque correction nomme sa livraison (commit, et delivered, l’heure de son compte rendu de dev), l’étape dev aucune : la page relie chaque durée à la ligne de sa livraison, jamais à la place des lignes (décision 90) ; en minutes d’horloge, comme le journal écrit ses heures ; une étape en cours court jusqu’à maintenant ; une marque sans heure (travail repris de ses comptes rendus) ou absente donne minutes:null ; un veilleur relancé retrouve les mêmes marques. verdict (ticket M9) : chaque revue dont le verdict est connu le dit, celui que la chaîne a gardé en le voyant (marque said|…), sinon son compte rendu, sinon l’acceptation de son tour ; null quand rien ne le dit (verdict vu avant cette version, fichier remplacé depuis) ; une revue en cours n’en a pas : la trace des revues garde chaque tour, alors que chaque fichier ne garde que le dernier.

Écritures : Aucune : lecture.

Confirmation : Aucune : lecture.

Rejeu : Lecture pure, rejouable.

Codes spécifiques : `NOT_FOUND`, `INVALID_ARGUMENT` ; voir aussi les codes communs.

### `dev-chain-tick-all`

Un pas de l’enchaînement pour chaque mission active, appelé par le veilleur toutes les six secondes, sans dépendre d’un terminal de Lead : revue d’un compte rendu, corrections renvoyées, fusion d’un ticket accepté (ticket-merge), onglets des relecteurs fermés, compte rendu demandé une fois, dev du ticket accepté et fusionné, ou annulé, arrêté tout de suite (hc kill, qu’il travaille ou non) puis constaté arrêté dans herdr-core avant que le couloir se libère, ticket suivant lancé (un seul dev vivant par mission, par rang, quand ce qu’il attend est fini et que le couloir est libre ; un ticket annulé puis rouvert reprend sa place seul, à son rang, quand le couloir est libre : son dev est relancé s’il n’a pas rendu de compte rendu ou si sa revue a demandé des corrections, alors renvoyées une fois à ce nouveau dev dès qu’il est vu dans herdr-core, même si la réponse de son lancement s’est perdue (un envoi fait au dev d’avant ne vaut pas pour lui) ; tant que son compte rendu attend une revue ou une fusion, aucun dev ne part, ni le sien ni celui d’un ticket suivant ; rien n’est repris de l’ancien dev, hormis son worktree), agent QA et passage en Validation quand tous les tickets développés dans la livraison sont finis (un ticket de conception, différé, associé ou intégré par un autre ne retient rien), notification macOS quand un agent attend the user, point d’avancement au Lead quand il est inactif (gardé tant qu’il n’a pas de terminal). Aucun message ne recopie un texte que la chaîne n’a pas écrit (décision 61) : la consigne d’un relecteur nomme le compte rendu du dev (<worktree>/.fabrique-console/<ticket>.dev.json), les corrections renvoyées au dev nomment la revue (<worktree>/.fabrique-console/<ticket>.review-<n>.json), et un commit ou un dépôt n’y figure que s’il en a la forme (empreinte hexadécimale, nom de dossier). Les tickets, leur ordre et ce qu’ils attendent viennent du plan enregistré dans la mission, et de rien d’autre : ni le tableau de la description ni les liens du tracker ne sont lus. Une mission dont les devs ont été lancés sans plan (ancien format) n’est pas pilotée : elle est rendue avec refused, sans rien lire ni écrire. Une session PO de la première version ne reçoit plus de mission. Chaque mission est traitée sous le verrou de son couloir (state/devlane/M-<n>) : une mission dont le couloir est occupé (un lancement, un autre pas) est sautée, rendue avec skipped. Un dev demandé que herdr-core ne montre pas au passage suivant : le veilleur s’arrête pour ce ticket et le signale une fois dans l’Inbox (stuck, cause dev), sans réessayer seul. Tant que personne n’a vu ce terminal (adresse inconnue), une absence sous le nom de la mission ne vaut pas arrêt : même si son ticket est ensuite annulé, ou accepté et fusionné, le couloir reste tenu et signalé, et rien d’autre ne part, jusqu’à ce que le terminal de ce lancement apparaisse (il est alors arrêté et constaté arrêté) ou que l’utilisateur relance ce ticket (un ticket annulé doit d’abord être rouvert dans le tracker : un lancement sur un ticket annulé est refusé ; pour un ticket annulé, la recommandation de l’élément d’Inbox le dit : rouvrir, relancer son dev, puis annuler de nouveau, la série reprenant une fois ce dev constaté arrêté). Un terminal vivant sous le nom du dev de la mission que le couloir ne connaît pas : rien n’est lancé ni arrêté, signalé une fois (stuck, cause lane). Une mission dont les devs ont été lancés par l’ancien mécanisme (fichier de chaîne sans couloir) n’est pas pilotée et son couloir n’est pas reconstruit : rendue avec refused DEV_LANE_OLD, sans un octet écrit dans sa chaîne, signalée une fois (stuck, cause lane-old), avec ce qu’il faut faire à la main ; aucune commande ne la débloque. Fichier de chaîne, tracker ou herdr-core illisible : rien n’est lancé ni libéré, rendu avec error.

Source : [src/dev-chain.mjs](../src/dev-chain.mjs), [src/dev-lane.mjs](../src/dev-lane.mjs).

Entrée : {}.

Sortie : {missions:Array<{mission:"M-<n>",ran?:boolean,refused?:"MISSION_FORMAT_OLD"|"DEV_LANE_OLD",skipped?:"busy",error?:string}>}.

Écritures : state/missions/M-<n>.json (étape, tickets, lead.lastSeen ; launch.state, settled et settledAt d’un lancement incertain une fois établi, décision 72) ; verrou state/devlane/M-<n>/operation.guard ; hc get, hc kill et, pour le ticket suivant, hc run (comme dev-launch) ; herdr-app do space.new/tab.new (relecteurs, QA)/tab.rename/tab.close/space.select/tab.select ; hc send (dev-send) ; ticket-merge ; po-step check (session PO seulement) ; osascript display notification ; state/requests/I-<n>.json (doute, terminal inattendu, ancien mécanisme) ; <root>/state/devchain-M-<n>.json (couloir compris). Aucun push, aucune mutation Tracker.

Confirmation : Aucune : suite du clic « Lancer les devs ».

Rejeu : Chaque action est réservée une fois par clé sous verrou ; rejouable sans doublon. Le couloir ne se libère que sur un arrêt constaté dans herdr-core : un hc kill en échec ou un terminal encore vivant à la relecture le laisse tenu, et l’arrêt est redemandé au passage suivant.

Codes spécifiques : `NOT_FOUND`, `INVALID_ARGUMENT` ; voir aussi les codes communs.

### `mission-create`

Enregistrer une mission durable M-n : la demande de the user sur un projet, et son issue s’il y en a une. Une issue n’a qu’une mission ouverte à la fois.

Source : [src/mission.mjs](../src/mission.mjs).

Entrée : {project:string (clé de la config),issueId?:string,request:string ≤8000,machine?:null}. Tout autre champ refusé ; une machine distante est refusée tant que la V1 impose machine:null. L’issue est relue dans Tracker et doit appartenir à la team du projet.

Sortie : {created:true,mission:Mission} ; ou, si l’issue a déjà une mission ouverte, {created:false,code:"MISSION_OPEN",message,mission:<la mission ouverte>}. Mission = {id,project,machine,issue:{id,identifier,title,url}|null,request,requestedAt,lead:{sessionId,lastSeen},worktree,branch,base,tickets:[{id,uid,n,title,level,dev,model,effort,deps,kind,delivery,integratedBy,state,tracker,worktree,branch,baseCommit,bases:[{repo,commit}],baseAt,rounds,waitingAnswer}],step,blocked,decisions,questions,log,adoptedFrom,createdAt,updatedAt}.

Écritures : state/ids.json (compteur, sous verrou), state/missions/M-<n>.json (écriture atomique, sous verrou).

Confirmation : Aucune : ne lance rien.

Rejeu : Rejouer sur une issue dont la mission est ouverte rend cette mission sans rien créer ; une mission validated ou closed libère l’issue. Une issue sur laquelle un PO de la première version travaille (worktree, non arrêté, pas encore close) rend la mission de ce PO, adoptée au besoin, pour que sa chaîne continue ; la demande y est enregistrée si elle était encore inconnue, jamais remplacée.

Codes spécifiques : `INVALID_ARGUMENT`, `NOT_FOUND`, `TEAM_NOT_CONFIGURED`, `ISSUE_NOT_IN_TEAM`, `MISSION_OPEN` ; voir aussi les codes communs.

### `mission-list`

Lister les missions durables, les actives d’abord puis les plus récentes.

Source : [src/mission.mjs](../src/mission.mjs).

Entrée : {project?:string,active?:boolean,journal?:boolean}. active:true écarte validated et closed ; journal:true ajoute on et journal (les dix dernières lignes de la chaîne) à chaque mission.

Sortie : {missions:Array<Mission|{id,step:"unknown",unreadable:true}>} : un fichier illisible reste dans la liste, signalé.

Écritures : Aucune : lecture.

Confirmation : Aucune : lecture.

Rejeu : Lecture pure, rejouable.

Codes spécifiques : `INVALID_ARGUMENT` ; voir aussi les codes communs.

### `lead-launch`

Lancer ou retrouver le Lead d’une mission (rôle roles/lead.md, à défaut roles/po.md), avec l’outil choisi comme pour le PO. Crée la mission si on lui donne un projet, une issue et une demande.

Source : [src/po-launch.mjs](../src/po-launch.mjs).

Entrée : {mission:"M-<n>"} ; ou {project:string,issueId:string,request:string ≤8000,stopAfter?:"develop"|"validate"} (stopAfter : la limite que the user a dite, transmise par Pilot ; refusée depuis toute session d’agent qui n’est pas Pilot, STOP_AFTER_RESERVED ; seulement avant le premier dev, sur l’étape réellement reprise, sinon MISSION_STARTED). Tout autre champ, ou le mélange des deux formes, est refusé.

Sortie : {mission:Mission,created:boolean,session:SessionLead,reused:boolean,warning?:string} ; SessionLead = SessionPO avec role:'lead' et missionId, sans step.

Écritures : state/missions/M-<n>.json (création si besoin, lead.sessionId écrit avant le lancement, requested → delegated après) ; state.json (intention écrite avant hc, puis terminal) ; hc run avec labels herdr.space=fabrique-console-<projet>-<issue>, fabrique-console.role, fabrique-console.session, fabrique-console.issue, fabrique-console.mission ; prompt = rôle + mission + commandes (lead-request, lead-answer, lead-escalate, mission-read) + la demande transmise par Pilot, présentée comme une donnée (ni une consigne ni un accord, jamais comme les mots de the user) et balisée <mission-request> (décision 62) + issue balisée <ticket-data-untrusted>, ≤65536 octets.

Confirmation : Aucune : c’est Pilot ou le veilleur qui l’appelle pour une mission enregistrée.

Rejeu : Terminal possédé vivant => reused:true sans nouveau lancement ; terminal disparu => même session relancée avec son dossier ; lancement non confirmé => LAUNCH_UNCERTAIN jusqu’à ce que le terminal soit retrouvé par son label. Une issue dont la mission est ouverte retrouve cette mission ; une issue sur laquelle un PO de la première version travaille adopte ce PO et sa chaîne, sans second Lead. Un Lead arrêté exprès est remplacé par une nouvelle session qui reprend le worktree, la branche et la base de son prédécesseur ou, à défaut, de la mission.

Codes spécifiques : `INVALID_ARGUMENT`, `NOT_FOUND`, `TEAM_NOT_CONFIGURED`, `ISSUE_NOT_IN_TEAM`, `MISSION_NO_ISSUE`, `PO_FOLDER_UNAVAILABLE`, `PO_PROMPT_TOO_LARGE`, `PO_PROMPT_UNDELIVERED`, `TERMINAL_OWNERSHIP`, `LAUNCH_UNCERTAIN`, `BUSY`, `MISSION_OVER`, `MISSION_PAST_DEVELOP`, `STOP_AFTER_RESERVED`, `MISSION_STARTED` ; voir aussi les codes communs.

### `lead-request`

Demander au veilleur le lancement de tickets ou présenter la validation finale d’une mission.

Source : [src/questions.mjs](../src/questions.mjs), [src/requests.mjs](../src/requests.mjs).

Entrée : {mission:"M-<n>",kind:"launch"|"resume"|"qa"|"fix"|"validation",tickets?:Array<{identifier,tool,model,effort}>,text?:string ≤4000}. launch et resume exigent tickets ; validation exige text (le bilan). resume relance l’agent d’un ticket dont le terminal est arrêté, dans son worktree, avec la réponse qui l’attend jointe à sa consigne ; jamais tant que son dev vit dans herdr-core (already) ni à côté d’un autre (serial). Une réponse qui porte une réponse de the user n’est jointe que si les demandes l’ont enregistrée telle quelle (requests.answer), pour cette question et la version de sa demande ; sinon rien n’est joint, l’agent est relancé sans elle et la question est dite incertaine.

Sortie : launch, fix et resume : la sortie de dev-launch, avec pour chaque ticket non lancé sa raison (waits, serial, rank, already, over, canceled, blocked, plan-differs, not-developed, unverified, not-in-copy, copy-changed). qa : {launched:false,automatic:true,message} (le veilleur lance le QA seul). validation : {item:Demande,created:boolean} (un bilan aux mots différents est une autre demande, comme pour lead-escalate).

Écritures : launch et fix : comme dev-launch. resume : comme dev-launch ; une réponse jointe à rien est marquée unsure dans state/questions/Q-<n>.json, et son ticket est signalé une fois dans l’Inbox (state/requests/I-<n>.json, type stuck, cause uncertain). validation : state/requests/I-<n>.json, state/questions/Q-<n>.json, étape validating de la mission, notification macOS à la création. En pause (M11), la validation est refusée elle aussi (MISSION_PAUSED), avant toute écriture.

Confirmation : Aucune : c’est le Lead qui demande.

Rejeu : launch : un seul dev vivant par mission, sous le verrou de son couloir (voir dev-launch). validation : une demande en attente par mission ; le même bilan ne change rien, un bilan différent crée une autre demande qui remplace la première restée sans réponse (comme lead-escalate).

Codes spécifiques : `INVALID_ARGUMENT`, `NOT_FOUND`, `MISSION_FORMAT_OLD`, `SESSION_STOPPED`, `NO_SPACE`, `DEV_LANE_OLD`, `DEV_LANE_BUSY`, `TRACKER_UNAVAILABLE`, `HC_UNAVAILABLE`, `INVALID_DATA`, `NOT_APPROVED`, `ENVIRONMENT_NOT_READY`, `MISSION_PAUSED`, `MISSION_STOPS_AFTER_DEVELOP` ; voir aussi les codes communs.

### `lead-answer`

Répondre à la question Q-n d’un agent ; le veilleur dit à celui qui l’a posée que la réponse est dans state/questions/Q-<n>.json (champ answer.text), sans la recopier dans le message (décision 61).

Source : [src/questions.mjs](../src/questions.mjs).

Entrée : {question:"Q-<n>",text:string ≤4000}. Tout autre champ refusé.

Sortie : {question:Question} ; Question = {id,mission,ticket|null,from:"dev"|"review-1"|"review-2"|"qa"|"lead",fromTab,question,options,askedAt,state:"open"|"answered"|"escalated"|"delivered"|"resolved",answer:{text,by:"lead"|"legacyOwner",decision,choice?,title?,at}|null,legacyOwner?:(la réponse de the user, gardée de côté pendant que le Lead la transmet),delivery:{at,terminal,attempts}|null,source,routedAt}.

Écritures : state/questions/Q-<n>.json (écriture atomique, sous verrou).

Confirmation : Aucune : c’est le Lead qui répond.

Rejeu : La même réponse du Lead ne change rien ; une autre réponse, ou une question qui n’attend plus le Lead (déjà répondue, ou retenue pour une demande faite à the user), est refusée.

Codes spécifiques : `INVALID_ARGUMENT`, `NOT_FOUND`, `QUESTION_CLOSED` ; voir aussi les codes communs.

### `lead-escalate`

Remonter dans l’Inbox ce que le Lead ne peut pas décider. Une demande ne change jamais : elle est écrite une fois, avec les réponses qu’elle offre, la question d’où elle vient et celle où va sa réponse.

Source : [src/questions.mjs](../src/questions.mjs), [src/requests.mjs](../src/requests.mjs).

Entrée : {mission:"M-<n>",question?:"Q-<n>",ticket?,type:"decision"|"authorization",kind?:"suggestion"|"verdict"|"copy",title:string ≤200,short?:string ≤120,summary?:string ≤200,text,recommendation,why:string ≤4000,options?:Array<string ≤200> ≤4,details?:{<réponse offerte>:string ≤4000},tickets?:Array<ticket> 1..20,consequences?,blocked?:Array<ticket> ≤20,proofs?:Array<string> ≤20}. Une autorisation doit offrir au moins une réponse à cliquer (options, à défaut celles de la question, à défaut une recommandation courte), sinon elle est refusée. Sans question, la demande attend dans une question du Lead. Ce que la page d’un développement affiche (ticket M4, simulation/CONTRAT.md § 3 et 3 bis) : kind, seulement sur une decision (une question n’en dit pas) : suggestion (une proposition du Lead, deux boutons), verdict (une revue laisse le verdict à the user), copy (un choix de texte : chaque réponse est le texte d’une variante, A, B, C dans l’ordre) ; pour ces trois, options est obligatoire et recommendation et why deviennent facultatifs ; short : la demande en quelques mots (lignes « Waiting on you » et « Your decisions ») ; details : le texte écrit sous chaque réponse, pour des réponses offertes seulement (refus qui nomme la réponse inconnue) ; tickets : les tickets concernés quand il y en a plusieurs (« Tickets concerned »). Ce sont des mots de la demande : les changer donne une autre demande.

Sortie : {item:Demande,created:boolean,question:"Q-<n>",replaced?:"I-<n>"} (replaced : la demande sans réponse dont celle-ci prend la place) ; Demande = {id:"I-<n>",type,mission,project,issue,ticket|null,cause?,since?:ISO (blocage, type stuck : l’instant de l’arrêt, gardé par la demande réécrite pour le même arrêt ; M10),owner?:"lead",forUser?:boolean,migration?:string ≤40,tries?:Array<{text:string ≤300,at?:ISO,outcome?:"same"|"running",last?:true}> ≤10 (ce qui est tenté, dans l’ordre ; M10, simulation/CONTRAT.md § 3 ter),question:"Q-<n>"|null,source:{id,question,options}|null (question d’agent d’où elle vient, copiée),recipient:{question,from,fromTab,ticket,mission}|null (à qui va la réponse, copié),kind?,title,short?,summary|null,text,recommendation,options,why,details?,tickets?,consequences,blocked,proofs,answers:Array<string> (réponses offertes, calculées une fois),replaces?:"I-<n>",to:"legacyOwner",priority:1|2|3,createdAt,version:string (empreinte SHA-256 de tout ce qui précède, identifiant et replaces compris), puis ce qui est tenu à côté : state:"pending"|"opening"|"answered"|"delivered"|"resolved"|"error",error,discussedAt?,answer:{id:"D-<n>"|null,choice|null,text|null,seen,published|null,via:"screen"|"agent",at,left?:true}|null,updatedAt}.

Écritures : state/requests/I-<n>.json (une écriture), state/ids.json, state/questions/Q-<n>.json : la question citée est retenue (open → escalated) sous le verrou des demandes, avant l’écriture de la demande, ou une question du Lead est créée ; notification macOS pour une demande nouvelle, pas pour celle qui remplace une demande encore sans réponse.

Confirmation : Aucune : c’est le Lead qui escalade.

Rejeu : Une demande attend pour une question d’agent citée ; sans question, pour mission + ticket + type (+ cause). Deux questions distinctes donnent deux demandes ouvertes en même temps, aucune ne remplace l’autre. Mêmes mots pour la même clé : rien (created:false). Autres mots ou autres réponses : autre demande (created:true), qui nomme celle qu’elle remplace (replaces) ; rien n’est écrit dans l’ancienne, qui garde ses mots et ne reçoit plus de réponse. Une demande déjà répondue ne se remplace pas : la nouvelle attend à part, dans une question du Lead. Une question à laquelle le Lead a déjà répondu, ou qui porte déjà une réponse de the user, n’est pas reprise : question du Lead. Tant que la demande existe, lead-answer sur sa question répond QUESTION_CLOSED.

Codes spécifiques : `INVALID_ARGUMENT`, `NOT_FOUND` ; voir aussi les codes communs.

### `lead-block`

Le Lead tient un ticket arrêté (M10) : ce qu’il essaie, dans l’ordre, et si the user est attendu ; ou il lève l’arrêt. L’arrêt est ouvert par le veilleur quand le dev le signale (fabrique-console-report block) ; le Lead en est prévenu une fois.

Source : [src/questions.mjs](../src/questions.mjs), [src/requests.mjs](../src/requests.mjs).

Entrée : {mission:"M-<n>",ticket,tries?:Array<{text:string ≤300,at?:ISO,outcome?:"same"|"running",last?:true}> ≤10,forUser?:boolean,lifted?:true}. tries : la liste entière des essais, dans l’ordre (same : même échec ; running : en cours ; last : dernier essai avant de demander à the user). forUser : true quand le dernier essai a échoué et que le Lead remonte à the user (lead-escalate). lifted : l’arrêt est levé.

Sortie : {item:Demande,created:boolean,replaced?:"I-<n>"} (l’arrêt réécrit avec ses essais : mêmes mots, même instant since ; voir lead-escalate pour Demande), ou {lifted:true,item:"I-<n>"}.

Écritures : state/requests/I-<n>.json : l’arrêt réécrit (une autre demande qui remplace la précédente, sans notification, son instant gardé) ou marqué resolved ; state/ids.json.

Confirmation : Aucune : c’est le Lead qui suit l’arrêt. Barrière (même que les décisions 70 et 76) : l’outil donne au Lead qu’il lance une marque de rôle (variable FABRIQUE_CONSOLE_ROLE=lead, à côté de FABRIQUE_CONSOLE_AGENT, par la même option de son programme) ; une demande venue d’une autre session d’agent lancée par l’outil (dev, relecteur, QA, Pilot, assistant) est refusée (LEAD_ONLY) avant toute lecture ou écriture. the user à la main ne porte aucune marque et n’est pas refusé. Limite, telle qu’elle est (décision 76) : la marque arrête les erreurs, pas un agent qui cherche à passer. Elle n’est que l’environnement du processus qui lance la commande : `env -u FABRIQUE_CONSOLE_AGENT node …/cli.mjs …` la retire, `FABRIQUE_CONSOLE_ROLE=lead` se pose en une ligne, et un agent peut écrire directement le fichier des demandes sous le même compte. Un Lead lancé avant cette marque ne la porte pas : relancé, il la porte.

Rejeu : Les mêmes essais : rien (created:false). Aucun arrêt ouvert pour ce ticket : NOT_FOUND. Les essais sont écrits sur l’arrêt lu, sous le verrou du registre : remplacé ou levé depuis sa lecture (une autre commande, le veilleur), ils sont refusés (STOP_CHANGED) et rien n’est écrit ; lifted lève l’arrêt ouvert au moment même et dit lequel.

Codes spécifiques : `INVALID_ARGUMENT`, `LEAD_ONLY`, `NOT_FOUND`, `STOP_CHANGED` ; voir aussi les codes communs.

### `pilot-decide`

Enregistrer ce que the user a décidé devant un agent (Pilot, ou le Lead quand the user ouvre une demande avec lui) sur une demande qui n’est pas une autorisation ; le veilleur livre la réponse à qui l’attend, sauf à une question dite incertaine (unsure), qui n’est plus livrée par le veilleur.

Source : [src/questions.mjs](../src/questions.mjs), [src/requests.mjs](../src/requests.mjs).

Entrée : {item:"I-<n>",choice?:string ≤200,text:string ≤4000,seen:string (version de la demande lue à the user : le seen rendu par inbox-list ou le dossier de lancement ; obligatoire)}. Tout autre champ refusé. Refusé pour une demande de type authorization (CLICK_REQUIRED) : une autorisation se donne par un clic à l’écran (inbox-answer), jamais par un agent.

Sortie : {decision:{id,item,mission,question|null,choice|null,text,seen,by:"legacyOwner",via:"agent",at},item:Demande,created:boolean} (seen : la version sur laquelle la réponse a été donnée).

Écritures : Une seule écriture enregistre la réponse : state/requests/I-<n>.json (answer, et state answered quel qu’ait été son état, une erreur déjà dite y restant), sous le verrou des demandes ; state/ids.json. Puis, chacun sous sa condition et rejouable : state/decisions/D-<n>.json s’il n’existe pas ; state/questions/Q-<n>.json (answered par legacyOwner) seulement si la question inscrite dans la demande attend encore, sans réponse, et est toujours celle copiée.

Confirmation : Aucune : l’agent l’appelle quand the user a répondu. Limite connue : le moteur lie une réponse à la version déclarée lue ; il ne prouve pas que the user a parlé.

Rejeu : Sur une demande déjà répondue, rend la première réponse (created:false) et n’écrit rien. Sans seen : SEEN_REQUIRED. Tout est comparé sous le verrou, avant l’unique écriture : version qui n’est pas l’empreinte de cette demande, ou demande remplacée par une autre (replaces) : REQUEST_CHANGED ; demande fermée ou confiée au Lead : QUESTION_CLOSED ; rien n’est enregistré. Un arrêt après l’écriture est repris par le veilleur (décision, question), sans rien réécrire, y compris pour une demande qui était dite en erreur.

Codes spécifiques : `CLICK_REQUIRED`, `INVALID_ARGUMENT`, `NOT_FOUND`, `QUESTION_CLOSED`, `REQUEST_CHANGED`, `SEEN_REQUIRED` ; voir aussi les codes communs.

### `inbox-list`

Lister ce qui attend the user : les éléments non résolus, y compris en erreur.

Source : [src/questions.mjs](../src/questions.mjs), [src/requests.mjs](../src/requests.mjs).

Entrée : {} ; tout champ refusé.

Sortie : {items:Array<Demande & {seen:string,decision:"D-<n>"|null,answered:string|null}>} (answers : les réponses proposées en un clic, copiées à la création ; seen : la version de la demande, à renvoyer telle quelle avec la réponse, qui est refusée sans elle ; decision et answered : la réponse donnée sur cette demande elle-même, jamais celle d’une autre), par priorité (ce qui bloque des agents, puis le reste, puis les validations) puis ancienneté. Viennent ensuite, pour les développements encore en cours, les demandes d’avant la bascule, lues dans l’archive de la bascule (archive/legacy-<date>/state/inbox, jamais écrite) : {…,legacy:true,authorizes:false,answers:[],seen:null}, avec state:"answered", decision et answered quand leur réponse est certaine, sinon state:"error" et error (« incertaine »). En consultation seulement : ancien, sans valeur d’autorisation. Aucune ne peut être répondue, et rien n’en est livré ni relayé, même certaine ; un agent qui les lit (Pilot, le Lead) n’en tire aucun accord et redemande ce qui compte encore par une nouvelle demande. Avant toute lecture, la bascule est faite si elle ne l’est pas (voir « Bascule ») ; si elle échoue : LEGACY_ARCHIVE_FAILED.

Écritures : Aucune : lecture.

Confirmation : Aucune : lecture.

Rejeu : Lecture pure, rejouable.

Codes spécifiques : `INVALID_ARGUMENT`, `LEGACY_ARCHIVE_FAILED` ; voir aussi les codes communs.

### `inbox-open`

Ouvrir une demande de l’Inbox avec Pilot : une session neuve qui reçoit tout le dossier du Lead (demande, recommandation, justification, conséquences, tickets bloqués, preuves, question d’origine, mission, décisions passées).

Source : [src/pilot.mjs](../src/pilot.mjs), [src/requests.mjs](../src/requests.mjs).

Entrée : {item:"I-<n>"} ; tout autre champ refusé.

Sortie : {reused:boolean,item:"I-<n>",terminal:"t…"}. reused : la même demande était déjà ouverte avec un Pilot vivant, retrouvé tel quel.

Écritures : state/pilot.json {context,item,mission,terminal,at}, state/requests/I-<n>.json (pending → opening). Arrête le terminal Pilot précédent (hc kill) puis lance le nouveau (hc run, nom fabrique-console-agent-claude). Pour une autorisation, la consigne de Pilot ne contient aucune commande d’enregistrement : il présente, recommande, et envoie the user cliquer.

Confirmation : Aucune : le clic sur l’élément vaut demande. Un Pilot au travail n’est jamais arrêté (PILOT_BUSY).

Rejeu : Sous verrou : deux appels sur la même demande lancent une seule session. Réponse de hc perdue : LAUNCH_UNCERTAIN, l’élément reste pending ; un nouvel appel remplace le Pilot éventuellement lancé, jamais deux Pilot.

Codes spécifiques : `BUSY`, `INVALID_ARGUMENT`, `LAUNCH_UNCERTAIN`, `NOT_FOUND`, `PILOT_BUSY`, `PO_FOLDER_UNAVAILABLE`, `PO_PROMPT_TOO_LARGE`, `QUESTION_CLOSED`, `SEND_FAILED`, `STOP_FAILED` ; voir aussi les codes communs.

### `pilot-launch`

Ouvrir Pilot sur un développement ou sur une issue : une session neuve qui reçoit tout ce qu’il faut pour en parler.

Source : [src/pilot.mjs](../src/pilot.mjs).

Entrée : {context:"mission",mission:"M-<n>"} ou {context:"issue",project,issueId} ; une issue qui a un développement ouvre ce développement. Les autres contextes sont refusés pour l’instant.

Sortie : {reused:boolean,terminal:"t…",mission:"M-<n>"} ou {reused:boolean,terminal:"t…",issue:<id>}.

Écritures : state/pilot.json ; arrête le terminal Pilot précédent puis lance le nouveau, comme inbox-open.

Confirmation : Aucune : le clic vaut demande. Un Pilot au travail n’est jamais arrêté (PILOT_BUSY).

Rejeu : Sous verrou. Un Pilot déjà sur cette mission est retrouvé par ses labels et jamais relancé, sauf si sa conversation a été effacée.

Codes spécifiques : `INVALID_ARGUMENT`, `NOT_FOUND`, `PILOT_BUSY`, `PO_PROMPT_TOO_LARGE`, `PO_FOLDER_UNAVAILABLE`, `STOP_FAILED`, `LAUNCH_UNCERTAIN`, `BUSY` ; voir aussi les codes communs.

### `pilot-command`

Compacter ou effacer la conversation de Pilot, depuis les boutons de son en-tête.

Source : [src/pilot.mjs](../src/pilot.mjs).

Entrée : {command:"compact"|"clear"}.

Sortie : {sent:"compact"|"clear",terminal:"t…"}.

Écritures : Tape /compact (avec ce qu’il faut garder selon le sujet de Pilot, identifiants seulement) ou /clear dans son terminal. clear : state/pilot.json {cleared:true}.

Confirmation : Aucune : le clic vaut demande. Jamais pendant que Pilot travaille (PILOT_BUSY).

Rejeu : Chaque appel renvoie la commande.

Codes spécifiques : `INVALID_ARGUMENT`, `NOT_FOUND`, `PILOT_BUSY`, `SEND_FAILED`, `BUSY` ; voir aussi les codes communs.

### `mission-delivery`

Dire où est le code d’un développement (dépôts qui ont des commits propres, branche, poussée ou non, pull request) et ce qu’il faut lancer pour le tester : serveur du plan, app Flutter, ou les deux.

Source : [src/validation-desk.mjs](../src/validation-desk.mjs).

Entrée : {mission:"M-<n>"}.

Sortie : {repositories:Array<{repo,branch,ahead,pushed,known,pr:{number,url,state,draft}|null}>,server:{dir,argv,url}|null,app:{folder}|null,flutter:boolean}. server est null quand le dossier du plan n’a pas été touché ; app désigne le dépôt Flutter (pubspec avec sdk flutter et lib/main.dart) qui a des commits propres. known:false : GitHub illisible, à ne pas lire comme « pas de PR ».

Écritures : Aucune : lectures git, gh et Tracker.

Confirmation : Aucune : lecture.

Rejeu : Lecture rejouable.

Codes spécifiques : `INVALID_ARGUMENT`, `NOT_FOUND` ; voir aussi les codes communs.

### `mission-server`

Voir, lancer ou couper ce qui sert à tester un développement : le serveur (par défaut) ou l’app Flutter (target:"app").

Source : [src/validation-desk.mjs](../src/validation-desk.mjs).

Entrée : {mission:"M-<n>",command:"status"|"start"|"stop",target?:"server"|"app",ticket?:string (app seulement : celle de ce ticket, depuis son worktree)}.

Sortie : {running:boolean,terminal:"t…"|null,url:string|null,reason:string|null,lastOutput:string|null} ; pour l’app en marche, aussi device (UDID de l’iPhone), space et tab (où son terminal est montré).

Écritures : Lance (hc run, labels fabrique-console.server et fabrique-console.port, PORT = premier port libre à partir de celui du plan) ou arrête (hc kill) le terminal du serveur. La commande vient du plan : seul un script du package d’un dossier du worktree, sans shell. App : démarre au besoin un iPhone du simulateur (xcrun simctl), puis flutter run sur cet iPhone dans le dossier du dépôt, avec le Flutter que le projet fixe par mise, avec seulement les --dart-define de sa configuration .vscode/launch.json ; un fichier de defines absent du worktree est désigné dans la copie principale, jamais lu ni copié (label fabrique-console.apptest). Une seule app sur le simulateur : en lancer une autre arrête celle qui tourne. Celle d’un ticket est trouvée dans son propre worktree, fusionnée ou non. Sans ligne Serveur dans le plan : le script ./dev.sh exécutable à la racine du worktree, son adresse lue dans sa sortie (le dernier localhost qu’elle nomme). Chaque serveur de test reçoit CLOUDSDK_CONFIG vers un dossier Google vide (state/gcloud-empty) : les identifiants de the user restent en place et invisibles. Un paquet avec un script emulators et sa configuration Firebase : les émulateurs sont lancés une fois par projet (terminal labellisé fabrique-console.emulators), le serveur attend leur hub.

Confirmation : Aucune : le clic vaut demande.

Rejeu : Sous verrou : deux lancements donnent un seul serveur ; un arrêt sans serveur ne fait rien.

Codes spécifiques : `BUSY`, `EMULATORS_BUSY`, `HC_UNAVAILABLE`, `INVALID_ARGUMENT`, `LAUNCH_UNCERTAIN`, `NOT_FOUND`, `SERVER_NOT_CONFIGURED`, `STOP_FAILED` ; voir aussi les codes communs.

### `mission-tldr`

Tenir à jour le TL;DR d’un développement et de ses tickets, écrit par son Lead et affiché à the user.

Source : [src/mission.mjs](../src/mission.mjs).

Entrée : {mission:"M-<n>",text?:string (500 max),tickets?:{<ticket>:string (300 max)}} ; au moins l’un des deux.

Sortie : {mission:"M-<n>",tldr:string|null,tldrs:{<ticket>:string}}.

Écritures : state/missions/M-<n>.json (tldr, tldrs).

Confirmation : Aucune.

Rejeu : Rejouable : ce qui n’est pas donné est conservé.

Codes spécifiques : `INVALID_ARGUMENT`, `NOT_FOUND` ; voir aussi les codes communs.

### `mission-launch`

« Approve and start the dev » (ticket M5) : approuver le plan que l’écran a dessiné, en enregistrant une seule fois sa copie figée, puis demander au Lead de lancer ses devs (un message dans son terminal ; c’est lui qui écrit l’approbation en commentaire dans l’issue du tracker, « Plan approuvé par the user le… » à l’heure de la copie (décision 58, point 2), crée les sous-issues manquantes et demande les lancements au veilleur). Aucun dev ne part sans cette copie (NOT_APPROVED de dev-launch et lead-request).

Source : [src/mission.mjs](../src/mission.mjs), [src/agent-texts.mjs](../src/agent-texts.mjs).

Entrée : {mission:"M-<n>",seen:entier ≥ 1 (la révision du plan que l’écran a dessinée, mission.plan.revision ; obligatoire),stopAfter?:"develop"|"validate" (chantier 1, point 16 : où la mission s’arrête ; absent, elle garde la sienne)}. Tout autre champ refusé.

Sortie : {mission:"M-<n>",approved:true,launch:"asked",asked:true}.

Écritures : state/missions/M-<n>.json : approval (la copie figée, écrite une seule fois et jamais réécrite tant que le plan ne change pas : {at,revision,tickets,simple?,branch,openQuestions:0,manual?:{summary,count},coverage:[{id,state,tickets}],plan,by:"legacyOwner",via:"screen"} ; branch : celle de la mission, sinon l’identifiant de l’issue en minuscules, la branche que prend son worktree), puis launch ({state:"asking"|"asked"|"failed"|"unknown",at,saidAt?,again?}) et launchAskedAt une fois le message envoyé ; message dans le terminal du Lead (hc send, par src/herdr.mjs). Les appels sont l’un après l’autre (verrou state/approvals). Le contrôle des questions ouvertes et l’écriture de la copie se font d’un seul tenant, sous le verrou des demandes (state/requests) : aucune demande ne peut être créée entre les deux. Plan réécrit par le Lead après sa copie, avant qu’aucun dev soit parti (M7) : le clic sur la révision dessinée l’approuve de nouveau, comme une première approbation (questions ouvertes comprises) ; la nouvelle copie porte kind:"reapproval" et garde l’ancienne entière sous previous (jamais réécrite), une ligne « Updated plan approved by you. » au journal de la mission (décision 87) ; jamais pendant un lancement incertain (LAUNCH_UNSURE). La copie note aussi outside : les sous-tickets du tracker déjà là avant l’approbation, quel que soit leur état, que le plan ne nomme pas (ceux que lead-plan a lus avec le plan, trackerSeen, et ceux que la chaîne connaît) : ni approuvés ni écart, pour de bon (décision 82).

Confirmation : Le clic de the user sur « Approve and start the dev » vaut approbation (décision 55 appliquée au plan) : cette commande n’est donnée à aucun agent comme commande à lancer ; le Lead ne peut que lead-request, refusé tant qu’il n’y a pas de copie. Refusée avant toute écriture : pas de Lead vivant (NOT_FOUND), mission finie (MISSION_OVER) ou déjà lancée (MISSION_STARTED), pas de plan (PLAN_MISSING), plan réécrit depuis le dessin (PLAN_REVISED : seulement si la révision cliquée n’est plus celle du plan ; un plan réécrit après la copie et dessiné est approuvé de nouveau, M7), question ouverte (QUESTIONS_OPEN), Lead encore au travail ou retenu dans son terminal d’après Herdr (LEAD_WORKING, décision 49 ; même règle que la page, LEAD_BUSY : working ou blocked, lue sous le verrou de la copie), environnement déclaré par le projet et pas vert au moment du clic (ENVIRONMENT_NOT_READY, décision 111 : la vue relue sous le verrou des approbations, sans relancer le contrôle ; un projet sans environnement déclaré reste lançable). Ces contrôles sont refaits à chaque clic, copie déjà écrite comprise (M5, revue 2) : un nouveau clic sur une mission lancée ou finie, ou dont le plan a été réécrit après sa copie (PLAN_REVISED : la réapprobation vient avec M7), est refusé et n’envoie rien ; les questions ouvertes ne sont contrôlées qu’avec la copie. Barrière (décision 70) : les agents lancés par l’outil (Lead, devs, relecteurs, QA, Pilot, assistant) ont l’interdiction écrite de l’utiliser, et portent une marque posée par l’outil à leur démarrage (variable FABRIQUE_CONSOLE_AGENT, donnée par une option de leur programme : --settings pour Claude, shell_environment_policy pour Codex) ; une demande qui la porte est refusée (AGENT_SESSION) avant toute lecture ou écriture. Limite, telle qu’elle est (décision 76) : la marque arrête les erreurs, pas un agent qui cherche à passer. Elle n’est que l’environnement du processus qui lance la commande : `env -u FABRIQUE_CONSOLE_AGENT node …/cli.mjs …` la retire en une ligne ; un agent peut aussi écrire directement le fichier de la mission (`state/missions/M-<n>.json`, son `approval`) ou celui des demandes, sous le même compte ; et les devs tournent en `bypassPermissions` (Claude) ou `danger-full-access` (Codex), sans rien qui les retienne. Rien d’autre ne protège l’approbation et les réponses par clic jusqu’à M16 : la vraie preuve d’origine écran (canal réservé à la page) vient avant M16, avec les décisions 66 et 67 (décision 70).

Rejeu : La copie n’est jamais réécrite : un second appel la rend telle quelle. Le message de lancement part au plus une fois par clic : déjà envoyé, l’appel répond asked sans rien envoyer, sauf si, deux minutes après l’envoi (ASK_AGAIN_MS, la durée de la page), aucun dev n’a été demandé (chaîne éteinte) et le Lead ne travaille pas : le clic redemande alors le lancement au Lead, une fois (launch.again compte les relances, une ligne « New launch request recorded for the Lead. » au journal de la mission, décision 87) ; deux messages ne font jamais deux devs, le couloir de la mission refusant un second dev (M7). Un échec que le Lead rencontre pendant l’envoi n’est pas recouvert par asked (la réponse dit alors launch:"failed") ; parti sans certitude (Herdr muet, réponse perdue, arrêt au milieu : asking ou unknown), LAUNCH_UNSURE, jamais renvoyé ; connu non parti (SEND_FAILED), un nouveau clic le redemande. Un lancement incertain est établi par le veilleur (dev-chain-tick-all, launchSettled) : asked (settled:"started") ou failed (settled:"not-started"), une seule fois, dit dans le journal de la mission selon ce qui le prouve (décision 87) : « Launch checked: the ticket sequence is enabled. » (chaîne en marche), « Launch checked: the mission is in <étape>. » (mission sortie de Prepare), « Launch checked: no dev start was recorded. You can request the launch again. »

Codes spécifiques : `AGENT_SESSION`, `INVALID_ARGUMENT`, `NOT_FOUND`, `SEEN_REQUIRED`, `MISSION_OVER`, `MISSION_STARTED`, `PLAN_MISSING`, `PLAN_REVISED`, `QUESTIONS_OPEN`, `LEAD_WORKING`, `ENVIRONMENT_NOT_READY`, `SEND_FAILED`, `LAUNCH_UNSURE`, `LAUNCH_BUSY`, `MISSION_PAST_DEVELOP` ; voir aussi les codes communs.

### `mission-reapprove`

« Approve these changes » (ticket M7, décisions 77, 80, 81 et 82 ; bouton en bas de la fiche « Drift from approved plan », texte provisoire) : approuver l’écart que l’écran a dessiné, et seulement lui, une fois les devs partis. Le bouton ouvre d’abord la même boîte de confirmation que « Approve and start the dev », qui montre ce qui sera approuvé (outil, modèle, effort et niveau de chaque ticket, ce que devient chaque partie du plan) ; seule sa confirmation envoie la commande. La copie figée devient le plan d’aujourd’hui ; les tickets ajoutés ou modifiés partent ensuite comme les autres, avec les paramètres approuvés et aucun autre, une correction ajoutée en Validation comprise.

Source : [src/mission.mjs](../src/mission.mjs).

Entrée : {mission:"M-<n>",seen:chaîne de 16 caractères hexadécimaux (la version de l’écart dessinée, driftSeen de mission-read ; obligatoire)}. Tout autre champ refusé.

Sortie : {mission:"M-<n>",approved:true,reapproved:Array<string> (les tickets et les parties du plan de l’écart approuvé)}.

Écritures : state/missions/M-<n>.json : approval remplacée par la nouvelle copie ({at,revision,tickets,simple?,branch,openQuestions:0,manual?,coverage,plan,outside?,extra?:Array<{id,ticket:{title,level,dev,model,effort,deps}}>,kind:"reapproval",approves:Array<{ticket?,part?,kind,fields?}>,previous:Array<copie d’avant, entière>,by:"legacyOwner",via:"screen"}) ; extra : les sous-tickets du tracker que l’écart dessinait ajoutés ou changés, approuvés tels que la chaîne les enregistre, et ceux déjà approuvés avant ; dev-launch ne peut pas leur donner un autre outil, modèle ou effort (NOT_AS_APPROVED) ; outside ne fait que grandir : les tickets que l’écart dessinait retirés du plan y entrent, même encore ouverts dans le tracker, et n’en partent jamais (un retrait approuvé ne rend jamais un ticket lançable) ; previous : les copies d’avant, jamais réécrites ; driftAt remis à vide ; une ligne « Changes approved by you: <tickets et parties, par leur nom à l’écran>. » au journal de la mission (décision 87). Sous le verrou state/approvals, puis celui des demandes et de la mission. Un ticket modifié ou retiré pendant que son dev tourne : la réapprobation ne touche pas au dev en cours, qui continue avec la consigne reçue à son lancement ; le changement vaut pour ce qui part ensuite (une reprise, une correction, le ticket suivant). Retiré, le ticket n’est plus relancé ; son dev en cours n’est jamais relu ni fusionné, même s’il rend son rapport : il est arrêté à la fin de son tour (son terminal ne travaille plus), son travail reste sur sa branche et dans son dossier, et la livraison (fin de Develop, Validation, QA) attend son arrêt (décision 85).

Confirmation : Le clic de the user sur « Approve these changes » de la boîte de confirmation vaut approbation (décisions 55, 77 et 81) : commande des écrans seulement, refusée depuis une session d’agent lancée par l’outil (AGENT_SESSION, même barrière que mission-launch, décisions 70 et 76, avec la même limite). Refusée avant toute écriture : mission finie (MISSION_OVER), jamais approuvée (NOT_APPROVED), devs pas encore partis (MISSION_NOT_STARTED), pas de plan (PLAN_MISSING), aucun écart (NO_DRIFT), écart ou plan changé depuis le dessin (DRIFT_CHANGED), une question ou une demande encore ouverte (QUESTIONS_OPEN, le même refus que la première approbation, décision 82), le Lead au travail ou retenu dans son terminal (LEAD_WORKING, comme mission-launch ; Herdr injoignable n’approuve rien).

Rejeu : Un second clic sur le même dessin trouve l’écart vide (NO_DRIFT) et n’écrit rien. Rien n’est envoyé au Lead : le veilleur et le Lead lancent ensuite les tickets couverts, chacun une fois (couloir de la mission).

Codes spécifiques : `AGENT_SESSION`, `INVALID_ARGUMENT`, `NOT_FOUND`, `SEEN_REQUIRED`, `MISSION_OVER`, `NOT_APPROVED`, `MISSION_NOT_STARTED`, `PLAN_MISSING`, `NO_DRIFT`, `DRIFT_CHANGED`, `LAUNCH_BUSY`, `QUESTIONS_OPEN`, `LEAD_WORKING` ; voir aussi les codes communs.

### `mission-pause`

« Pause » sur le bandeau bleu de Develop (ticket M11, décisions 32 et 43 ; simulation/CONTRAT.md § 2 quater) : la pause de la mission. L’agent au travail finit son tour ; ensuite rien ne démarre (ni dev, ni relecteur, ni correction envoyée, ni rapport redemandé, ni agent QA, ni passage en Validation, ni note au Lead) ; une fusion de ticket accepté et l’arrêt d’un dev dont le ticket est fini continuent. La pause passe de requested à paused au premier passage du veilleur où plus rien ne peut tourner : le dev du couloir et chaque onglet de relecteur ou de QA de l’issue au bout de leur tour (idle, done, blocked) ou disparus, et aucun lancement au sort inconnu ; un état inconnu, un dev demandé et jamais vu, un terminal étranger, un relecteur ou un agent QA demandé à la fenêtre et jamais vu (asking, lost, terminal non observé) la laissent demandée, avec sa cause (waiting), et une alerte (alert) si une cause qui n’est pas un agent vu au travail dure 5 minutes ; jamais rendue effective sur un délai. Barrière (revue 1 de M11) : la pause s’écrit sous le verrou du couloir de la mission, celui sous lequel tout démarrage est fait (dev, relecteur, QA, corrections, réponses portées) ; confirmée, rien ne démarre après elle. Pendant la pause rien ne réveille un agent : les questions des agents sont gardées, les réponses de the user et les messages de la conversation (réponses, relais, arrêt signalé au Lead) attendent « Resume », et aucun Lead n’est recréé ; un arrêt signalé par un dev est tout de même affiché dans l’Inbox. Un dev coupé pendant la pause la rend effective, et rien n’est relancé avant « Resume ». Offerte en Develop seulement (décision 106, point 7) : sous le verrou du couloir, l’étape de la mission est relue ; une mission qui n’est plus en Develop (une Validation ou un lancement de la QA passés juste avant le clic) refuse la pause (PAUSE_NOT_DEVELOP), rien n’est écrit, et aucune pause ne reste donc sans « Resume » à l’écran (revue 2 de M11). Herdr illisible (l’état des agents ne peut pas être lu, ou le passage du veilleur échoue) : la pause reste requested avec la cause {role:"agents",ticket:null,why:"unreadable",since} datée de la demande de pause, et son alerte au bout de 5 minutes ; jamais de reprise automatique. Trois gestes explicites de the user restent possibles en pause (décision 107) : mission-close (la clôture est demandée au Lead ; la mission n’est pas close, car lead-close reste refusé (MISSION_PAUSED) jusqu’à « Resume »), inbox-discuss et inbox-delegate.

Source : [src/dev-chain.mjs](../src/dev-chain.mjs), [src/backend.mjs](../src/backend.mjs).

Entrée : {mission:"M-<n>"}. Tout autre champ refusé.

Sortie : {mission:"M-<n>",pause:{state:"requested"|"paused",at:ISO,pausedAt?:ISO,waiting?:Array<{role:"dev"|"reviewer"|"qa"|"agents",ticket:string|null,why:"working"|"unknown"|"not-seen"|"foreign"|"unreadable",since:ISO}>,agent?:{role},alert?:true}}.

Écritures : state/devchain-M-<n>.json : pause {state:"requested",at}, sous le verrou du couloir de la mission puis celui de la chaîne ; le veilleur y écrit ensuite waiting tant que quelque chose peut tourner, puis state:"paused" et pausedAt. Une ligne au journal de la mission (Recent activity, décision 106 point 6), une fois chacune, à son instant : « Pause requested » à la demande, « Paused » quand elle devient effective (textes provisoires, rédigés par Codex) ; leur instant exact est gardé dans les marques de la chaîne (done, pause|requested|<at>, pause|paused|<at>) et la reprise ne l’efface pas. Refusée hors de Develop (PAUSE_NOT_DEVELOP) : rien n’est écrit. La pause tient après un redémarrage de l’outil. Pendant la pause, dev-launch, lead-request (lancement, reprise, correction, validation) et lead-close sont refusés (MISSION_PAUSED), rien n’est écrit.

Confirmation : Le clic de the user sur le bouton du bandeau vaut demande (décision 32) : commande des écrans seulement, refusée depuis une session d’agent lancée par l’outil (AGENT_SESSION, même barrière que mission-launch, décision 70, avec la même limite).

Rejeu : Demandée deux fois, elle ne change rien et rend la pause telle qu’elle est.

Codes spécifiques : `INVALID_ARGUMENT`, `NOT_FOUND`, `MISSION_OVER`, `PAUSE_NOT_DEVELOP`, `AGENT_SESSION`, `INVALID_DATA`, `DEV_LANE_BUSY` ; voir aussi les codes communs.

### `mission-resume`

« Resume » sur le bandeau gris (ticket M11) : lève la pause, demandée ou effective. Elle ne lance rien elle-même : le passage suivant du veilleur reprend la série où elle s’était arrêtée (le relecteur, la correction, le ticket suivant, la QA qui attendaient), sans second agent ; un dev coupé pendant la pause reste au Lead (décision 48).

Source : [src/dev-chain.mjs](../src/dev-chain.mjs), [src/backend.mjs](../src/backend.mjs).

Entrée : {mission:"M-<n>"}. Tout autre champ refusé.

Sortie : {mission:"M-<n>",pause:{state:"none"}}.

Écritures : state/devchain-M-<n>.json : pause remise à null, sous le verrou du couloir de la mission puis celui de la chaîne. Une pause levée ajoute « Resumed » au journal, une fois, à son instant (texte provisoire, rédigé par Codex ; marque pause|resumed|<at>) ; les lignes et les instants de la demande et de la pause restent.

Confirmation : Le clic de the user sur le bouton du bandeau vaut demande (décision 32) : commande des écrans seulement, refusée depuis une session d’agent lancée par l’outil (AGENT_SESSION, même barrière que mission-launch, décision 70, avec la même limite).

Rejeu : Sans pause, elle ne change rien.

Codes spécifiques : `INVALID_ARGUMENT`, `NOT_FOUND`, `MISSION_OVER`, `AGENT_SESSION`, `INVALID_DATA`, `DEV_LANE_BUSY` ; voir aussi les codes communs.

### `mission-close`

Demander au Lead d’un développement de le clore, depuis la Validation de the user : la demande est enregistrée, puis le Lead reçoit un message ; il vérifie fusion, mise en ligne prévue, Tracker et TL;DR, puis clôt avec lead-close.

Source : [src/mission.mjs](../src/mission.mjs), [src/agent-texts.mjs](../src/agent-texts.mjs).

Entrée : {mission:"M-<n>"}.

Sortie : {mission:"M-<n>",asked:true}.

Écritures : state/missions/M-<n>.json (closeAskedAt, ligne de journal) puis message dans le terminal du Lead (hc send).

Confirmation : Aucune : le clic de the user vaut demande ; c’est elle qui autorise lead-close.

Rejeu : Si closeAskedAt est déjà présent, asked:true sans nouvel envoi. Un envoi perdu reste incertain, sans répétition automatique.

Codes spécifiques : `INVALID_ARGUMENT`, `NOT_FOUND`, `MISSION_OVER`, `SEND_FAILED` ; voir aussi les codes communs.

### `mission-plan`

Le plan d’un développement tel que son issue le dit dans Tracker : sections Plan et Clarification (partie Décidé), liens web de la description ; affiché en texte dans l’étape Prepare.

Source : [src/mission.mjs](../src/mission.mjs).

Entrée : {mission:"M-<n>"}.

Sortie : {mission:"M-<n>",plan:string|null,decided:string|null,links:[{text,url}],url:string|null} ; {mission,unavailable:true} sans issue ou si Tracker ne répond pas.

Écritures : Aucune écriture (lecture Tracker en cache).

Confirmation : Aucune : lecture seule.

Rejeu : Lecture idempotente ; l’écran la refait une fois par minute.

Codes spécifiques : `INVALID_ARGUMENT`, `NOT_FOUND` ; voir aussi les codes communs.

### `lead-plan`

Le Lead enregistre son plan dans sa mission (format 2) : ses tickets, chacun nommé par l’identifiant de son sous-ticket du tracker, avec rang d’affichage, résultat attendu, difficulté, agent, modèle, effort, dépendances par identifiant, statut de livraison, phase, demandes couvertes, textes et maquettes ; et pour le plan, ce que la bande et les trois blocs de Prepare lisent (simulation/CONTRAT.md, § 1) : phases annoncées, approche, migrations, demandes de l’issue et leur couverture, ce qu’il faut prévoir (gestes, risques, textes, comptes de test), et le cas d’un seul ticket. Le plan est vérifié en entier, puis comparé aux sous-tickets que le tracker a pour l’issue.

Source : [src/mission.mjs](../src/mission.mjs), [src/plan.mjs](../src/plan.mjs).

Entrée : {mission:"M-<n>",plan:{tickets:[{id:"<ÉQUIPE>-<n>",rank:entier ≥ 1,title,result,difficulty:"light"|"standard"|"heavy",kind?:"work"|"design",delivery?:"included"|"deferred"|"associated"|"integrated",integratedBy?:<ticket>,agent?:"claude"|"codex",dev?:1|2,model?,effort?:"low"|"medium"|"high",modelReason?:string,deps?:[<ticket>],phase?:<phase>,covers?:[<demande>],texts?:[string],mockups?:[string]}] (1 à 200),phases?:[{id,title}],approach?:{summary,text?,paragraphs?:[string]},migrations?:[string],requests?:[{id,short,full,state?:"asked"|"postponed"|"pending",postponedAt?:"AAAA-MM-JJ"|instant ISO,reason?}],toPlan?:{manual?:Liste,risks?:Liste,accounts?:Liste,copy?:[{title,section?,detail?,ticket?:<ticket>}]},simple?:boolean,points?:entier 1 à 999}} avec Liste = {summary,note? (manual et risks),items:[{title,detail?,tickets?:[<ticket>]}]} ; agent requis pour un ticket work et included ; son modèle et son effort suivent sa difficulté : la règle est le profil dev de la configuration pour cet agent et ce niveau (profiles.dev.<agent>.<léger|standard|fort>) ; laissés vides ils sont ceux de la règle, et en prendre d’autres exige modelReason (la raison, dite par le Lead) ; sans règle configurée pour cet agent et ce niveau, model et effort sont requis ; dev dit quel dev développe le ticket quand le plan en a deux (1 : Dev 1, 2 : Dev 2 ; deux devs au plus) : laissé vide, le ticket est à Dev 1, et un plan qui ne le dit nulle part a un seul dev, enregistré comme avant, sans ce champ ; agent est l’outil de ce dev et ne dit pas qui il est (deux devs peuvent avoir le même outil) ; dès qu’un ticket dit son dev, un dev n’a qu’un outil (deux agents sous un même dev : PLAN_INVALID) et Dev 2 ne va pas sans Dev 1 ; le modèle d’un dev peut changer d’un ticket à l’autre ; dev vaut 1 ou 2, sinon PLAN_TICKET_INVALID ; la page d’un ticket lit ce champ dans mission.plan.tickets[].dev pour dessiner un couloir par dev (simulation/CONTRAT.md, § 2 ter) ; le moteur ne lance pas encore deux devs à la fois ; tout champ inconnu est refusé. Plan de Prepare (ticket M3) : toutes les phases que l’approche annonce, même sans ticket ; approach.summary est requis quand approach est donnée ; migrations dans l’ordre, [] pour aucune ; une demande a short (quelques mots) et full (telle que l’issue la dit), ce qui la couvre est lu dans les covers des tickets, dans l’ordre des rangs (un ticket deferred ne couvre rien dans cette livraison) et rendu dans requests[].tickets ; state seulement pour une demande qu’aucun ticket ne couvre, postponedAt seulement avec postponed ; dans toPlan, summary est requis dès qu’une liste a des items, et chaque ticket nommé est un ticket du plan ; simple vaut true pour un plan d’un seul ticket (false = absent), points seulement avec simple. Un champ absent reste absent (rien n’est inventé) ; un champ mal formé refuse le plan entier (PLAN_INVALID), avec le champ nommé (« requests[r1].full », « toPlan.risks.items[2].title ») ; requests[].text, risks et manual (format d’avant) sont refusés avec ce qui les remplace.

Sortie : {mission:"M-<n>",saved:boolean,unchanged:boolean,revision:entier,tickets:nombre,tracker:{verified:boolean,verifiedAt:string|null}} ; verified ne dit que la lecture du tracker faite par cet appel, jamais une plus ancienne : false quand le tracker n’a pas répondu, n’a donné qu’une partie des sous-tickets, montre deux sous-tickets différents sous un même identifiant, ou que la mission n’a pas d’issue. verifiedAt est un souvenir : la date à laquelle le tracker s’est porté garant de ce plan pour la première fois, gardée tant que le plan ne change pas, null sinon.

Écritures : state/missions/M-<n>.json (plan : format, tickets avec uid lu dans le tracker, phases, requests avec leurs tickets, approach, migrations, toPlan, simple, points quand ils sont donnés, revision, savedAt, tracker). Un uid déjà lu est gardé quand le tracker ne le redonne pas ; un identifiant porté par deux sous-tickets différents ne donne aucun uid et n’en remplace aucun. Aucune écriture dans le tracker : il est seulement relu.

Confirmation : Aucune : le Lead enregistre son plan librement ; rien n’est lancé par cette action.

Rejeu : Idempotente : le même plan renvoyé (même dans un autre ordre) garde sa révision et n’écrit rien tant que le tracker répond de même ; si seule la vérification change (tracker hors d’atteinte après une vérification, ou l’inverse), seul tracker est réécrit (saved:true, même révision) ; un plan modifié est une nouvelle révision des mêmes tickets. Un plan refusé ne laisse aucune trace.

Codes spécifiques : `INVALID_ARGUMENT`, `NOT_FOUND`, `MISSION_OVER`, `PLAN_INVALID`, `PLAN_TICKET_INVALID`, `PLAN_RANK_INVALID`, `PLAN_TICKET_DUPLICATE`, `PLAN_DEPENDENCY_UNKNOWN`, `PLAN_CYCLE`, `PLAN_TICKET_UNKNOWN`, `PLAN_MODEL_RULE` ; voir aussi les codes communs.

### `issue-sheet`

La page d’un ticket : ce que Tracker en sait (titre, état, priorité, assignée, étiquettes, branche, dates, résumé, plan, décisions, liens, sous-tickets, derniers commentaires) et son développement s’il en a un (étape, avancement, TL;DR, maquettes, journal).

Source : [src/mission.mjs](../src/mission.mjs).

Entrée : {issueId:string, refresh?:boolean} — refresh à l’ouverture de la page.

Sortie : {issueId,unavailable:boolean,issue:{identifier,title,url,state:{name,type},priority,assignee,labels,branch,createdAt,updatedAt,project}|null,summary,plan,decided,links,children:[{identifier,title,state,stateType,agent,model}],comments:[{author,at,body}],mission:{id,step,tldr,tickets,done,mockups,journal}|null}.

Écritures : Aucune écriture (lecture Tracker ; cache sauf refresh).

Confirmation : Aucune : lecture seule.

Rejeu : Lecture idempotente ; l’écran la refait toutes les trente secondes tant que la page est ouverte.

Codes spécifiques : `INVALID_ARGUMENT` ; voir aussi les codes communs.

### `lead-close`

Le Lead clôt sa mission (étape closed), seulement après une demande de clôture de the user ; un Lead ne clôt jamais de lui-même.

Source : [src/mission.mjs](../src/mission.mjs).

Entrée : {mission:"M-<n>"}.

Sortie : {mission:"M-<n>",closed:true}.

Écritures : state/missions/M-<n>.json (step closed, ligne de journal).

Confirmation : La demande de clôture de the user (mission-close) enregistrée sur la mission ; refus sans elle.

Rejeu : Une mission déjà close répond closed:true sans rien écrire.

Codes spécifiques : `INVALID_ARGUMENT`, `NOT_FOUND`, `CLOSE_NOT_ASKED`, `MISSION_PAUSED`, `DEV_LANE_BUSY` ; voir aussi les codes communs.

### `inbox-delegate`

Confier au Lead une décision que the user ne veut pas trancher : le Lead choisit, agit et note son choix ; la demande quitte l’Inbox.

Source : [src/mission.mjs](../src/mission.mjs), [src/conversation.mjs](../src/conversation.mjs), [src/agent-texts.mjs](../src/agent-texts.mjs), [src/requests.mjs](../src/requests.mjs).

Entrée : {item:"I-<n>",seen:string (version de la demande affichée ou lue à the user : le seen rendu par inbox-list ; obligatoire)}.

Sortie : {item:"I-<n>",delegated:true}. delegated:true dit que le choix est enregistré, et rien de plus : il ne dit pas que le message est arrivé au Lead (voir Rejeu).

Écritures : Une seule écriture enregistre le choix : state/requests/I-<n>.json (answer {left:true}, sans décision D-n), sous le verrou des demandes. Puis la question d’un agent redevient ouverte pour que le Lead y réponde (une question du Lead est close), et le message part dans le terminal du Lead, une fois, en nommant la demande et son fichier (state/requests/I-<n>.json) sans recopier son titre (décision 61) (réservé dans state/devchain-<mission>.json, clé delegate|I-<n>) ; la demande passe alors à resolved.

Confirmation : Aucune : le clic de the user vaut demande. Réservé aux questions (décision 44) : une autorisation reste à the user, et une suggestion, un verdict ou un choix de texte (kind) sont refusés (INVALID_ARGUMENT, rien n’est écrit).

Rejeu : Une seconde fenêtre obtient le même résultat et n’envoie rien : un message au Lead au plus. delegated:true est rendu après que cet appel a traité l’envoi : message envoyé ; envoi refusé avant de partir, laissé au veilleur ; envoi déjà réservé par une autre fenêtre ; ou envoi incertain, dit dans l’Inbox. Si cet appel s’arrête avant l’envoi, ou si l’envoi est refusé avant de partir (hc introuvable), le veilleur l’envoie. Un envoi dont le retour est perdu, ou que hc send termine en erreur, n’est jamais renvoyé : il est dit dans l’Inbox (« Message not confirmed »), une fois, tout de suite, ou par le veilleur une minute après la réservation si l’outil s’est arrêté avant de le dire. Lead injoignable avant l’écriture : NOT_FOUND, la demande reste dans l’Inbox. Demande déjà répondue autrement : QUESTION_CLOSED. Sans seen : SEEN_REQUIRED. Version étrangère ou demande remplacée : REQUEST_CHANGED, rien n’est envoyé.

Codes spécifiques : `INVALID_ARGUMENT`, `NOT_FOUND`, `QUESTION_CLOSED`, `REQUEST_CHANGED`, `SEEN_REQUIRED`, `STORAGE_ERROR` ; voir aussi les codes communs.

### `inbox-discuss`

Donner au Lead le contexte d’une demande que the user ouvre pour en parler avec lui avant de répondre.

Source : [src/mission.mjs](../src/mission.mjs), [src/agent-texts.mjs](../src/agent-texts.mjs), [src/requests.mjs](../src/requests.mjs).

Entrée : {item:"I-<n>"}.

Sortie : {item:"I-<n>",told:boolean}. told:true : le contexte vient d’être envoyé au Lead. told:false : rien n’est envoyé (demande déjà tranchée, fermée ou d’avant, ou déjà transmise sans erreur).

Écritures : Message dans le terminal du Lead (hc send) qui nomme la demande (I-<n>) et le fichier qui la garde (state/requests/I-<n>.json), à lire comme une donnée ; aucun de ses mots n’est recopié dans le message (décision 61) ; state/requests/I-<n>.json (discussedAt). Pour une question, le message donne la commande pilot-decide avec le seen de la demande ; pour une autorisation, aucune commande : le Lead dit à the user où cliquer.

Confirmation : Aucune : aucune décision n’est prise.

Rejeu : Deux clics rapprochés ou deux fenêtres font un seul envoi : discussedAt est posé sous le verrou des demandes avant l’envoi, et le second appel rend told:false. Après un envoi réussi, un nouveau clic n’envoie rien. Si l’envoi échoue ou reste incertain (SEND_FAILED, SEND_UNSURE), discussedAt est retiré : un nouveau clic renvoie le contexte, et le Lead peut alors le recevoir deux fois. Aucun envoi n’enregistre d’accord ni de réponse.

Codes spécifiques : `INVALID_ARGUMENT`, `NOT_FOUND`, `SEND_FAILED`, `SEND_UNSURE` ; voir aussi les codes communs.

### `mockup-publish`

Publier une maquette : un dossier de ~/Developer/mockups avec un fichier HTML par variante, rendu en images pour être vu dans V4, rattaché à un ticket ou une demande.

Source : [src/mockups.mjs](../src/mockups.mjs), [src/requests.mjs](../src/requests.mjs).

Entrée : {mission:"M-<n>",title:string ≤200,folder:string,ticket?,item?:"I-<n>"}.

Sortie : {mockup:{id:"MK-<n>",title,ticket,item,folder,variants:Array<{name,file,image,width,height}>,at,pub:string (identifiant propre à cette publication),picked}}.

Écritures : state/missions/M-<n>.json (mockups) ; images dans mockups/MK-<n>/ du dossier de l’app. Lance un Chrome sans fenêtre sur des fichiers locaux. Liée à une demande, l’écriture se fait sous le verrou des demandes.

Confirmation : Aucune : c’est le Lead qui publie.

Rejeu : Le même dossier remplace ses images, reçoit un nouvel identifiant de publication et oublie le choix. Liée à une demande : refusée pour une demande répondue ou fermée (QUESTION_CLOSED), remplacée (REQUEST_CHANGED), ou qui a déjà une autre maquette (INVALID_ARGUMENT) ; pour la demande qui en remplace une autre, le Lead publie de nouveau.

Codes spécifiques : `INVALID_ARGUMENT`, `NOT_FOUND`, `MOCKUP_CAPTURE_FAILED`, `QUESTION_CLOSED`, `REQUEST_CHANGED` ; voir aussi les codes communs.

### `mockup-pick`

Enregistrer la variante que the user choisit : réponse à la demande liée ; pour une maquette liée à aucune demande, message au Lead.

Source : [src/mockups.mjs](../src/mockups.mjs), [src/requests.mjs](../src/requests.mjs).

Entrée : {mission:"M-<n>",mockup:"MK-<n>",variant:string,published:string (identifiant pub de la publication affichée),note?:string ≤1000,item?:"I-<n>" (la demande que cette publication illustre, telle qu’affichée),seen?:string (version de cette demande)}. item et seen sont obligatoires quand la maquette est liée à une demande : l’écran envoie ensemble la publication, la demande et la version qu’il a dessinées, et ne relit rien au moment du clic.

Sortie : {mockup:"MK-<n>",variant:string}.

Écritures : Maquette liée à une demande : comme inbox-answer (réponse {choice:variante,published}), et jamais de message au Lead. Maquette liée à aucune demande : state/missions/M-<n>.json (picked) d’abord, puis un message dans le terminal du Lead qui nomme la maquette (MK-<n>) et ce fichier, sans recopier la variante ni la note (décision 61). Maquette liée à une demande : state/missions/M-<n>.json (picked) après la réponse.

Confirmation : Aucune : le clic de the user vaut choix.

Rejeu : Une demande déjà répondue garde sa réponse : le même choix est accepté, un choix différent répond QUESTION_CLOSED. Une demande fermée ou confiée au Lead répond QUESTION_CLOSED : rien n’est dit au Lead, quel que soit le nombre de fenêtres restées ouvertes. Publication qui n’est plus celle affichée, ou demande envoyée qui n’est pas celle de la maquette : MOCKUP_STALE ; la publication et la demande sont relues sous le verrou qui écrit la réponse. Sans seen : SEEN_REQUIRED. Demande remplacée (la maquette reste liée à l’ancienne) ou version étrangère : REQUEST_CHANGED, rien n’est choisi : le Lead publie de nouveau la maquette pour la demande du moment. Une maquette liée à aucune demande n’enregistre aucun accord.

Codes spécifiques : `INVALID_ARGUMENT`, `MOCKUP_STALE`, `NOT_FOUND`, `QUESTION_CLOSED`, `REQUEST_CHANGED`, `SEEN_REQUIRED`, `SEND_FAILED`, `SEND_UNSURE` ; voir aussi les codes communs.

### `agent-waiting`

Dire ce que demande un agent arrêté sur son terminal, pour l’afficher à the user.

Source : [src/waiting.mjs](../src/waiting.mjs).

Entrée : {terminal:"t<id>"}.

Sortie : {question:string|null,command:string|null,details:Array<string>}. command : la commande dont il demande l’autorisation.

Écritures : Aucune : lecture de l’écran du terminal (hc read).

Confirmation : Aucune : lecture.

Rejeu : Sans effet.

Codes spécifiques : `INVALID_ARGUMENT`, `HC_UNAVAILABLE` ; voir aussi les codes communs.

### `agent-started`

Dire quand le terminal d’un agent a été ouvert, c’est-à-dire son dernier lancement, pour l’afficher à the user.

Source : [src/waiting.mjs](../src/waiting.mjs).

Entrée : {terminal:"t<id>"}.

Sortie : {startedAt:string|null}. startedAt : date ISO de création du terminal, null si herdr-core ne la donne pas.

Écritures : Aucune : lecture du terminal (hc get).

Confirmation : Aucune : lecture.

Rejeu : Sans effet.

Codes spécifiques : `INVALID_ARGUMENT`, `HC_UNAVAILABLE` ; voir aussi les codes communs.

### `agent-discuss`

Donner au Lead ou au Pilot ce que demande un agent arrêté, pour que the user en parle avec lui. Personne ne répond à sa place.

Source : [src/waiting.mjs](../src/waiting.mjs), [src/agent-texts.mjs](../src/agent-texts.mjs).

Entrée : {agent:"t<id>",mission:"M-<n>",ticket:string,to:"lead"|"pilot",terminal?:"t<id>" (Pilot)}.

Sortie : {told:true}.

Écritures : Ce que demande l’agent (question, commande, détail, tels que lus dans son terminal) est gardé dans state/agent-asks/<ticket>-<terminal>-<ms>-<n>.json, un fichier par clic ; le message dans le terminal du Lead ou du Pilot (hc send) nomme ce fichier, sans en recopier les mots (décision 61). Rien n’est écrit dans le terminal de l’agent.

Confirmation : Aucune : aucune décision n’est prise.

Rejeu : Chaque clic renvoie le message.

Codes spécifiques : `INVALID_ARGUMENT`, `HC_UNAVAILABLE`, `NOT_FOUND`, `SEND_FAILED` ; voir aussi les codes communs.

### `qa-browser`

Ouvrir le back-office d’un développement dans terminal-browser, dans un terminal que la fenêtre QA montre.

Source : [src/validation-desk.mjs](../src/validation-desk.mjs).

Entrée : {mission:"M-<n>",url:"http://localhost:<port>…"}.

Sortie : {terminal:"t…",reused:boolean,key:"<pid>-<n>"|null} : key est la clé terminal-browser du navigateur (même tty que son terminal), null si inconnue.

Écritures : Un terminal par développement (hc run, labels fabrique-console.qabrowser, fabrique-console.url, herdr.space, herdr.tab) ; une autre page ferme la précédente.

Confirmation : Aucune : le clic de the user vaut demande. Seule une page de ce Mac est ouverte.

Rejeu : La même page rend le même terminal.

Codes spécifiques : `INVALID_ARGUMENT`, `NOT_FOUND`, `HC_UNAVAILABLE`, `STOP_FAILED`, `LAUNCH_UNCERTAIN` ; voir aussi les codes communs.

### `inbox-answer`

Enregistrer la réponse que the user donne par un clic sur un choix affiché, dans la page d’un ticket ou dans l’Inbox. C’est la commande des écrans, et la seule qui enregistre une autorisation.

Source : [src/questions.mjs](../src/questions.mjs), [src/requests.mjs](../src/requests.mjs).

Entrée : {item:"I-<n>",choice?:string ≤200,text:string ≤4000,seen:string (version de la demande affichée : le seen rendu par inbox-list ; obligatoire)}. Tout autre champ refusé. Pour une autorisation, choice est obligatoire et doit être l’une des réponses de la demande (answers).

Sortie : {decision:{id,item,mission,question|null,choice|null,text,seen,by:"legacyOwner",via:"screen",at},item:Demande,created:boolean}.

Écritures : Comme pilot-decide : une seule écriture dans state/requests/I-<n>.json sous le verrou des demandes, puis décision et question sous condition.

Confirmation : Aucune : le clic de the user vaut réponse. Cette commande n’est donnée à aucun agent comme commande à lancer. Barrière (décision 70) : les agents lancés par l’outil (Lead, devs, relecteurs, QA, Pilot, assistant) ont l’interdiction écrite de l’utiliser, et portent une marque posée par l’outil à leur démarrage (variable FABRIQUE_CONSOLE_AGENT, donnée par une option de leur programme : --settings pour Claude, shell_environment_policy pour Codex) ; une demande qui la porte est refusée (AGENT_SESSION) avant toute lecture ou écriture. Limite, telle qu’elle est (décision 76) : la marque arrête les erreurs, pas un agent qui cherche à passer. Elle n’est que l’environnement du processus qui lance la commande : `env -u FABRIQUE_CONSOLE_AGENT node …/cli.mjs …` la retire en une ligne ; un agent peut aussi écrire directement le fichier de la mission (`state/missions/M-<n>.json`, son `approval`) ou celui des demandes, sous le même compte ; et les devs tournent en `bypassPermissions` (Claude) ou `danger-full-access` (Codex), sans rien qui les retienne. Rien d’autre ne protège l’approbation et les réponses par clic jusqu’à M16 : la vraie preuve d’origine écran (canal réservé à la page) vient avant M16, avec les décisions 66 et 67 (décision 70). L’outil lie une réponse à la version déclarée vue ; il ne prouve pas un geste humain.

Rejeu : Comme pilot-decide : première réponse rendue (created:false), SEEN_REQUIRED sans version, REQUEST_CHANGED pour une version étrangère ou une demande remplacée, QUESTION_CLOSED pour une demande fermée, confiée au Lead ou d’avant la bascule ; rien n’est enregistré.

Codes spécifiques : `AGENT_SESSION`, `INVALID_ARGUMENT`, `NOT_FOUND`, `QUESTION_CLOSED`, `REQUEST_CHANGED`, `SEEN_REQUIRED` ; voir aussi les codes communs.

### `environment-check`

Contrôler l’environnement d’un projet avant un lancement (M6, décisions 89, 93 et 95) : base PostgreSQL présente, locale et reconnue, en lecture seule ; migrations Drizzle en attente lues au commit contrôlé, jamais lancées ; comptes de test présents. Git en local strict : rien n’est téléchargé (--no-lazy-fetch), aucun transport ni gestionnaire d’identifiants, rien n’est écrit dans le dépôt. Pas d’étape serveur dans cette version (décision 95, reportée avant M16) : base, migrations et comptes déclarés et verts suffisent au vert. Depuis la page d’une mission (M6 b, « Run the check again ») : {mission}, le contrôle du projet de la mission, puis la vue que mission-read rend (src/environment-view.mjs).

Source : [src/environment-check.mjs](../src/environment-check.mjs), [src/environment-config.mjs](../src/environment-config.mjs), [src/environment-pg.mjs](../src/environment-pg.mjs), [src/environment-view.mjs](../src/environment-view.mjs).

Entrée : {project:string} (clé de projet), ou {mission:"M-<n>"} (le projet de la mission ; INVALID_ARGUMENT si elle n’en a pas).

Sortie : {version:1,project,status:"green"|"failed"|"incomplete"|"not-declared"|"invalid",green:boolean,cause:string|null,sha:string|null,fingerprint:string|null,enrollment:string|null,at,previous?:"interrupted",steps:Array<{step:"database"|"migrations"|"accounts",status:"green"|"failed"|"not-run"|"not-declared",cause?,detail?,journal?,pending?,accounts?:{<nom>:boolean}}>}. Une cause d’une liste fermée seulement, avec une clé de détail et des nombres ; aucune sortie de programme. Avec {mission} : {environment:EnvironmentView}, la vue de mission-read.environment après ce contrôle.

Écritures : environment/<projet>/last.json, environment/<projet>/.running-<id> (une marque par contrôle) et le verrou noyau environment/<projet>/operation.guard dans le dossier d’état de Mission Control. Aucun dossier préparé, rien dans le dépôt ni dans la base.

Confirmation : Aucune : lecture et contrôle.

Rejeu : Nouveau contrôle complet à chaque appel ; un seul à la fois par projet.

Codes spécifiques : `INVALID_ARGUMENT`, `NOT_FOUND`, `ENVIRONMENT_BUSY` ; voir aussi les codes communs.
Raisons d’observation (pas des exceptions) : `DB_ABSENT`, `DB_NOT_LOCAL`, `DB_UNKNOWN`, `DB_AUTH_UNSUPPORTED`, `MIGRATIONS_PENDING`, `MIGRATIONS_UNREADABLE`, `DB_AHEAD`, `ACCOUNT_MISSING`, `INTERRUPTED`, `CONFIG_INVALID`, `INCOMPLETE`, `CHECKING`, `NOT_CHECKED`, `STALE`, `UNREADABLE`.

### `environment-enroll`

Enregistrer, une fois et par the user, la base de dev d’un projet : identifiant complet et image du conteneur, moteur Docker (programme, socket, et identité du moteur : ID, OperatingSystem, Name de docker info ; Docker Desktop seulement), empreinte de la base. Refusé depuis une session d’agent.

Source : [src/environment-check.mjs](../src/environment-check.mjs).

Entrée : {project:string,container:string,docker?:string (chemin absolu, défaut /usr/local/bin/docker),socket?:string (chemin absolu, défaut ~/.docker/run/docker.sock)}.

Sortie : {status:"enrolled",project,enrollment:string} ou {status:"refused",project,cause,detail?}.

Écritures : environment/<projet>/enrollment.json dans le dossier d’état de Mission Control (jamais l’identifiant système de la base, seulement son empreinte).

Confirmation : Geste de the user : refusé à une session d’agent lancée par l’outil (AGENT_SESSION, marque FABRIQUE_CONSOLE_AGENT). Limite, la même que celle des décisions 70 et 76 : la marque arrête les erreurs, pas un agent qui cherche à passer (env -u FABRIQUE_CONSOLE_AGENT la retire, et un agent du même compte peut écrire enrollment.json lui-même : sa forme est validée, pas son origine) ; la vraie preuve d’origine écran vient avant M16.

Rejeu : Un nouvel enregistrement remplace le précédent après les mêmes preuves.

Codes spécifiques : `AGENT_SESSION`, `INVALID_ARGUMENT`, `NOT_FOUND`, `ENVIRONMENT_BUSY` ; voir aussi les codes communs.
Raisons d’observation (pas des exceptions) : `DB_ABSENT`, `DB_NOT_LOCAL`, `DB_UNKNOWN`, `DB_AUTH_UNSUPPORTED`, `MIGRATIONS_PENDING`, `MIGRATIONS_UNREADABLE`, `DB_AHEAD`, `ACCOUNT_MISSING`, `INTERRUPTED`.

### `mission-stop-after`

Où s’arrête une mission (chantier 1, point 16) : à la fin de Develop (develop) ou à la fin de Validate (validate, par défaut et pour toute mission d’avant). Arrêtée à la fin de Develop, une fois tous les tickets de la livraison acceptés, le veilleur ne lance ni l’agent QA ni la Validation, ne réveille pas le Lead, écrit heldAt sur la mission, le dit une fois dans le journal et le notifie ; lead-request validation est refusée (MISSION_STOPS_AFTER_DEVELOP). Remise à validate, la mission reprend : l’agent QA et la Validation partent au passage suivant du veilleur.

Source : [src/mission.mjs](../src/mission.mjs), [src/backend.mjs](../src/backend.mjs).

Entrée : {mission:"M-<n>",stopAfter:"develop"|"validate"}. Tout autre champ refusé.

Sortie : {mission:"M-<n>",stopAfter:"develop"|"validate"}.

Écritures : state/missions/M-<n>.json : stopAfter ; validate retire heldAt. Écrit sous le verrou du couloir de la mission (celui où le veilleur lance la QA et la Validation, et où lead-request validation relit la limite).

Confirmation : Commande des écrans seulement, refusée depuis une session d’agent lancée par l’outil (AGENT_SESSION, même barrière que mission-launch, décision 70, avec la même limite).

Rejeu : Redemandée avec la même valeur, elle ne change rien.

Codes spécifiques : `INVALID_ARGUMENT`, `NOT_FOUND`, `MISSION_OVER`, `MISSION_PAST_DEVELOP`, `AGENT_SESSION` ; voir aussi les codes communs.

### `mission-measure`

Mesurer la consommation estimée complète d’une mission à partir des traces M13, sans lancer ni arrêter un agent.

Source : [src/cli.mjs](../src/cli.mjs), [src/backend.mjs](../src/backend.mjs), [src/mission-budgets.mjs](../src/mission-budgets.mjs), [src/ticket-tokens.mjs](../src/ticket-tokens.mjs).

Entrée : {mission:"M-<n>"}.

Sortie : {mission,estimate:true,total:Counts,roles:Array<{role:lead|dev|reviewer|qa,...Counts}>,tickets:{<ticket>:Counts}}. Counts = {in,out,input,cacheRead,cacheWrite,total,partial,unknown}. total=in+out ; in inclut les caches, input les exclut. Un compteur inconnu reste null et contamine son total ; cacheWrite Codex reste null sans rendre in/out inconnus. Aucun lancement donne null, pas 0. Les tickets incluent la QA rattachée à l’issue ; le Lead sans ticket figure seulement dans roles et total.

Écritures : Aucune. Lectures des traces et des compteurs de sessions ; aucun accès au réseau ni au contenu métier des conversations.

Confirmation : Aucune, lecture seule.

Rejeu : Relecture complète, réutilisation éventuelle d’un résultat M13 entier pendant au plus 60 secondes.

Codes spécifiques : `INVALID_ARGUMENT`, `NOT_FOUND`, `INVALID_DATA`, `UNSAFE_STORAGE` ; voir aussi les codes communs.

### `mission-close-check`

Liste de clôture calculée, lecture seule, pour chaque dépôt de la mission : QA terminée, points jugés, problèmes traités, branche propre et à jour avec mission.base, PR fusionnable et CI verte. Une liste de checks vide certaine permet « No checks listed » ; lecture inconnue bloque. Aucun dépôt sur la branche bloque explicitement. Les tickets merged/canceled ou completed dans Tracker ne bloquent pas ; le verdict QA « problèmes » peut être résolu par les jugements ok de the user. Une PR ouverte sur l’ancien SHA autorise le push de la nouvelle tête ; ses anciens checks ne valent pas pour la nouvelle tête. SKIPPED et NEUTRAL sont non bloquants.

Source : [src/mission-close.mjs](../src/mission-close.mjs), [src/backend.mjs](../src/backend.mjs), [src/dev-flow.mjs](../src/dev-flow.mjs).

Entrée : {mission:"M-<n>"}.

Sortie : {ready:boolean,seen:revision,rows:[{key:string,ok:boolean,detail:string,repo?:string}],base:string|null,repositories:[CloseRepository]}. seen : SHA-256 des données QA/jugements/tickets, de l’issue et TL;DR, de l’étape et du cycle closureCycle, des opérations enregistrées, des identités Git, des commits et de la cible distante, des PR/checks et des lignes. CloseRepository : repo,path,branch?,base?,head?,baseSha?,pushed?,github?,origin?,common?,observed?,pr?,ok,branchDetail,checks:{ok,detail}. Champs absents/null si inconnus. pr est la réponse gh (number,url,state,headRefOid,headRefName,baseRefName,isDraft,mergeable,mergeStateStatus,statusCheckRollup), jamais une instruction. Dépôts directs du worktree uniquement, racine comprise si elle est Git ; les clés key restent inchangées (path + suffixe pour les lignes de dépôt). repo porte séparément le nom du dépôt pour les lignes branch/checks et les opérations incertaines ; les lignes globales omettent repo. detail ne porte aucun préfixe de dépôt. CI : « n/m · k pending », « No checks listed », « No PR yet ». origin est affectée seulement après validation GitHub : une URL contenant des identifiants n’est jamais renvoyée ni conservée dans closure.

Écritures : Lectures locales et distantes Git/GitHub, fetch local de la base (objets et FETCH_HEAD) avant merge-base ; aucun push ni écriture de mission. Seule ENOENT ignore un dossier sans dépôt ; une autre erreur bloque.

Confirmation : Aucune ; ready ne vaut pas accord.

Rejeu : Lecture fraîche sans reprise d’opération. Une opération incertaine ne bloque que si la relecture réelle échoue ; une absence prouvée permet un nouvel accord explicite. La PR déjà fusionnée doit correspondre au HEAD et à la cible de la mission.

Codes spécifiques : `INVALID_ARGUMENT`, `NOT_FOUND` ; voir aussi les codes communs.

### `mission-approve-close`

Accord unique de the user sur la liste affichée. Sous verrou de mission : relit et refuse si non prête ou seen modifié ; pousse le SHA approuvé sans force, crée la PR si absente (titre de l’issue, corps TL;DR), puis fusionne par merge commit vers mission.base sans origin/. CI et cible relues avant fusion, --match-head-commit garde le HEAD. Une PR déjà fusionnée est conservée. Après toutes les fusions, reprend mission-close : le Lead ferme Tracker et appelle lead-close ; le moteur ne modifie jamais Tracker. Le pushurl différent de l’origin validée est refusé ; le push vise explicitement cette URL. QA, jugements et tickets sont relus sous verrou avant chaque fusion et avant la demande au Lead. Après push ou création de PR dans cet appel, checks vides : deux relectures, cinq secondes maximum avec timeouts gh inclus ; toujours vides : CLOSE_NOT_READY avec demande de relire la liste et de renouveler l’accord ; détail court « Checks not registered ». Au prochain accord sans publication, vide vaut « No checks listed ». Après la relecture QA et la sauvegarde de merge=asking, le SHA distant de la base est relu et comparé au SHA approuvé, puis son ascendance de la tête est vérifiée juste avant gh pr merge. Base modifiée : CLOSE_NOT_READY avec demande de relire la liste et de renouveler l’accord ; détail court « Target branch changed », sans fusion ni demande au Lead ; ascendance ou lecture inconnue : arrêt également.

Source : [src/mission-close.mjs](../src/mission-close.mjs), [src/backend.mjs](../src/backend.mjs), [src/mission.mjs](../src/mission.mjs), [src/lead-wake.mjs](../src/lead-wake.mjs).

Entrée : {mission:"M-<n>",seen:revision} ; seen obtenu par mission-close-check.

Sortie : {mission:"M-<n>",asked:true} ; la mission reste en validating jusqu’à lead-close.

Écritures : state/missions/M-<n>.json : closure {base,branch,approvedSeen,approvedAt,repositories:[identité Git + opérations push/pr/merge {status:asking|done|uncertain|failed,at,reason?},pullRequest]}. repositories[].pr désigne l’étape de création ; pullRequest contient les données GitHub (distinct de repositories[].pr dans la liste de contrôle). origin est l’URL validée, observed indique une relecture distante réussie. Marque écrite avant chaque effet, preuve relue après. Puis closeAskedAt/journal et envoi habituel au Lead (réveil si repos). Verrou noyau state/mission-close/M-<n> partagé avec reopen/lead-close. Git push sans --force ; gh pr create puis gh pr merge --merge ; aucune suppression de branche. Un refus du contrôle final de base inscrit merge=failed avec reason et une ligne branchDetail bloquante ; aucun effet de fusion n’a été lancé.

Confirmation : Commande des écrans, refusée avec FABRIQUE_CONSOLE_AGENT. Le clic portant seen vaut accord ; aucun accord d’agent.

Rejeu : Deux clics sérialisés. Si la clôture a déjà été demandée, renvoie asked sans nouvel envoi. Réponse perdue : arrêt immédiat, marque uncertain visible dans mission.closure. Un nouvel accord sur une liste fraîche réconcilie le résultat réel : effet prouvé = done sans répétition ; absence prouvée (SHA distant différent, aucune PR ou PR non fusionnée) = nouvelle exécution permise ; lecture échouée = bloqué. Refus net (authentification ou non-fast-forward) : failed avec raison courte sans sortie brute. seen inclut les états d’opération et closureCycle ; l’accord d’avant Reopen est périmé. Aucun rejeu automatique. Les dépôts déjà fusionnés sont conservés.

Codes spécifiques : `INVALID_ARGUMENT`, `NOT_FOUND`, `AGENT_SESSION`, `CLOSE_CHANGED`, `CLOSE_NOT_READY`, `CLOSE_UNCERTAIN`, `CLOSE_FAILED`, `SEND_FAILED`, `SEND_UNSURE`, `MISSION_OVER` ; voir aussi les codes communs.

### `mission-reopen`

Réouvrir une mission close en Validate avec une raison obligatoire. Rien n’est annulé dans Git et aucune écriture Tracker ; journal de mission puis raison envoyée au Lead par leadSend, qui réveille un Lead au repos ou dont l’onglet a été fermé après clôture.

Source : [src/mission-close.mjs](../src/mission-close.mjs), [src/backend.mjs](../src/backend.mjs), [src/lead-wake.mjs](../src/lead-wake.mjs).

Entrée : {mission:"M-<n>",reason:string} ; texte non blanc, 2000 caractères au plus, sans NUL ; espaces de bord retirés.

Sortie : {mission:"M-<n>",reopened:true,step:"validating",warning?:string}. Échec d’envoi ou Lead arrêté/absent : avertissement, la transition reste acquise.

Écritures : Mission : step=validating, suppression de closeAskedAt et de l’accord closure, ancien closure conservé dans closureHistory (5 dernières clôtures), raison dans log. closedOutAt devient restedAt pour réveil, puis message au Lead. Verrou commun avec approve/lead-close et invariant d’une mission active par issue gardé sous verrou du registre. closureCycle (entier, défaut 0) incrémenté à chaque Reopen, même sans closure et indépendamment de la limite d’historique. Un échec de notification est ajouté au journal si possible ; même si cette écriture d’avertissement échoue, Reopen reste acquis et l’avertissement est renvoyé.

Confirmation : Commande des écrans, refusée avec FABRIQUE_CONSOLE_AGENT ; le clic et sa raison valent demande.

Rejeu : Une mission déjà réouverte refuse MISSION_NOT_CLOSED ; l’envoi perdu n’est pas répété automatiquement. L’ancien closeAskedAt ne peut plus autoriser lead-close.

Codes spécifiques : `INVALID_ARGUMENT`, `NOT_FOUND`, `AGENT_SESSION`, `MISSION_NOT_CLOSED`, `MISSION_OPEN` ; voir aussi les codes communs.

## Codes et conduite à tenir

Codes communs : `INVALID_ARGUMENT`, `INVALID_CONFIG`, `INVALID_DATA`, `UNSAFE_STORAGE`, `BUSY`, `STORAGE_ERROR`, `CONFIG_CONFLICT`, `INTERNAL_ERROR`, `LEGACY_ARCHIVE_FAILED`. Les erreurs typées sont distinctes des refus dans data et de preparation.errorCode.

- **REVIEW_IN_LANE** (refusal) — The reviews of an approved mission are started by its chain. Nothing was launched. **À faire :** La mission de l’issue a son plan approuvé : ses relecteurs sont lancés par sa chaîne après le compte rendu du dev. Rien n’est lancé ni écrit.
- **AGENT_SESSION** (refusal) — Refusé : cette commande est réservée à the user dans Mission Control. Rien n’a été modifié. Demande-lui d’effectuer l’action à l’écran. (mission-launch, mission-reapprove, inbox-answer, mission-pause, mission-resume, mission-stop-after et mission-visit-seen ; environment-enroll garde son propre texte.) **À faire :** La demande vient d’une session d’agent lancée par l’outil (marque FABRIQUE_CONSOLE_AGENT, décision 70) : l’approbation et les réponses par clic sont des gestes de the user à l’écran. L’agent le dit à the user ; rien n’est écrit.
- **AMBIGUOUS_PROJECT** (error) — Several mappings match this Tracker issue. Resolve the configuration. **À faire :** Corriger le ticket/équipe/projet/labels ou l’association indiquée ; aucun choix implicite parmi plusieurs dépôts/associations, relire ensuite l’aperçu.
- **BASE_CONFIRMATION_REQUIRED** (refusal) — Confirm this exact behind, divergent or unverified base. **À faire :** Présenter la base locale non vérifiée/en retard/divergente et confirmer manifestHash exact.
- **BASE_REVISION_REQUIRED** (error) — Read the current configuration and supply its baseRevision. **À faire :** read-config, conserver config+revision ensemble et envoyer baseRevision avec le document édité.
- **BASE_TREE_NOT_MATERIALIZED** (error) — Arbre cible incomplet, notamment après fetch dans un clone partiel. **À faire :** Matérialiser manuellement cet arbre ; réconcilier puis libérer la réservation avant un nouvel aperçu. Aucun téléchargement implicite. Wording provisoire.
- **BASE_UNAVAILABLE** (refusal) — The configured main branch has no usable local commit. **À faire :** Rétablir une branche principale locale valide ; aucune substitution par HEAD ou un SHA distant arbitraire.
- **BRANCH_COLLISION** (both) — The development branch name or directory prefix became occupied. **À faire :** Préserver la branche existante et choisir/replanifier une branche non conflictuelle ; pas de suppression automatique.
- **BUSY** (both) — Another local operation is in progress. **À faire :** Attendre la fin du propriétaire puis rejouer ; aucune suppression manuelle du guard.
- **CHECK_NOT_STARTED** (error) — The connection check of an agent tool could not be started; no marker and no running state are left behind. **À faire :** Afficher que la vérification n’a pas démarré, sans état « en cours » ; proposer de relancer. Ne rien conclure sur la connexion.
- **CLEANUP_CHANGED** (refusal) — The directory changed after cleanup confirmation. **À faire :** Réconcilier et refaire confirmer la proposition actuelle ; ne pas réutiliser la commande ancienne.
- **CLEANUP_MANUAL_REQUIRED** (refusal) — cleanup manual required **À faire :** Préserver fichiers/commits, nettoyer manuellement dossier/branche/entrée Git puis reconcile et release confirmé.
- **CLEANUP_UNAVAILABLE** (refusal) — No recorded directory ownership is available. **À faire :** Ne rien retirer ; l’identité/le vide/la demande ne sont plus prouvés.
- **CLEANUP_UNCERTAIN** (refusal) — Cleanup could not be proven complete. **À faire :** Conserver la réservation et réconcilier ; ne pas répéter rmdir sans preuve.
- **CLOSE_NOT_ASKED** (error) — the user has not asked to close this development: a Lead never closes on its own. **À faire :** Attendre la demande de clôture de the user (bouton de sa Validation) ; ne pas réessayer sans elle.
- **CONFIG_CONFLICT** (error) — The file changed while being read. **À faire :** Relire config et sa revision ; résoudre le conflit avant une nouvelle sauvegarde explicite.
- **CONFIG_V2_LAUNCH_UNAVAILABLE** (worker) — V2 repository selection and verification must be implemented before launching. **À faire :** Ne pas tenter launch en V2 ; le circuit de lancement sera un lot ultérieur.
- **CONFIG_V2_REQUIRED** (worker) — Configuration version 2 exigée pour la préparation et la qualification des tickets ; également une exception error de ticket-qualify, code worker historique ailleurs. **À faire :** Configurer V2 par conversion explicite ou document initial V2 ; pas de fallback V1.
- **CONFIRMATION_MISMATCH** (refusal) — L’intention a changé ; inspectez et confirmez son empreinte actuelle. **À faire :** Relire/réconcilier l’état courant puis faire reconfirmer son empreinte ; ne pas substituer le hash en silence.
- **CONFIRMATION_REQUIRED** (both) — Confirm configuration migration explicitly. **À faire :** Présenter l’effet exact et obtenir une confirmation explicite, jamais ajouter confirmed automatiquement.
- **EEXIST** (reason) — eexist **À faire :** Code système principalement consommé en interne ; exception brute => INTERNAL_ERROR en CLI, mais un worker peut le publier dans preparation.errorCode. Réconcilier sans supposer un succès ni supprimer la ressource.
- **ELOOP** (reason) — eloop **À faire :** Code système principalement consommé en interne ; exception brute => INTERNAL_ERROR en CLI, mais un worker peut le publier dans preparation.errorCode. Réconcilier sans supposer un succès ni supprimer la ressource.
- **EMULATORS_BUSY** (error) — Des ports des émulateurs sont déjà pris sans leur hub : un ancien démarrage resté à moitié. **À faire :** Arrêter ce qui tient ces ports, puis relancer.
- **ENOENT** (reason) — enoent **À faire :** Code système principalement consommé en interne ; exception brute => INTERNAL_ERROR en CLI, mais un worker peut le publier dans preparation.errorCode. Réconcilier sans supposer un succès ni supprimer la ressource.
- **ESRCH** (reason) — esrch **À faire :** Code système principalement consommé en interne ; exception brute => INTERNAL_ERROR en CLI, mais un worker peut le publier dans preparation.errorCode. Réconcilier sans supposer un succès ni supprimer la ressource.
- **FETCH_BUNDLE_UNSUPPORTED** (refusal) — Bundle fetching is configured and can write additional references/configuration. No fetch was started. **À faire :** Inspecter la configuration bundle ; aucune mise à jour n’a été lancée, ne pas contourner le refus.
- **FETCH_BUSY** (refusal) — fetch busy **À faire :** Un autre aperçu légitime télécharge ; réessayer après sa fin, sans lancer un fetch parallèle.
- **FETCH_INTENT_CHANGED** (refusal) — The fetch intention changed before go. **À faire :** Relire l’intention et rejouer normalement seulement après réconciliation.
- **FETCH_INTENT_NOT_FOUND** (refusal) — No pending fetch has this id. **À faire :** Relire fetch-inspect ; ne pas abandonner un autre identifiant à sa place.
- **FETCH_PREFLIGHT_FAILED** (refusal) — The bundle configuration could not be verified before fetching objects. **À faire :** Réparer l’accès à la configuration Git avant téléchargement ; ne pas supposer le précontrôle réussi.
- **FETCH_RECOVERY_REQUIRED** (refusal) — fetch recovery required **À faire :** fetch-inspect puis attendre la preuve de fin ou demander l’abandon forcé explicitement confirmé.
- **FETCH_TERMINATION_UNCONFIRMED** (refusal) — The fetch owner could not confirm group termination. Inspect it before planning another workspace; no numeric group signal was sent by the parent. **À faire :** Conserver l’intention ; inspecter identité/groupe, aucune relance ni signal numérique aveugle.
- **FORCE_NOT_REQUIRED** (refusal) — La fin est prouvée ; rejouez normalement l’aperçu pour réconcilier cette intention. **À faire :** Utiliser le chemin normal prouvé (release normal ou prochain aperçu), pas la sortie forcée.
- **GIT_ERROR** (both) — Git failed. Verify the configured local repository, branch and worktree. **À faire :** Inspecter Git/branche/chemin/objets sans écraser le travail existant ; refaire le plan ou réparer explicitement.
- **GIT_TERMINAL_PROMPT** (reason) — git terminal prompt **À faire :** Corriger la ressource ou l’état signalé puis refaire une observation ; conserver les données, sans répétition automatique d’effet incertain.
- **GIT_UNSUPPORTED** (refusal) — Git must support worktree lock/reason and bounded fetch without FETCH_HEAD or auto-maintenance. **À faire :** Inspecter Git/branche/chemin/objets sans écraser le travail existant ; refaire le plan ou réparer explicitement.
- **GLOBAL_CAPACITY** (worker) — global capacity **À faire :** Libérer explicitement une préparation terminée ; maximum local min(configuration,2) dev.
- **HC_PROTOCOL** (error) — hc returned invalid JSON. **À faire :** Inspecter la connexion et les labels d’appartenance ; ne jamais agir sur un simple numéro de terminal.
- **HC_UNAVAILABLE** (error) — herdr-core is unavailable. Session status cannot be verified. **À faire :** Inspecter la connexion et les labels d’appartenance ; ne jamais agir sur un simple numéro de terminal.
- **INTERNAL_ERROR** (worker) — internal error **À faire :** Corriger la ressource ou l’état signalé puis refaire une observation ; conserver les données, sans répétition automatique d’effet incertain.
- **INVALID_ARGUMENT** (error) — Usage: node src/cli.mjs <action> <JSON object> **À faire :** Corriger l’entrée selon l’action ; ne pas réessayer le même document invalide.
- **INVALID_CONFIG** (both) — Migration requires a version 1 configuration. **À faire :** Préserver la configuration, corriger ses champs/chemins ; ne pas écrire une version épurée à la place.
- **INVALID_DATA** (both) — A local JSON file is invalid or unreadable. **À faire :** Préserver les fichiers ; restaurer ou réparer explicitement après diagnostic, sans suppression automatique.
- **INVALID_STATE** (error) — stateId must be a real workflow state ID belonging to this issue’s team. **À faire :** Corriger la ressource ou l’état signalé puis refaire une observation ; conserver les données, sans répétition automatique d’effet incertain.
- **IPC** (reason) — ipc **À faire :** Corriger la ressource ou l’état signalé puis refaire une observation ; conserver les données, sans répétition automatique d’effet incertain.
- **ISSUE_NOT_IN_TEAM** (error) — L’issue relue n’appartient pas à la team du projet configuré. **À faire :** Choisir une issue de la team ; aucun lancement.
- **LANE_BUSY** (error) — Another development preparation owns this Git lane. **À faire :** Choisir une autre tâche ou faire approuver explicitement les modules indépendants et occupants exacts.
- **LAUNCH_UNCERTAIN** (error) — The previous launch was not confirmed. Inspect herdr-core and reconcile the local session before retrying. **À faire :** Réconcilier les terminaux et l’intention de lancement ; reprise explicite seulement après observation.
- **LEGACY_RESERVATION_UNKNOWN** (error) — A legacy session may still own this Git. Reconcile or explicitly stop it first. **À faire :** Réconcilier/arrêter explicitement la session V1 ; la seule mort du terminal ne libère pas le plafond.
- **TICKET_API** (both) — Tracker did not provide a valid summary observation time. **À faire :** Traiter le transport/authentification/pagination selon le code ; recharger les preuves distantes. Aucune répétition automatique d’une mutation incertaine.
- **TICKET_AUTH** (both) — Tracker returned unexpected OAuth permissions. The previous session was preserved. **À faire :** Traiter le transport/authentification/pagination selon le code ; recharger les preuves distantes. Aucune répétition automatique d’une mutation incertaine.
- **TICKET_AUTH_TIMEOUT** (error) — Tracker authorization timed out. Run npm run tickets:login again. **À faire :** Traiter le transport/authentification/pagination selon le code ; recharger les preuves distantes. Aucune répétition automatique d’une mutation incertaine.
- **TICKET_INCOMPLETE** (error) — Tracker did not return a complete issue list for this project. **À faire :** Traiter le transport/authentification/pagination selon le code ; recharger les preuves distantes. Aucune répétition automatique d’une mutation incertaine.
- **TICKET_KEYCHAIN** (error) — The dedicated Keychain helper timed out. **À faire :** Traiter le transport/authentification/pagination selon le code ; recharger les preuves distantes. Aucune répétition automatique d’une mutation incertaine.
- **TICKET_MCP_API** (error) — Tracker MCP rejected the read request. Check identifiers and access rights. **À faire :** Traiter le transport/authentification/pagination selon le code ; recharger les preuves distantes. Aucune répétition automatique d’une mutation incertaine.
- **TICKET_MCP_UNAVAILABLE** (error) — Tracker MCP could not complete the request. Check connectivity and authorization. **À faire :** Traiter le transport/authentification/pagination selon le code ; recharger les preuves distantes. Aucune répétition automatique d’une mutation incertaine.
- **TICKET_MCP_UNSUPPORTED** (error) — A required Tracker MCP tool argument changed. Refresh or update the integration. **À faire :** Traiter le transport/authentification/pagination selon le code ; recharger les preuves distantes. Aucune répétition automatique d’une mutation incertaine.
- **TICKET_MUTATION_FAILED** (error) — Tracker did not confirm this mutation. Refresh before another attempt. **À faire :** Traiter le transport/authentification/pagination selon le code ; recharger les preuves distantes. Aucune répétition automatique d’une mutation incertaine.
- **TICKET_MUTATION_PARTIAL** (error) — The issue state changed, but the comment was not confirmed. Refresh Tracker before retrying; do not repeat the whole payload. **À faire :** Traiter le transport/authentification/pagination selon le code ; recharger les preuves distantes. Aucune répétition automatique d’une mutation incertaine.
- **TICKET_MUTATION_UNCERTAIN** (error) — This exact payload already had an uncertain or partial attempt. Reconcile Tracker before preparing a new confirmed payload. **À faire :** Traiter le transport/authentification/pagination selon le code ; recharger les preuves distantes. Aucune répétition automatique d’une mutation incertaine.
- **TICKET_NOT_CONFIGURED** (both) — Tracker is not configured. Add a personal API key to the dedicated macOS Keychain item. **À faire :** Traiter le transport/authentification/pagination selon le code ; recharger les preuves distantes. Aucune répétition automatique d’une mutation incertaine.
- **TICKET_PAGINATION** (error) — Tracker MCP repeated a tool cursor. **À faire :** Traiter le transport/authentification/pagination selon le code ; recharger les preuves distantes. Aucune répétition automatique d’une mutation incertaine.
- **TICKET_RATE_LIMIT** (error) — Tracker rate limit reached. Retry later. **À faire :** Traiter le transport/authentification/pagination selon le code ; recharger les preuves distantes. Aucune répétition automatique d’une mutation incertaine.
- **TICKET_READ_ONLY** (error) — This Tracker MCP connection is read-only. No mutation was sent. **À faire :** Traiter le transport/authentification/pagination selon le code ; recharger les preuves distantes. Aucune répétition automatique d’une mutation incertaine.
- **TICKET_SCOPE** (error) — La ressource n’a pas été confirmée dans l’équipe ou le projet demandé. **À faire :** Vérifier les identifiants et l’équipe configurée ; aucune donnée hors portée n’est restituée.
- **TICKET_SECRET_RESPONSE** (error) — La réponse ou le cache contient exactement la valeur sensible utilisée. **À faire :** Réponse refusée sans copie du corps distant ; corriger la donnée ou renouveler la lecture.
- **TICKET_TIMEOUT** (error) — The project summary exceeded 25 seconds. Retry this project separately. **À faire :** Traiter le transport/authentification/pagination selon le code ; recharger les preuves distantes. Aucune répétition automatique d’une mutation incertaine.
- **TICKET_UNAVAILABLE** (both) — Tracker could not be reached within the request timeout. **À faire :** Traiter le transport/authentification/pagination selon le code ; recharger les preuves distantes. Aucune répétition automatique d’une mutation incertaine.
- **MAPPING_CHANGED** (both) — This session belongs to a different repository mapping. **À faire :** Recharger configuration/ticket ; conserver le worktree original tant que sa propriété n’est pas résolue.
- **MERGE_FAILED** (error) — La fusion du ticket ne peut pas être vérifiée ou terminée par Git. **À faire :** Inspecter les dépôts ; toute fusion déjà réussie est conservée. Aucun reset forcé ni suppression automatique.
- **MIGRATION_CONFLICT** (error) — The migration backup is missing. **À faire :** Préserver journal/sauvegarde/source ; diagnostiquer avant reprise, aucune annulation automatique.
- **MIGRATION_PENDING** (error) — Resume the pending configuration migration before saving. **À faire :** Reprendre config-migrate avec les options originales et confirmation ; pas de config-save concurrent.
- **MIGRATION_REQUIRED** (error) — Use the confirmed configuration migration to convert version 1. **À faire :** Utiliser config-migrate confirmé ; config-save ne convertit pas V1 en V2.
- **MIGRATION_UNSUPPORTED_FIELDS** (error) — Unknown V1 fields need explicit handling before migration. **À faire :** Faire traiter explicitement les champs ou valeurs non préservables ; ne pas les supprimer silencieusement.
- **MISSION_CONTINUATION_UNAVAILABLE** (refusal) — Une sourceRunId/continuationOf a été demandée avant le circuit C4. **À faire :** Attendre 4.3 ; ces champs ne sont jamais ignorés pour fabriquer un nouveau départ.
- **MISSION_INTEGRITY** (error) — Le fichier ou ses identifiants/dates diffèrent du hash lié au registre. **À faire :** Ne pas confirmer ; demander un nouvel aperçu, jamais faire confiance à un hash ajouté dans le JSON.
- **MISSION_LAUNCH_NOT_IMPLEMENTED** (reason) — Lot 4.2 sans lancement ; aucun agent autorisé. **À faire :** Intégrer la lecture d’aperçu ; 4.3 apportera le circuit confirmé.
- **MISSION_NO_ISSUE** (error) — Cette mission n’a pas d’issue : son Lead n’aurait rien à lire. **À faire :** Créer ou retrouver l’issue, puis une mission sur cette issue.
- **MISSION_OPEN** (both) — Cette issue a déjà une mission en cours. **À faire :** Reprendre la mission rendue (mission-create) ; pour un lancement, laisser finir ou clore la mission du Lead en place.
- **MISSION_OVER** (error) — This development is already over. **À faire :** Rien à demander : la mission est déjà validée ou close ; relire la mission.
- **MISSION_FORMAT_OLD** (both) — This mission has no plan recorded by its Lead: old format, or not planned yet. **À faire :** Rien n’a été lancé ni modifié. Faire enregistrer le plan par le Lead (lead-plan), puis redemander le lancement ; une mission de l’ancien format reste consultable, elle n’est pas migrée.
- **MISSION_PLAN_REQUIRED** (refusal) — Un ticket Standard/Fort n’a pas de plan explicitement sélectionné. **À faire :** Choisir projectId/documentId du plan à montrer intégralement ; pas de texte fourni par l’appelant.
- **MISSION_PLAN_SCOPE** (refusal) — Le projet du plan diffère du projet du ticket. **À faire :** Choisir le plan du projet du ticket, sans élargir la portée en silence.
- **MISSION_PLAN_UNVERIFIED** (refusal) — Plan indisponible, partiel, archivé, tronqué, vide ou budget partagé épuisé. **À faire :** Rétablir sa lecture complète puis demander un nouvel aperçu ; aucune approbation inventée.
- **MISSION_PROFILE_REQUIRED** (refusal) — La table de configuration ne fournit pas ce rôle/outil/niveau. **À faire :** Compléter explicitement le profil ; aucun repli de modèle ou d’effort.
- **MISSION_PROMPT_TOO_LARGE** (refusal) — La consigne complète dépasse 32 Kio UTF-8. **À faire :** Réduire le contexte ou découper le ticket ; aucune troncature.
- **MISSION_ROLE_UNAVAILABLE** (refusal) — Ce rôle ne dispose pas de son cycle dans le lot 4.2. **À faire :** Seul dev a un aperçu ici ; review attend une source C4 et les restrictions 4b, les autres rôles leurs étapes.
- **MISSION_SOURCE_CHANGED** (refusal) — La configuration a changé pendant la lecture ou avant publication. **À faire :** Relire et produire un nouvel aperçu ; aucun aperçu ancien autorisé.
- **MISSION_UNSERIALIZABLE** (refusal) — Le filtre de secrets altérerait la mission. **À faire :** Corriger la source sélectionnée ; aucun snapshot réécrit annoncé exact.
- **MOCKUP_CAPTURE_FAILED** (error) — This mockup could not be rendered. **À faire :** Chrome n’a pas rendu une variante : vérifier le fichier HTML, puis republier le dossier.
- **MOCKUP_STALE** (error) — This mockup was published again. Look at it once more. **À faire :** L’écran affichait une publication antérieure, ou une publication faite pour une autre demande : recharger la maquette puis choisir de nouveau.
- **MUTATION_JOURNAL_UNREADABLE** (error) — Le journal des créations passées n’a pas pu être lu ; aucune issue n’a été créée. **À faire :** Vérifier les droits du dossier mutations de la racine privée, puis réessayer la même opération.
- **MUTEX_BUSY** (error) — The lock of the watcher is busy. **À faire :** Le mutex state/watcher.lock est resté tenu par un processus vivant pendant 5 s : ce n’est pas la preuve qu’un autre veilleur tourne. Au démarrage, le veilleur se termine (sortie 1) et la barre en relance un dans la minute ; en cours de boucle, le battement ou la publication est sauté et retenté au cycle suivant.
- **NOT_FOUND** (both) — No configured project uses this key. **À faire :** Corriger la ressource ou l’état signalé puis refaire une observation ; conserver les données, sans répétition automatique d’effet incertain.
- **NO_SPACE** (error) — L’espace Herdr de la mission est introuvable et n’a pas pu être créé. **À faire :** Vérifier que la fenêtre Herdr App répond, puis relancer.
- **PARALLEL_CONFIRMATION_MISMATCH** (error) — Parallel approval must name the exact current occupants and independent modules. **À faire :** Replanifier, relire les occupants et demander une nouvelle approbation de concurrence.
- **PILOT_BUSY** (error) — Pilot est au travail : il n’est pas arrêté pour ouvrir une autre demande. **À faire :** Le laisser finir, puis rouvrir la demande.
- **PLAN_CHANGED** (refusal) — The ticket, repository, base or lane observations changed. Request a new plan. **À faire :** Replanifier et reconfirmer les nouvelles observations ; aucun rejeu du vieux manifeste.
- **PLAN_NOT_FOUND** (refusal) — No workspace plan has this id. **À faire :** Demander un nouveau plan après vérification des réservations existantes.
- **PO_FOLDER_UNAVAILABLE** (error) — Le dossier de travail du PO n’existe pas, ou les dépôts du projet ne sont pas dans un même dossier. **À faire :** Vérifier la configuration des dépôts du projet ; aucun lancement.
- **PO_PROMPT_TOO_LARGE** (error) — Le rôle du PO et l’issue dépassent la taille d’une consigne de lancement. **À faire :** Raccourcir la description de l’issue ou le rôle ; aucun lancement.
- **PO_PROMPT_UNDELIVERED** (error) — La consigne (rôle et issue) n’a pas été remise au terminal du PO lancé précédemment ; cette session ne peut pas être reprise. **À faire :** Arrêter la session (stop, confirmé) puis relancer : une nouvelle session PO est créée. Aucun second envoi aveugle de la consigne.
- **PREPARATION_NOT_FOUND** (refusal) — No workspace preparation has this id. **À faire :** Relire l’identifiant de préparation ; ne pas créer à l’aveugle pour compenser une réponse perdue.
- **PREPARATION_UNCERTAIN** (refusal) — A running or uncertain preparation cannot be released. **À faire :** Réconcilier et inspecter ; force seulement si l’état ne peut être prouvé et avec confirmation distincte.
- **PROJECT_DEV_LIMIT** (warning) — Les réservations dev connues du projet atteignent le plafond indicatif. **À faire :** Afficher le dépassement ; seul le plafond global dev/collisions bloque.
- **PROJECT_NOT_AUTHORIZED** (worker) — Le projet du ticket n’est pas autorisé par les associations de cette équipe. **À faire :** Corriger le ticket/équipe/projet/labels ou l’association indiquée ; aucun choix implicite parmi plusieurs dépôts/associations, relire ensuite l’aperçu.
- **PROJECT_REQUIRED** (worker) — Le projet du ticket manque pour cette association restreinte. **À faire :** Corriger le ticket/équipe/projet/labels ou l’association indiquée ; aucun choix implicite parmi plusieurs dépôts/associations, relire ensuite l’aperçu.
- **PROOF_UNSERIALIZABLE** (error) — Evidence cannot be stored without alteration. **À faire :** Corriger les chemins/arguments contenant une valeur masquée ; aucun test ne démarre sans preuve exacte sérialisable.
- **QA** (reason) — qa **À faire :** Corriger la ressource ou l’état signalé puis refaire une observation ; conserver les données, sans répétition automatique d’effet incertain.
- **QA_CODE_UNREADABLE** (reason) — État Git illisible, instable, non pris en charge ou budget dépassé. **À faire :** Preuve inconnue ; rétablir la lecture du worktree puis relire, sans prétendre à un succès.
- **QA_LAUNCH_UNCERTAIN** (reason) — qa launch uncertain **À faire :** Inspecter le run QA et son terminal/worker avant toute relance ; unknown/interrupted ne sont pas un succès.
- **QA_NOT_CONFIGURED** (error) — Choose a configured QA profile. **À faire :** Inspecter le run QA et son terminal/worker avant toute relance ; unknown/interrupted ne sont pas un succès.
- **QA_PROOF_STALE** (reason) — Le code actuel diffère de celui du test. **À faire :** Relancer explicitement le profil sur le code courant ; conserver la preuve historique.
- **QA_PROOF_UNKNOWN** (reason) — Validité du test inconnue, ou journal historique sans commit. **À faire :** Lire test-proofs et ses observations ; ne pas afficher réussi depuis le code de retour seul.
- **QA_RUNNING** (error) — This session already has a running QA job. **À faire :** Inspecter le run QA et son terminal/worker avant toute relance ; unknown/interrupted ne sont pas un succès.
- **QA_TERMINAL_GONE** (reason) — qa terminal gone **À faire :** Inspecter le run QA et son terminal/worker avant toute relance ; unknown/interrupted ne sont pas un succès.
- **QA_UNCERTAIN** (error) — The previous QA launch is uncertain. Inspect its labeled terminal before starting another run. **À faire :** Inspecter le run QA et son terminal/worker avant toute relance ; unknown/interrupted ne sont pas un succès.
- **QA_WORKER_GONE** (reason) — qa worker gone **À faire :** Inspecter le run QA et son terminal/worker avant toute relance ; unknown/interrupted ne sont pas un succès.
- **QUALIFICATION_AGENT_AMBIGUOUS** (reason) — Plusieurs labels agent: présents, même si leurs noms sont identiques. **À faire :** Conserver exactement un label agent: reconnu.
- **QUALIFICATION_AGENT_REQUIRED** (reason) — Aucun label agent: présent. **À faire :** Choisir exactement agent:claude ou agent:codex dans Tracker.
- **QUALIFICATION_AGENT_UNSUPPORTED** (reason) — Le seul label agent: porte une valeur inconnue. **À faire :** Choisir agent:claude ou agent:codex, sans substitution automatique.
- **QUALIFICATION_CONFIG_CHANGED** (reason) — La configuration a changé pendant la lecture du ticket. **À faire :** Relancer la qualification avec une configuration stable.
- **QUALIFICATION_DEPENDENCIES_UNVERIFIED** (reason) — La liste des prérequis blockedBy est incomplète ou illisible. **À faire :** Relire complètement les dépendances. Un prérequis archivé peut être vérifié par son état minimal, sans détails.
- **QUALIFICATION_DEPENDENCY_OPEN** (reason) — Au moins un prérequis est encore ouvert. **À faire :** Terminer ou annuler le prérequis dans Tracker, puis relire.
- **QUALIFICATION_DEPENDENCY_STATE_UNKNOWN** (reason) — L’état canonique d’un prérequis n’a pas pu être classé. **À faire :** Vérifier son état puis relire ; ne pas le considérer terminé.
- **QUALIFICATION_DESCRIPTION_LIMIT** (reason) — Description brute au-delà de 32 768 unités UTF-16, ou ligne au-delà de 4 096 unités (hors séparateur LF, CRLF ou CR isolé) : analyse non effectuée, règle 4 unverified. **À faire :** Raccourcir ou découper le ticket, puis relire ; aucun dépassement de taille ne peut donner prêt.
- **QUALIFICATION_DESCRIPTION_UNVERIFIED** (reason) — Le champ description n’a pas une forme vérifiable. **À faire :** Rétablir la lecture de la description avant de qualifier.
- **QUALIFICATION_LABELS_UNVERIFIED** (reason) — Les labels ne sont pas intégralement lisibles, valides ou bornés à 100. **À faire :** Rétablir une lecture complète des labels avant de qualifier.
- **QUALIFICATION_LEVEL_AMBIGUOUS** (reason) — Plusieurs labels niveau: présents. **À faire :** Conserver exactement un label de niveau reconnu.
- **QUALIFICATION_LEVEL_REQUIRED** (reason) — Aucun label niveau: présent. **À faire :** Choisir exactement niveau:léger, niveau:standard ou niveau:fort.
- **QUALIFICATION_LEVEL_UNSUPPORTED** (reason) — Le seul label niveau: porte une valeur inconnue après normalisation NFC et casse. **À faire :** Choisir une des trois valeurs exactes, sans niveau implicite.
- **QUALIFICATION_READY_REQUIRED** (reason) — Le label prêt manque (comparaison NFC et sans casse, choix provisoire ; aucun retrait d’espaces ni d’accents). **À faire :** Faire qualifier le ticket et poser prêt dans Tracker, puis relire.
- **QUALIFICATION_REPOSITORY_UNVERIFIED** (reason) — La sélection déclarative du dépôt ne peut pas être vérifiée. **À faire :** Contrôler associations et labels ; aucune commande Git exécutée pour ce diagnostic.
- **QUALIFICATION_SCOPE_UNVERIFIED** (reason) — Le ticket ou son équipe ne correspond pas à la portée vérifiée. **À faire :** Vérifier équipe/projet et identifiant du ticket avant une nouvelle lecture.
- **QUALIFICATION_SECTIONS_AMBIGUOUS** (reason) — Une rubrique obligatoire apparaît plusieurs fois. **À faire :** Fusionner les occurrences en une rubrique sans ambiguïté.
- **QUALIFICATION_SECTIONS_MISSING** (reason) — Rubrique obligatoire absente, vide, uniquement balisage/métadonnées/ponctuation/symboles/contrôles, exemple inchangé ou placeholder connu. Hors bloc de code, au moins une lettre ou un chiffre de texte est exigé après nettoyage. **À faire :** Renseigner les rubriques A1/A2 signalées ; aucune interprétation sémantique du texte.
- **QUALIFICATION_SOURCE_NOT_FRESH** (reason) — La source est en cache ou ne porte pas une date de lecture valide. **À faire :** Recharger la source ; aucune qualification prête depuis cette observation.
- **QUALIFICATION_SOURCE_PARTIAL** (reason) — La lecture globale est partielle, même si les six faits A4 connus semblent satisfaits. **À faire :** Lire source.partialReasons, rétablir la lecture puis recommencer ; ready.ok reste false.
- **QUALIFICATION_SOURCE_UNAVAILABLE** (reason) — Lecture enrichie indisponible ou erreur de lecture masquée. **À faire :** Rétablir la clé dédiée ou la lecture, puis relancer ticket-qualify ; aucun repli MCP/cache.
- **QUALIFICATION_STATUS_NOT_STARTABLE** (reason) — Le statut connu n’est ni unstarted ni started. **À faire :** Placer le ticket dans un statut de type Todo ou In Progress avant de relire.
- **QUALIFICATION_STATUS_UNKNOWN** (reason) — Le statut canonique du ticket n’a pas pu être classé. **À faire :** Vérifier le statut dans son équipe et relire.
- **QUESTION_CLOSED** (error) — Cette question n’attend plus de réponse du Lead (déjà répondue, ou retenue pour une demande faite à the user) ; ou : This request is closed. — cette demande est fermée, confiée au Lead, déjà répondue autrement, ou date d’avant la bascule. **À faire :** Relire la question avec mission-read ; ne pas répondre deux fois.
- **QUESTION_GONE** (error) — This question no longer waits for an answer. **À faire :** La question a déjà reçu sa réponse ou a été remplacée : relire l’Inbox ; rien n’a été envoyé.
- **QUESTION_ID_USED** (error) — This id already named another question: give the new question a new id. **À faire :** Le PO a repris un id déjà employé pour une autre question : il repose sa question avec un nouvel id. Rien n’est remplacé.
- **QUESTION_STALE** (error) — The PO is not waiting for this answer now. Read its terminal. **À faire :** Le terminal du PO n’est pas idle (il travaille, attend un dialogue, est en erreur ou illisible) : rien n’est envoyé, la question reste ; lire le terminal.
- **RECONCILE_CHANGED** (refusal) — The preparation changed during process inspection. Inspect it again. **À faire :** Réinspecter l’état courant avant toute confirmation.
- **REMOTE_BASE_UNAVAILABLE** (both) — Le commit de base ou ses objets ne sont plus disponibles. Demandez un nouvel aperçu avant de réessayer. **À faire :** Choisir une base permise ou matérialiser explicitement les objets du commit cible ; si réservation existante, reconcile/release avant nouvel aperçu.
- **REPORT_COMMIT_NOT_FOUND** (error) — Le commit du compte rendu est absent du dépôt indiqué. **À faire :** Vérifier le dépôt relatif et donner le SHA d’un commit local existant.
- **REPORT_REPOSITORY_NOT_FOUND** (error) — Le dépôt du compte rendu est introuvable, hors worktree ou n’est pas la racine du dépôt Git indiqué. **À faire :** Exécuter la commande depuis la racine du worktree et choisir --repo . ou un dépôt imbriqué existant.
- **REPORT_STALE** (error) — Le commit courant du ticket a changé depuis le compte rendu ou ne correspond pas au SHA rapporté. **À faire :** Rendre un nouveau compte rendu et refaire sa revue avant la fusion ; aucun commit supplémentaire n’est intégré implicitement.
- **REPO_AMBIGUOUS** (worker) — Dépôt à préciser : plusieurs dépôts configurés sont désignés. **À faire :** Corriger le ticket/équipe/projet/labels ou l’association indiquée ; aucun choix implicite parmi plusieurs dépôts/associations, relire ensuite l’aperçu.
- **REPO_LABEL_REQUIRED** (worker) — Dépôt à préciser : aucun label ne désigne un dépôt configuré. **À faire :** Corriger le ticket/équipe/projet/labels ou l’association indiquée ; aucun choix implicite parmi plusieurs dépôts/associations, relire ensuite l’aperçu.
- **REPO_NOT_ROOT** (worker) — Le chemin sélectionné est un sous-dossier. Configurer la racine du dépôt Git. **À faire :** Corriger le ticket/équipe/projet/labels ou l’association indiquée ; aucun choix implicite parmi plusieurs dépôts/associations, relire ensuite l’aperçu.
- **REPO_NOT_WORKTREE** (worker) — Le chemin sélectionné n’est pas un checkout Git utilisable. **À faire :** Corriger le ticket/équipe/projet/labels ou l’association indiquée ; aucun choix implicite parmi plusieurs dépôts/associations, relire ensuite l’aperçu.
- **REPO_UNAVAILABLE** (both) — Repository identity requires canonical real directories. **À faire :** Corriger le ticket/équipe/projet/labels ou l’association indiquée ; aucun choix implicite parmi plusieurs dépôts/associations, relire ensuite l’aperçu.
- **REPO_UNSAFE_PATH** (worker) — Les paramètres du dépôt ne peuvent pas être présentés sans altération. Corriger l’association. **À faire :** Corriger le ticket/équipe/projet/labels ou l’association indiquée ; aucun choix implicite parmi plusieurs dépôts/associations, relire ensuite l’aperçu.
- **RESUME_REQUIRED** (error) — This ticket already has a historical session. Use resume to continue its worktree. **À faire :** Réconcilier les terminaux et l’intention de lancement ; reprise explicite seulement après observation.
- **REVIEW_CAPACITY** (worker) — review capacity **À faire :** Libérer une revue terminée ; plafond des revues séparé par projet.
- **REVIEW_COMMIT_UNAVAILABLE** (refusal) — The examined review commit is unavailable in this Git repository. **À faire :** Fournir un commit complet réellement disponible ; aucune revue sur base approximative.
- **REVIEW_QUEUE_LIMIT** (warning) — La borne basse connue de la file de revue atteint le plafond. **À faire :** Avertir et recueillir j’ai vu lors de la future confirmation ; ne pas traiter comme plafond dev.
- **REVIEW_QUEUE_UNMEASURED** (warning) — File de revue : borne basse connue, total non mesuré. **À faire :** Afficher les deux valeurs ; pas de case exigée pour le seul inconnu (choix provisoire).
- **REVIEW_SNAPSHOT** (error) — The tracked source diff could not be captured. **À faire :** Inspecter Git/branche/chemin/objets sans écraser le travail existant ; refaire le plan ou réparer explicitement.
- **REVIEW_SOURCE_REQUIRED** (error) — Start an implementation session for this issue before creating an independent review. **À faire :** Inspecter Git/branche/chemin/objets sans écraser le travail existant ; refaire le plan ou réparer explicitement.
- **SEND_FAILED** (error) — The answer could not be delivered to the PO terminal. Read the terminal before sending it again. **À faire :** hc send a échoué ; la question reste active. Lire le terminal du PO (la réponse a pu arriver) avant de renvoyer.
- **SERVER_NOT_CONFIGURED** (error) — Le plan n’indique pas de serveur utilisable (script d’un outil connu, dans un dossier du worktree). **À faire :** Ajouter ou corriger la ligne « Serveur : » du plan.
- **SESSION_STOPPED** (error) — This session is over. **À faire :** La session PO est arrêtée : relancer le PO depuis l’issue avant de poser une question ou d’y répondre.
- **STALE_CONFIG_VERSION** (error) — A version 1 client cannot replace a version 2 configuration. **À faire :** Recharger la configuration V2 ; ne jamais la remplacer par un éditeur V1.
- **STOP_FAILED** (error) — The owned session terminal could not be stopped. **À faire :** Inspecter la connexion et les labels d’appartenance ; ne jamais agir sur un simple numéro de terminal.
- **STORAGE_ERROR** (both) — Cannot confirm termination of the kernel lock acquisition. **À faire :** Inspecter l’état local et les permissions ; ne pas considérer l’opération comme appliquée.
- **TEAM_NOT_AUTHORIZED** (worker) — L’équipe du ticket n’est pas autorisée par la configuration. **À faire :** Corriger le ticket/équipe/projet/labels ou l’association indiquée ; aucun choix implicite parmi plusieurs dépôts/associations, relire ensuite l’aperçu.
- **TEAM_NOT_CONFIGURED** (both) — L’équipe autorisée manque dans cette association. Compléter la configuration. **À faire :** Corriger le ticket/équipe/projet/labels ou l’association indiquée ; aucun choix implicite parmi plusieurs dépôts/associations, relire ensuite l’aperçu.
- **TEAM_REQUIRED** (worker) — L’équipe du ticket est manquante. Recharger le ticket. **À faire :** Corriger le ticket/équipe/projet/labels ou l’association indiquée ; aucun choix implicite parmi plusieurs dépôts/associations, relire ensuite l’aperçu.
- **TERMINAL_GONE** (error) — The terminal of this PO is gone: relaunch the PO from the issue. **À faire :** Aucun terminal vivant ne porte le label de la session : relancer le PO depuis la page Issue, puis répondre.
- **TERMINAL_OWNERSHIP** (error) — The previous terminal ID belongs to another session. Inspect local session state. **À faire :** Inspecter la connexion et les labels d’appartenance ; ne jamais agir sur un simple numéro de terminal.
- **TICKET_ALREADY_RESERVED** (both) — This ticket already owns a development preparation in this Git. **À faire :** Reprendre la préparation indiquée plutôt que créer un second dev sur le même ticket/Git.
- **TICKET_NOT_READY** (refusal) — Les règles A4 ne sont pas toutes vérifiées et satisfaites. **À faire :** Lire qualification.ready et corriger/recharger le ticket avant un nouvel aperçu.
- **TIMEOUT** (error) — The read did not answer in time. **À faire :** Publié par le veilleur dans le fichier de la lecture (snapshot, backlog, My issues) après 120 s sans réponse ; les écrans gardent la dernière lecture et disent l’erreur. Le veilleur relit au cycle suivant.
- **UNKNOWN_ACTION** (error) — Unknown local backend action. **À faire :** Corriger le nom d’action ; ne pas retenter un nom absent du registre de cette branche.
- **UNMAPPED_PROJECT** (error) — No repository mapping explicitly authorizes this Tracker issue. **À faire :** Corriger le ticket/équipe/projet/labels ou l’association indiquée ; aucun choix implicite parmi plusieurs dépôts/associations, relire ensuite l’aperçu.
- **UNSAFE_STORAGE** (both) — Private storage must be a real directory. **À faire :** Inspecter identité, permissions et liens du stockage ; ne pas suivre ni supprimer aveuglément le chemin.
- **UNSAFE_WORKSPACE_DATA** (both) — Workspace metadata cannot be stored without alteration. **À faire :** Corriger la donnée qui serait altérée par le filtre ; ne pas relâcher le masquage.
- **UNSAFE_WORKTREE** (error) — The session worktree path changed. **À faire :** Corriger la ressource ou l’état signalé puis refaire une observation ; conserver les données, sans répétition automatique d’effet incertain.
- **WATCHER_RUNNING** (error) — A watcher already runs. **À faire :** Rien à faire : le veilleur vivant continue ; le second se termine.
- **WORKER_ACTIVE** (refusal) — Le worker identifié est encore actif ; attendez sa fin puis réconciliez. **À faire :** Attendre le worker identifié ; la sortie forcée n’est pas un bouton d’arrêt.
- **WORKER_OWNERSHIP** (both) — This worker no longer owns its reservation. **À faire :** Conserver l’état et réconcilier ; l’ancien worker ne doit pas publier pour un autre propriétaire.
- **WORKER_START_UNCERTAIN** (refusal) — The workspace worker did not announce a valid identity. **À faire :** Reconcile avec preparationId ; aucun deuxième worker créé pour compenser une réponse perdue.
- **WORKSPACE_RESERVED** (error) — The planned branch or path is already reserved. **À faire :** Reprendre la réservation possédée ou libérer après preuve ; ne pas écraser sa branche/son chemin.
- **WORKSPACE_STATE_CONFLICT** (both) — workspace state conflict **À faire :** Relire/réconcilier le registre ; aucun écrasement de l’état concurrent.
- **WORKTREES_ROOT_UNSAFE** (refusal) — The workspace directory must have real directory ancestors. **À faire :** Corriger racine/ancêtres/recouvrement des dépôts avant création.
- **WORKTREE_CHANGED** (error) — The session worktree is on a different branch. **À faire :** Inspecter Git/branche/chemin/objets sans écraser le travail existant ; refaire le plan ou réparer explicitement.
- **WORKTREE_COLLISION** (both) — The planned workspace path is occupied. **À faire :** Préserver le chemin existant, inspecter sa propriété ; ne pas le supprimer pour passer.
- **WORKTREE_DIRTY** (error) — Un dépôt touché contient des modifications non commitées ou une opération Git déjà en cours. **À faire :** Conserver et terminer ce travail avant de rejouer la fusion ; le layout ne l’annule pas.
- **WORKTREE_FAILED** (error) — The worktree of the issue could not be made. Look at the repository before trying again. **À faire :** Regarder le dépôt (branche ou dossier déjà pris, dépôt sans commit) puis recliquer ; les worktrees déjà faits sont gardés.
- **WORKTREE_MISSING** (error) — The session worktree is unavailable. **À faire :** Inspecter Git/branche/chemin/objets sans écraser le travail existant ; refaire le plan ou réparer explicitement.
- **WORKTREE_PATH_TOO_LONG** (refusal) — The planned workspace path is too long for the supported local filesystem. **À faire :** Configurer une racine plus courte puis refaire un plan.
- **WORKTREE_UNCERTAIN** (error) — The checkout is not safe to finish. **À faire :** Inspecter marqueur/HEAD/branche/contenu et réconcilier, sans nettoyage automatique.
- **PLAN_INVALID** (error) — The plan is not well formed (not an object, no ticket, unknown field, unknown phase or request). **À faire :** Corriger le plan d’après le message, qui nomme le ticket ou le champ en cause, puis le renvoyer en entier.
- **PLAN_TICKET_INVALID** (error) — A ticket of the plan is not well formed; the message names it and says what is wrong. **À faire :** Corriger ce ticket (identifiant de sous-ticket, titre, résultat attendu, difficulté, agent, modèle, effort, statut de livraison) et renvoyer le plan entier.
- **PLAN_RANK_INVALID** (error) — The rank of a ticket is not a whole number of its own (« 2b », a text, a rank used twice). **À faire :** Donner à chaque ticket un rang entier distinct, à partir de 1 ; un ticket de correction prend l’entier suivant.
- **PLAN_TICKET_DUPLICATE** (error) — The same ticket is in the plan twice, or two open sub-tickets of the issue carry the title of one ticket of the plan. **À faire :** Garder un seul sous-ticket par travail : annuler le doublon dans le tracker ou distinguer les titres, puis renvoyer le plan. Ne jamais créer une seconde sous-issue pour un ticket déjà au plan.
- **PLAN_DEPENDENCY_UNKNOWN** (error) — A ticket waits for, or is integrated by, something that is not a ticket of the plan. **À faire :** Nommer la dépendance par l’identifiant d’un ticket du plan (jamais par son rang), ou ajouter ce ticket au plan.
- **PLAN_CYCLE** (error) — Tickets of the plan wait for one another, or are integrated by one another, in a loop; or in a loop made of both (a ticket that waits for one it integrates). **À faire :** Casser la boucle nommée dans le message, puis renvoyer le plan.
- **PLAN_MODEL_RULE** (error) — A ticket takes another model or effort than the rule gives its difficulty, without saying why. **À faire :** Laisser model et effort vides pour prendre ceux de la règle, ou dire pourquoi dans modelReason, puis renvoyer le plan.
- **PLAN_TICKET_UNKNOWN** (error) — A ticket of the plan is not a sub-ticket of the issue in the tracker. **À faire :** Créer d’abord ce sous-ticket dans le tracker, une seule fois, ou corriger son identifiant, puis renvoyer le plan.
- **REQUEST_CHANGED** (error) — This request changed. Review it, then answer again. — La demande n’est plus celle qui a été affichée : une autre demande la remplace (replaces), ou la version envoyée n’est pas l’empreinte de cette demande. La réponse est refusée, rien n’est enregistré. **À faire :** Relire inbox-list, afficher la demande du moment et demander à the user de répondre de nouveau, avec son identifiant et son seen ; ne jamais renvoyer la même réponse sans qu’il ait relu. Pilot fait de même : il relit, présente de nouveau, redemande.
- **REQUEST_FIXED** (error) — A request does not change once it is made. / A question keeps its words, its answers and the answer it was given. — Garde interne : à côté d’une demande, seuls son état, une erreur et discussedAt s’écrivent (jamais sa réponse ni ses mots, et « answered » n’est dit que par l’enregistrement d’une réponse) ; le passage d’une question ne change ni ses mots, ni ses réponses, ni son auteur, ni la réponse de the user. **À faire :** Erreur de programmation, jamais atteinte par une action publique : pour d’autres mots, créer une autre demande (lead-escalate, lead-request).
- **SEEN_REQUIRED** (error) — Read this request again, then answer. — Une réponse à une demande (inbox-answer, pilot-decide, inbox-delegate, mockup-pick lié à une demande) est arrivée sans la version affichée : rien n’est enregistré. **À faire :** Relire inbox-list, afficher (ou, pour Pilot, relire à the user) la demande du moment, puis renvoyer sa réponse avec le seen de cette demande.
- **CLICK_REQUIRED** (error) — Une autorisation se donne par un clic de the user sur le choix affiché, dans la page du ticket ou l’Inbox. Rien n’est enregistré. Dis-lui où cliquer. — Un agent (Pilot, le Lead) a voulu enregistrer une autorisation avec pilot-decide : refusé, quelle que soit la version envoyée (décision 55). **À faire :** Ne pas réessayer. Présenter la demande, recommander, puis dire à the user de cliquer lui-même sur le choix affiché dans la page du ticket ou dans l’Inbox.
- **SEND_UNSURE** (error) — This message may not have been delivered. It was not sent again. — hc send n’a pas fini par un succès, sans que rien ne prouve que le message n’est pas parti (délai dépassé, processus tué, code de sortie en erreur, erreur muette) : il a pu être tapé dans le terminal. Seul hc introuvable (ENOENT), ou un argument refusé avant l’envoi, prouve que rien n’est parti. **À faire :** Ne jamais renvoyer automatiquement. Le veilleur garde la réservation de ce message et le dit dans l’Inbox (« Message not confirmed ») ; the user regarde le terminal et décide.
- **LEGACY_ARCHIVE_FAILED** (error) — Couldn't archive old requests and decisions. Request delivery is paused. **À faire :** L’archivage de l’ancien stock à la bascule (state/legacy-archive.json) n’a pas abouti : aucune opération des demandes ne s’exécute, le relais ne démarre pas. Lire la cause technique, donnée à part (error.cause dans l’enveloppe),  la corriger (dossier archive/ inaccessible, même fichier à sa place et dans l’archive), puis rejouer : l’archivage reprend où il s’était arrêté, sans rien perdre ni doubler. Ne jamais remettre à la main un ancien fichier dans state/.
- **DEV_LANE_OLD** (both) — This mission was started before the current dev series. The tool launches and stops none of its devs. **À faire :** Rien n’a été lancé, arrêté ni écrit, et rien ne le sera : le couloir n’est jamais reconstruit depuis les anciennes marques et aucune commande ne remet la mission à plat (ses anciens devs, sans nom ni étiquette dans herdr-core, ne peuvent pas être constatés arrêtés). À la main : arrêter ses terminaux de dev, clore la mission, reprendre le reste du travail dans une nouvelle mission.
- **DEV_LANE_BUSY** (error) — Another operation is running on the devs of this mission. Try again in a moment. **À faire :** Le couloir de la mission est tenu par un lancement ou un pas du veilleur, aussi longtemps qu’il dure. Rejouer la même demande plus tard ; rien n’a été lancé.
- **DEV_LANE_UNLOCKED** (error) — The lane of a mission is read and written under its lock. **À faire :** Erreur interne de programmation (le couloir a été lu ou écrit hors de son verrou) : rien n’a été lancé. À signaler.
- **NAME_TAKEN** (error) — A live terminal already holds the name of the dev of this mission. **À faire :** Interne au couloir : herdr-core a refusé un second terminal sous le nom de la mission. La demande rend already ou blocked ; rien n’est créé.
- **TRACKER_UNAVAILABLE** (error) — The tracker could not be read. Nothing was launched. **À faire :** Le tracker dit quels tickets sont annulés : sans lui, aucun dev n’est lancé. Rejouer quand il répond.
- **TRIAL_FORBIDDEN** (error) — In a trial: an agent the trial does not name, or a mockup capture (Chrome and the network), was asked; refused and written to trial-journal.jsonl. **À faire :** Ne pas contourner : désigner le faux agent dans trial.json ; une maquette n’est pas rendue pendant un essai ; lire trial-journal.jsonl.
- **TRIAL_INVALID** (error) — trial.json or FABRIQUE_CONSOLE_MC_TRIAL is invalid: an agent not given by absolute path, worktrees under ~/Developer/worktrees, the Herdr home in service, a missing core session. **À faire :** Mode essai (src/trial.mjs, docs/essais.md) : corriger le dossier d’état, trial.json ou la variable FABRIQUE_CONSOLE_MC_TRIAL, puis relancer ; rien n’a été lu ni lancé.
- **TRIAL_MODE_REQUIRED** (error) — This state folder is a trial folder (trial.json): run it with FABRIQUE_CONSOLE_MC_TRIAL=1, or use the real folder. **À faire :** Mode essai (src/trial.mjs, docs/essais.md) : corriger le dossier d’état, trial.json ou la variable FABRIQUE_CONSOLE_MC_TRIAL, puis relancer ; rien n’a été lu ni lancé.
- **TRIAL_NOT_CONFINED** (error) — A trial runs only in the sandbox of the trial launcher (scripts/trial.mjs): this process can write outside it or read the real home, or the launcher could not prove the sandbox (no report, an ambiguous one, a core already there or replaced). **À faire :** Lancer l’essai par node scripts/trial.mjs <dossier> -- <commande> (docs/essais.md) ; aucune variable ne saute la vérification ; rien n’a été lu ni lancé.
- **TRIAL_NOT_MARKED** (error) — Trial mode asked on a folder that trial.json does not mark. **À faire :** Mode essai (src/trial.mjs, docs/essais.md) : corriger le dossier d’état, trial.json ou la variable FABRIQUE_CONSOLE_MC_TRIAL, puis relancer ; rien n’a été lu ni lancé.
- **TRIAL_REAL_AGENT** (error) — trial.json names a real claude or codex (installed, or first in the PATH, or a link to one). **À faire :** Mode essai (src/trial.mjs, docs/essais.md) : corriger le dossier d’état, trial.json ou la variable FABRIQUE_CONSOLE_MC_TRIAL, puis relancer ; rien n’a été lu ni lancé.
- **TRIAL_REAL_ROOT** (error) — A trial never runs on the real state folder of Mission Control. **À faire :** Mode essai (src/trial.mjs, docs/essais.md) : corriger le dossier d’état, trial.json ou la variable FABRIQUE_CONSOLE_MC_TRIAL, puis relancer ; rien n’a été lu ni lancé.
- **TRIAL_TRACKER** (error) — The tracker file of the trial is missing or unreadable. **À faire :** Écrire le fichier tracker.json de l’essai (viewer, teams, projects, states, issues) puis relancer.
- **MISSION_STARTED** (refusal) — Development has already started. No approval is needed. **À faire :** La mission a passé la préparation sans copie figée (lancée avant le ticket M5) : rien n’est approuvé après coup ; relire la mission.
- **PLAN_MISSING** (refusal) — There is no plan to approve yet. **À faire :** Attendre que le Lead enregistre son plan (lead-plan), puis approuver.
- **PLAN_REVISED** (refusal) — The plan has changed. Review the updated plan before approving. **À faire :** Le Lead a réécrit son plan entre le dessin et le clic : rien n’est écrit ; relire le plan et approuver la révision affichée (un plan réécrit après l’approbation, dessiné, s’approuve de nouveau par ce même clic, M7).
- **QUESTIONS_OPEN** (refusal) — Answer the pending question or request before approving. **À faire :** Une demande de la mission attend the user (question, suggestion, verdict, texte, maquette, autorisation), ou une demande de l’issue est posée par le Lead sans ticket : y répondre, puis approuver. Rien n’est écrit.
- **LEAD_WORKING** (refusal) — The Lead is still preparing. Wait until it finishes, then approve. — Lead retenu dans son terminal (blocked, décision 87) : The Lead is waiting. Check its terminal before approving. **À faire :** Le terminal du Lead est au travail dans Herdr (décision 49 : pas d’approbation tant que le Lead prépare), ou il attend dans son terminal : attendre qu’il ait fini, ou lui répondre dans son terminal, puis approuver. Rien n’est écrit.
- **LAUNCH_UNSURE** (error) — The launch is not confirmed. Its status is being checked. **À faire :** Ne jamais renvoyer automatiquement : la copie est enregistrée, le message a pu arriver. La page dit « Checking the launch… » sans bouton (décision 72) ; le veilleur établit ce qu’il est devenu (dev-chain-tick-all) : parti (un dev lancé par la chaîne, ou la mission sortie de Prepare) ou non (aucun dev, Lead au repos dix minutes après le message : failed, un nouveau clic peut le redemander). Herdr injoignable n’établit rien.
- **LAUNCH_BUSY** (error) — Another approval is being saved. Try again in a moment. **À faire :** Un autre clic est en train d’approuver ou d’envoyer : relire la mission un peu plus tard.
- **NOT_APPROVED** (refusal) — Le plan n'est pas approuvé : aucun dev ne part avant que the user clique sur « Approve and start the dev » dans la page du ticket. Rien n'est lancé. — Une demande de dev (lead-request launch, fix ou resume, dev-launch, ou le veilleur de lui-même) sur une mission sans copie figée (ticket M5). **À faire :** Rien n’a été écrit ni lancé. Seul le clic de the user approuve le plan ; un agent ne redemande qu’après.
- **NOT_IN_COPY** (reason) — Lancement de … refusé : le ticket n’est pas couvert par l’approbation actuelle. Ne le lance pas. (décision 87) — Raison d’un ticket non lancé (dev-launch, lead-request, ou le veilleur de lui-même : `launched[].reason` « not-in-copy ») : il est absent de la copie figée (décision 77), ajouté au plan après l’approbation, ou sous-ticket que le plan approuvé ne nomme pas. Dit une fois dans le journal de la mission. **À faire :** Rien n’est lancé sur ce ticket. Il part une fois que the user a approuvé ce changement à l’écran : l’écart s’affiche dans « Drift from approved plan », et mission-reapprove (avant le départ des devs : « Approve and start the dev ») l’approuve (M7). Un ticket tenu à l’écart par une approbation (outside, décision 82) ne part jamais, même après une nouvelle approbation.
- **COPY_CHANGED** (reason) — Lancement de … refusé : sa version actuelle diffère de la version approuvée. the user doit approuver les changements avant son lancement. (décision 87) — Raison d’un ticket non lancé (`launched[].reason` « copy-changed ») : le plan d’aujourd’hui le donne autrement que la copie (agent, modèle, effort, rang, attentes…), ou l’a retiré (décision 77). Son identité lue depuis dans le tracker n’est pas un changement. Dit une fois dans le journal de la mission. **À faire :** Rien n’est lancé sur ce ticket. Il part une fois que the user a approuvé ce changement à l’écran : l’écart s’affiche dans « Drift from approved plan », et mission-reapprove (avant le départ des devs : « Approve and start the dev ») l’approuve (M7).
- **NOT_AS_APPROVED** (reason) — Lancement de … refusé : l’outil, le modèle ou l’effort demandé diffère des paramètres approuvés. Utilise les paramètres approuvés, ou fais approuver leur modification par the user. (décision 87) — Raison d’un ticket non lancé (dev-launch, lead-request, ou le veilleur de lui-même : `launched[].reason` « not-as-approved ») : un sous-ticket que le plan ne nomme pas, approuvé par mission-reapprove, demandé avec un autre outil, modèle ou effort que ceux de son approbation (M7). Un ticket du plan demandé autrement que son plan reste plan-differs. Dit une fois dans le journal de la mission. **À faire :** Rien n’est lancé sur ce ticket. Le relancer avec l’outil, le modèle et l’effort approuvés ; pour en changer, le changer dans le tracker : l’écart s’affiche, et the user l’approuve à l’écran.
- **TICKET_FAILED** (reason) — Lancement non parti : chaque ticket demandé a échoué de lui-même avant que le cœur soit sollicité (sa branche, ses questions, sa conversation), sans qu’aucun dev soit demandé (M7). Écrit dans le journal de la mission, « Launch failed (TICKET_FAILED). No dev was started. You can request the launch again. » (décision 87 ; sans code, sans parenthèses). **À faire :** Lire le détail du ticket dans le journal du suivi (« lancement en échec »), corriger la cause, puis recliquer « Approve and start the dev ».
- **MISSION_NOT_STARTED** (refusal) — The mission is still in Prepare. Use the plan’s approval button. (décision 87) **À faire :** Avant le départ des devs, le plan s’approuve, ou s’approuve de nouveau, par « Approve and start the dev » (mission-launch) ; rien n’est écrit.
- **NO_DRIFT** (refusal) — There are no changes to approve. (décision 87) **À faire :** Il n’y a rien à approuver : le plan et les sous-tickets sont ceux de la copie figée. Rien n’est écrit.
- **DRIFT_CHANGED** (refusal) — The plan has changed again. Review the latest changes before approving. (décision 87) **À faire :** L’écart a changé entre le dessin et le clic (le Lead a réécrit son plan, une correction est arrivée) : rien n’est écrit ; relire « Drift from approved plan » et approuver ce qui est affiché.
- **LEAD_ONLY** (refusal) — Refusé : lead-block est réservée au Lead ; une autre session d’agent lancée par Mission Control ne peut pas l’utiliser. Rien n’est écrit. **À faire :** La demande vient d’une session d’agent qui ne porte pas la marque de rôle du Lead (FABRIQUE_CONSOLE_ROLE) : l’agent le dit au Lead ; rien n’est écrit.
- **STOP_CHANGED** (refusal) — The stop was written again or lifted since it was read. Read it again. **À faire :** Relire l’arrêt (inbox-list) : il a été réécrit ou levé entre la lecture et l’écriture. Réécrire les essais sur l’arrêt de maintenant, ou ne rien faire s’il est levé.
- **MISSION_PAUSED** (both) — Lancement refusé : la mission est en pause. Rien n’a été lancé. Attends que the user clique sur « Resume ». Pour un changement d’étape : « Changement d’étape refusé : la mission est en pause. Rien n’a été modifié. Attends que the user clique sur « Resume ». » **À faire :** La mission est en pause (mission-pause, ticket M11) : aucun dev n’est lancé, ni par la chaîne, ni par le Lead, ni en reprise, et l’étape ne change pas (lead-request validation, lead-close). Attendre que the user clique sur « Resume » ; rien n’a été écrit.
- **PAUSE_NOT_DEVELOP** (refusal) — Pause is only available in Develop. The mission was not paused. **À faire :** La pause n’est offerte qu’en Develop (décision 106, point 7) : l’étape a changé avant le clic (une Validation, le lancement de la QA). Rien n’a été écrit ; relire la mission.
- **DB_ABSENT** (reason) — Base absente : conteneur absent ou arrêté, moteur Docker injoignable, aucune écoute, base inconnue du serveur. **À faire :** Une étape du contrôle d’environnement a échoué ; les étapes suivantes ne sont pas lancées et le résultat n’est jamais vert. Démarrer le conteneur enregistré, puis relancer le contrôle.
- **DB_NOT_LOCAL** (reason) — Une preuve de localité manque ou a changé : moteur Docker autre que celui enregistré ou qui n’est pas Docker Desktop (distant), autre image, port publié ailleurs que sur 127.0.0.1, écoute qui n’est pas Docker Desktop, relais dans le conteneur, connexion non vue de l’intérieur, preuves différentes en fin de contrôle. **À faire :** Une étape du contrôle d’environnement a échoué ; les étapes suivantes ne sont pas lancées et le résultat n’est jamais vert. Vérifier le conteneur et sa publication ; réenregistrer seulement si le changement est voulu.
- **DB_UNKNOWN** (reason) — Base non reconnue : non enregistrée, enregistrement périmé ou mal formé (enrollment-invalid : un champ manquant n’est jamais sauté), empreinte ou nom différents, session non en lecture seule, requête refusée. **À faire :** Une étape du contrôle d’environnement a échoué ; les étapes suivantes ne sont pas lancées et le résultat n’est jamais vert. Lancer environment-enroll (the user) ou corriger la configuration.
- **DB_AUTH_UNSUPPORTED** (reason) — La base demande un mot de passe sur 127.0.0.1 (détail password), ou le socket local du conteneur n’est pas en trust pour psql -w (détail socket ; ce n’est pas un échec de localité) : seule la méthode trust sur 127.0.0.1 est admise (décision 93) ; aucun secret n’est lu. **À faire :** Une étape du contrôle d’environnement a échoué ; les étapes suivantes ne sont pas lancées et le résultat n’est jamais vert. Configurer trust pour 127.0.0.1 et pour le socket local du conteneur sur la base de dev.
- **MIGRATIONS_PENDING** (reason) — Des migrations du commit contrôlé ne sont pas appliquées (pending donne leur nombre). Rien n’est lancé. **À faire :** Une étape du contrôle d’environnement a échoué ; les étapes suivantes ne sont pas lancées et le résultat n’est jamais vert. the user migre à la main, puis relance le contrôle.
- **MIGRATIONS_UNREADABLE** (reason) — Le journal Drizzle du commit est illisible, désordonné, ou un fichier SQL qu’il cite manque. **À faire :** Une étape du contrôle d’environnement a échoué ; les étapes suivantes ne sont pas lancées et le résultat n’est jamais vert. Corriger le dépôt ; l’outil ne devine rien.
- **DB_AHEAD** (reason) — La base a une migration plus récente que le journal du commit contrôlé. **À faire :** Une étape du contrôle d’environnement a échoué ; les étapes suivantes ne sont pas lancées et le résultat n’est jamais vert. Vérifier la branche contrôlée et la base de dev.
- **ACCOUNT_MISSING** (reason) — Un compte de test déclaré est absent (accounts donne oui ou non par nom). **À faire :** Une étape du contrôle d’environnement a échoué ; les étapes suivantes ne sont pas lancées et le résultat n’est jamais vert. Créer le compte dans la base de dev, puis relancer.
- **INTERRUPTED** (reason) — Le contrôle précédent a été interrompu (son propriétaire n’existe plus) ; dit dans previous, jamais pris pour un vert. Dans la vue de la page (M6 b), un contrôle mort avant sa sauvegarde : l’ancien résultat n’est pas montré. **À faire :** Une étape du contrôle d’environnement a échoué ; les étapes suivantes ne sont pas lancées et le résultat n’est jamais vert. Relancer le contrôle.
- **ENVIRONMENT_BUSY** (refusal) — Un contrôle d’environnement de ce projet tourne déjà : un seul à la fois. **À faire :** Attendre sa fin ; aucun contrôle n’est repris d’office.
- **ENVIRONMENT_NOT_READY** (both) — The environment of this project is not ready. Run the check again on the Prepare screen, then approve. Pour un agent : « Lancement refusé : l’environnement du projet n’est pas prêt (son contrôle n’est pas vert). the user doit relancer le contrôle sur l’écran Prepare. Rien n’est lancé ; ne relance pas le contrôle toi-même. » **À faire :** Le projet déclare un environnement et sa vue n’est pas verte au moment du lancement (à corriger, en cours, interrompu, inconnu, non enregistré, jamais contrôlé, périmé ; décision 111). Refusé avant toute écriture, pour l’approbation (mission-launch) et pour le premier dev de la mission (dev-launch, lead-request, launch, la chaîne). Relancer le contrôle sur l’écran Prepare, puis approuver ou lancer de nouveau. Un projet sans environnement déclaré n’est jamais retenu.
- **CONFIG_INVALID** (reason) — La configuration environment du projet est invalide (bloc inconnu, identifiant mal formé, projet de plusieurs dépôts). **À faire :** Raison d’un environnement non vert, rendue par la vue de la page (mission-read.environment, M6 b) ; le lancement est retenu tant qu’elle tient. the user corrige la configuration, puis relance le contrôle.
- **INCOMPLETE** (reason) — Le projet ne déclare pas les trois blocs database, migrations et accounts : le contrôle ne peut pas être vert. **À faire :** Raison d’un environnement non vert, rendue par la vue de la page (mission-read.environment, M6 b) ; le lancement est retenu tant qu’elle tient. the user complète la configuration, puis relance le contrôle.
- **CHECKING** (reason) — Un contrôle d’environnement de ce projet tourne en ce moment, lancé d’ici ou d’ailleurs : le dernier résultat n’est pas montré, jamais vert. **À faire :** Raison d’un environnement non vert, rendue par la vue de la page (mission-read.environment, M6 b) ; le lancement est retenu tant qu’elle tient. Attendre la fin du contrôle.
- **NOT_CHECKED** (reason) — Aucun contrôle n’a encore été fait pour ce projet. **À faire :** Raison d’un environnement non vert, rendue par la vue de la page (mission-read.environment, M6 b) ; le lancement est retenu tant qu’elle tient. Relancer le contrôle.
- **STALE** (reason) — Le dernier contrôle a été fait pour une autre configuration ou un autre enregistrement de la base. **À faire :** Raison d’un environnement non vert, rendue par la vue de la page (mission-read.environment, M6 b) ; le lancement est retenu tant qu’elle tient. Relancer le contrôle.
- **UNREADABLE** (reason) — Le dernier contrôle ne peut pas être lu, ou dit ce que le contrôle n’écrit jamais : l’état est inconnu, jamais supposé. **À faire :** Raison d’un environnement non vert, rendue par la vue de la page (mission-read.environment, M6 b) ; le lancement est retenu tant qu’elle tient. Relancer le contrôle.
- **MISSION_PAST_DEVELOP** (error) — This development is already past Develop. **À faire :** La mission a déjà passé Develop (agent QA, Validation ou fin) : la limite develop ne s’applique plus ; rien n’a été écrit.
- **MISSION_STOPS_AFTER_DEVELOP** (error) — the user asked to stop at the end of Develop: no Validation for this development. **À faire :** the user a fixé la fin de Develop comme limite : ne pas demander la Validation ; l’outil s’arrête là et le lui dit. Seul the user peut la remettre à validate (mission-stop-after).
- **STOP_AFTER_RESERVED** (error) — Refusé : seul the user (ou Pilot de sa part) fixe où s’arrête un développement. Rien n’est écrit. **À faire :** Seuls the user à la main et Pilot (sa marque de rôle) passent stopAfter à lead-launch ; le Lead et tout autre agent lancé par l’outil sont refusés. Relancer sans stopAfter.
- **CLOSE_CHANGED** (error) — La liste ou le dépôt a changé depuis son affichage ; aucun nouvel accord implicite. **À faire :** Relire mission-close-check et demander un nouvel accord avec son seen.
- **CLOSE_NOT_READY** (error) — Un contrôle de clôture bloque (QA, jugement, problème, dépôt, cible ou CI). Peut aussi survenir après un push ou une création de PR déjà enregistrés. **À faire :** Afficher les lignes fraîches de mission-close-check ; aucun traitement automatique, proposer un nouvel accord quand elles sont prêtes.
- **CLOSE_UNCERTAIN** (error) — Le résultat du push, de la création de PR ou de la fusion reste incertain. L’opération est enregistrée avant envoi et ne sera pas répétée aveuglément. **À faire :** Relire la liste et demander un nouvel accord : réconcilier un effet prouvé sans répétition, autoriser le nouvel essai si son absence est prouvée ; rester bloqué si la relecture échoue. Aucun rejeu automatique.
- **MISSION_NOT_CLOSED** (error) — Reopen exige une mission close. **À faire :** Rester sur l’étape actuelle ; aucune écriture ni opération Git.
- **CLOSE_FAILED** (error) — Refus net d’une opération de clôture (authentification ou push non-fast-forward), enregistré failed avec raison courte. **À faire :** Corriger la cause, relire la liste et demander un nouvel accord ; aucune répétition automatique ni sortie brute de credentials.
- **TICKET_CURSOR_UNSUPPORTED** (error) — Ce connecteur lit les collections entières et ne reprend pas un curseur fourni par l’appelant. **À faire :** Relire la portée, éventuellement plus étroite ; examiner la complétude et les raisons de lecture partielle.

## Fichiers d’état et versions

- **config.json** — version 1 ou 2. Document complet normalisé à la lecture ; revision est l’empreinte des octets stockés, pas un champ du document. V2 ne lance pas encore d’agent.
- **state.json** — version 1. sessions V1 ; aucun remappage implicite. Session arrêtée compte encore si stoppedAt précède launchAttemptAt ou launchUncertain=true.
- **workspace-state.json** — version 1. plans[], attempts[] requis ; fetches[] et fetchAbandonments[] facultatifs pour compatibilité. Plans, réservations, identités et étapes durables ; forcedRelease dans l’attempt, audits d’abandon dans fetchAbandonments. Pas de purge automatique. missionPreviews[] facultatif : missionId, hash des octets complets, planId, createdAt/expiresAt ; aucune exécution inventée.
- **migrations/config-v1-v2.json** — version 1. status prepared/applied, sourceHash/targetHash, target normalisée, createdAt/completedAt. Conserver avec la sauvegarde ; absence de revision dans réponse migration est volontaire.
- **backups/config-v1-<sourceHash>.json et config-save-<revision>.json** — octets de configuration source version 1 ou 2. Sauvegardes exclusives privées, aucune rétention/purge. Une sauvegarde ne doit jamais être écrasée par des octets différents.
- **operation.guard** — fichier système sans version JSON. Verrou noyau lockf sur descripteur, persistant ; ne jamais supprimer. Ancien operation.lock/owner.json seulement réconcilié par le code sous guard.
- **qa/<id>.json, qa/<id>.terminal.json, reports/<id>.md, mutations/<payloadHash>.json** — formats historiques sans version globale. Preuves QA, terminal associé, brouillon local, journal de mutation pending/applied/rejected/uncertain. Ne pas les convertir en réservations V2.
- **worktrees et patches V1 ; worktreesRoot V2 ; métadonnées .git** — formats Git, pas un schéma JSON du produit. En V2 marker fabrique-console:<preparationId>:<instanceId>, identité source/common-dir dev/ino, identités des ancêtres revendiqués. Aucune suppression de worktree Git par cleanup.
- **cache/*.json et cache/ticket-mcp-<digest>.json** — caches de lecture historiques sans version globale. Résultats Tracker et dates de cache ; chemins dérivés de l’identité/clé. Aucune conversion par les actions de configuration. Ne pas copier ces données dans une configuration ou un rapport public.
- **mcp-oauth/operation.guard, keychain-build/operation.guard et bin/ticket-keychain-<hash>** — verrous/artefacts d’intégration, pas un état métier V2. Authentification MCP conservée séparément au Trousseau : record interne version 1, opaque pour les écrans. Aucun secret sur stdout, dans le catalogue ou dans les fixtures de ce lot ; aucun accès au Trousseau réel requis pour la revue.
- **proofs/<qaId>.intent.json et proofs/<qaId>.json** — C5 enrichi, enregistrements immuables. Intention avant lancement, puis preuve achevée capturée par le worker avant/après le spawn. Publication atomique, exclusive et synchronisée via le stockage durable ; jamais de modification à la lecture, pas de purge. Une intention sans fin reste inconnue. Le journal QA reste distinct et mutable pour la compatibilité.
- **missions/<UUID>.json** — schemaVersion 1. Snapshot C3 immuable, permissions 0600, parent 0700. Publication exclusive fsync avant son entrée missionPreviews. Aucun hash auto-déclaré ; le registre lie le hash complet. TTL 15 min, historique conservé sans purge automatique. Un orphelin seul n’accorde aucun droit.
- **state/** — version 1. Dossier du veilleur : watcher.json {pid,startedAt,at} (battement et verrou), watcher.lock/ (mutex du verrou, éphémère), snapshot.json, my-issues.json, issues-<key>.json (toutes les issues de la team) ({at,data}), lease, poke, stop. Écrit par le veilleur et la barre V3 seulement ; les écrans lisent, jamais la source de vérité des sessions (state.json).
- **<worktree-ticket>/.fabrique-console/ticket.json** — 1. Préparation locale preparing/ready : issuePath et branche d’intégration, ticket, branche dédiée, chemins, common-dir et baseCommit figée de chaque dépôt. La sessionId est une trace de création, pas une autorisation : une nouvelle session PO de la même issue reprend ces bases. Le dossier des rapports reste celui de l’issue, aucune suppression automatique après merge.
- **state/ids.json** — sans version. {M,Q,I,D} : compteurs des identifiants durables, incrémentés sous verrou (state/operation.guard).
- **state/missions/M-<n>.json** — sans version (lot 1 de la V4). Une mission durable (voir mission-create), écriture atomique sous verrou (state/missions/operation.guard). À ne pas confondre avec missions/<UUID>.json, les aperçus. Champ plan facultatif (format 2, voir lead-plan) : le plan structuré du Lead ; la chaîne et les écrans en tirent les tickets (tickets[]), et de rien d’autre. Sans lui, la mission est de l’ancien format ou pas encore planifiée : rien n’en est lancé ni piloté ; avant le plan, tickets[] montre seulement les sous-tickets que le tracker a, sans rang ni attente. Champ trackerSeen (M7) : les sous-tickets du tracker vus avant la première approbation (par lead-plan ou par la chaîne), jamais oubliés ensuite : la copie en tire outside. Champ driftAt (ticket M7) : pour chaque écart de la copie figée (par son ticket, plan:<partie> ou branch), {sig,at} : la forme de l’écart et l’instant où le moteur l’a vue, écrit sous le verrou de la mission quand lead-plan enregistre un plan ou que la chaîne enregistre les tickets ; un écart disparu est oublié. Clôture automatique : closure et closureHistory tels que décrits par mission-approve-close et mission-reopen. closureCycle invalide les accords antérieurs à un Reopen.
- **state/missions.json** — {at,data}. Publié par le veilleur après chaque pas de la chaîne : data = missions actives avec on et journal court, ou {error}. Les écrans V4 ne lisent que ce fichier.
- **state/devchain-M-<n>.json** — sans version. Clés réservées, fil des événements, chemins, base notée avant chaque ticket (bases), aperçus de la chaîne d’une mission, et couloir des devs : lane (null : libre ; ou {ticket,launch,tab:"asked"|"seen",terminal}) et laneSeq (numéro du dernier lancement). Lu strictement : absent = mission neuve ; illisible ou d’une autre forme = INVALID_DATA, rien n’est lancé. Un fichier sans lane qui porte un lancement (on, dev|, ou une marque resumed|, preparing|, asked|, shown|, stopped|) est celui d’une mission de l’ancien mécanisme : bloquée (DEV_LANE_OLD), sans remise à plat possible. devchain-<session>.json pour une session de la première version, lu tel quel et jamais déplacé tant que sa mission n’a pas de plan. La file des notes au Lead (digest) ne contient que des références (décision 61) : {ticket,kind,…}, kind parmi canceled, reported (commit seulement s’il est une empreinte), conflict, refused (reason seulement s’il est un code), accepted (notes:boolean), fixing. Chaque ligne envoyée est écrite par la chaîne à partir de ces champs ; la raison donnée par git d’un refus de fusion et les fichiers en conflit restent dans le journal (log, detail) de ce fichier, que la ligne nomme. Une ligne d’une autre forme (une ligne {note} d’une version précédente) n’est jamais envoyée : elle est mise de côté (withheld). À la bascule, digest et withheld sont copiés dans archive/legacy-<date>/state/devchain-digest/<mission>.json puis vidés.
- **state/agent-asks/<ticket>-<terminal>-<ms>-<n>.json** — sans version (décision 61). Ce qu’un agent arrêté demandait quand the user en a parlé (agent-discuss) : {ticket,agent,mission,at,question,command,details}, tels que lus dans son terminal. Écrit une fois, jamais réécrit ni relu par le moteur : c’est le fichier que nomme le message au Lead ou au Pilot, qui le lit comme une donnée.
- **state/questions/Q-<n>.json** — sans version (lot 1 de la V4). Question d’un agent, durable : de l’envoi au Lead à la prise en compte de la réponse. Un fichier ask donne une seule question (champ source). Ses mots, ses réponses et son auteur ne changent pas ; la réponse de the user y est posée par la demande dont elle vient, et par rien d’autre. Le veilleur ne livre ni ne relaie une réponse de the user qu’aucune demande de state/requests n’a posée dans cette question (question d’avant la bascule) : la question est dite incertaine (unsure) et son ticket est signalé une fois dans l’Inbox (alerte stuck, cause uncertain). Une question dite unsure n’est plus livrée par le veilleur. À la bascule, une question qui porte une réponse de the user qu’aucune demande n’y a posée (en place ou mise de côté pour le relais) est déplacée telle quelle dans archive/legacy-<date>/state/questions/.
- **state/requests/I-<n>.json** — sans version (demandes immuables). Une demande faite à the user, écrite une fois : ses mots, les réponses qu’elle offre, la question d’où elle vient, celle où va sa réponse, celle qu’elle remplace (replaces) et son empreinte (version, identifiant compris). À côté : son état, une erreur, discussedAt et sa réponse (answer), écrite une fois par requests.answer et jamais réécrite. Seul src/requests.mjs écrit ce dossier, sous un seul verrou.
- **state/legacy-archive.json** — sans version (décision 60). Bascule de l’ancien stock : {state:"moving"|"done",folder:"archive/legacy-<date>",startedAt,doneAt}. Écrit avant le premier déplacement, puis « done » une fois tout dans l’archive. Absent : la bascule n’est pas faite. « moving » : elle reprend là où elle s’était arrêtée, dans le même dossier.
- **archive/legacy-<date>/state/…** — ancien format, lecture seule. L’ancien stock déplacé à la bascule, sous ses noms d’origine : inbox/, decisions/, questions/, devchain-digest/. Hors de tout chemin lu pour transmettre : seule src/requests.mjs le lit (par src/legacy-archive.mjs), pour lister les anciennes demandes (inbox-list) et refuser d’y répondre. Rien n’y est écrit après la bascule ; rien n’en est jamais remis dans state/.
- **state/inbox/I-<n>.json** — ancien format, archivé à la bascule. Demandes d’avant la bascule. À la bascule, le dossier entier est déplacé tel quel dans archive/legacy-<date>/state/inbox/ ; plus aucun code ne lit state/inbox. Celles qui n’étaient pas résolues sont listées par inbox-list depuis l’archive (legacy:true, authorizes:false) : réponse certaine (une décision qui nomme la demande avec son empreinte d’alors, et une seule question qui la nomme) ou « incertaine » ; en consultation seulement, aucune autorisation n’en est reconstituée et rien n’en est livré. Un fichier écrit là après la bascule n’est ni lu ni déplacé.
- **state/decisions/D-<n>.json** — sans version (lot 1 de la V4). Décision de the user : copie, pour l’historique, de la réponse écrite dans sa demande, avec la version (seen) sur laquelle elle a été donnée et la commande qui l’a enregistrée (via) ; écrite une fois, jamais réécrite. Les décisions qu’aucune demande n’a enregistrées telles quelles (celles d’avant la bascule) sont déplacées dans archive/legacy-<date>/state/decisions/ à la bascule ; requests.decisions et vouchedDecisions ne lisent que ce dossier.
- **state/inbox.json** — sans version (lot 1 de la V4). Publication du veilleur pour les écrans : {at,data:{items}}, ou {at,data:{error}} si la lecture a échoué.
- **<worktree>/.fabrique-console/<ticket>.ask-<horodatage>.json** — sans version (lot 1 de la V4). Question d’un agent, écrite par fabrique-console-report ask ; le veilleur en fait une question Q-n.
- **<worktree>/.fabrique-console/<ticket>.block-<horodatage>.json** — sans version (M10). Arrêt signalé par un dev, écrit par fabrique-console-report block (reason, migration?, at) ; le veilleur en fait un ticket arrêté dans l’Inbox (type stuck, cause blocked), à partir de cet instant, et prévient le Lead une fois.
- **state/pilot.json** — sans version (lot 4 de la V4). Ce sur quoi Pilot est ouvert : la demande de l’Inbox et son terminal.
- **state/devlane/M-<n>/operation.guard** — sans contenu. Verrou noyau (lockf) du couloir des devs d’une mission, tenu pendant tout un lancement ou tout un pas du veilleur ; tombe seul si le processus meurt. Jamais supprimé à la main.
- **environment/<projet>/enrollment.json** — version 1. Base de dev enregistrée par the user : programme et socket Docker, identité du moteur (ID, OperatingSystem, Name), identifiant complet et image du conteneur, port, base, utilisateur, empreinte de system_identifier.
- **environment/<projet>/last.json** — version 1. Dernier résultat du contrôle d’environnement, lié au sha, à l’empreinte de la configuration et à celle de l’enregistrement ; jamais de sortie de programme.
- **environment/<projet>/.running-<id>** — sans version. Marque d’un contrôle en cours, une par contrôle ({id,pid,at}, id : 24 caractères hexadécimaux), écrite avant d’essayer le verrou noyau operation.guard et retirée par ce seul contrôle après la sauvegarde de son résultat, ou aussitôt s’il est refusé (ENVIRONMENT_BUSY). Restée là, verrou libre = un contrôle a été tué, « interrupted » ; le contrôle suivant qui finit retire les marques des contrôles morts (processus disparu), jamais celle d’un contrôle peut-être vivant. Un ancien environment/<projet>/.running (version d’avant) compte comme une marque morte. Elle ne sert jamais de verrou.
- **environment/<projet>/operation.guard** — sans contenu. Verrou noyau (lockf) du contrôle d’environnement du projet, tenu pendant tout un contrôle ou un enregistrement ; tombe seul si le processus meurt. Un seul contrôle à la fois (ENVIRONMENT_BUSY). Jamais supprimé à la main.
- **state/budgets-<mission>.json** — 1. Alertes et arrêts de budgets durables, instant et compteurs figés pour la déduplication ; aucune session ni secret.
- **state/traces/<key>.terminal** — liaison immuable. Adresse rendue au lancement et labels d’appartenance relus du core. Absence ou échec de liaison : jamais de terminal deviné.

## Parcours à respecter

Édition : read-config → conserver config+revision → éditer → config-save({config,baseRevision:revision}). CONFIG_CONFLICT => recharger et résoudre ; ne jamais envoyer automatiquement la nouvelle revision avec un ancien document.

Conversion : config-migrate({confirmed:true,worktreesRoot:"/chemin/absolu"}) → relire read-config → compléter équipe/profils/vérification des dépôts. Pas de conversion implicite à l’ouverture ; le mode de transport existant est préservé.

Préparation : worktree-plan(PlanInput) → présenter base et écritures → worktree-prepare({planId,confirmation si requise}). Réponse perdue : même planId ou worktree-reconcile(preparationId). worktree-plan ne réserve pas ; prepare recharge Tracker/configuration/base et peut refuser PLAN_CHANGED.

Fin : worktree-reconcile → si prepared ou failed-certain, worktree-release({preparationId,confirmed:true,expectedHash:preparationHash}). Cette sortie libère la capacité seulement, pas les fichiers/branche. Revue terminée ne clôture jamais Tracker.

Échec partiel : si cleanupProposal présent, afficher commandes et confirmer son hash avant cleanup, puis reconcile/release. Sinon préserver les fichiers cachés/ignorés et commits, nettoyage Git manuel et de la branche, prune --dry-run si entrée obsolète, reconcile/release. Pas de git unlock/remove exécuté par l’outil.

État impossible à prouver : inspecter puis sortie forcée explicite confirmée avec empreinte courante ; audit acteur/date/ancien état. Elle ne supprime rien, n’arrête rien, n’efface pas les collisions et n’est jamais automatique. Si preuve normale existe : FORCE_NOT_REQUIRED. Si worker identifié vivant : WORKER_ACTIVE.

Fetch incertain : fetch-inspect → attendre preuve de fin puis refaire plan, ou fetch-abandon explicitement confirmé. Chef mort ne prouve pas la fin de ses enfants ; une identité inconnue reste incertaine. Autres aperçus attendent brièvement un fetch actif puis refusent de façon rejouable.

Clones partiels : le contrôle avant création examine le commit et SON arbre uniquement, --no-lazy-fetch et --no-walk ; un blob historique absent reste absent. Si l’arbre cible manque d’objets, refus propre BASE_TREE_NOT_MATERIALIZED avec matérialisation manuelle requise (pas d’hydratation implicite de l’historique). Un GC concurrent peut encore faire échouer add et imposer réconciliation.

Compatibilité des reprises : un ancien attempt est restitué sans enrichissement silencieux de sa base. Les écrans doivent tolérer les métadonnées de vérification absentes sur StoredBase ; seul un nouveau worktree-plan produit le DTO Base courant complet. Ne pas confondre observation historique et fraîche.

MCP existant : si statusType n’est pas fourni, list/detail résolvent le statut dans list_issue_statuses de la même équipe, par identifiant ou par nom exact quand id est absent. statusClassification est additif (source, reason). Échec, nom absent/ambigu ou type non reconnu : state.type=unknown, jamais un rapprochement approximatif. Le cache de ces lectures est versionné pour ne pas réutiliser les anciens états inconnus.

Lectures enrichies : scope détermine l’équipe depuis key, filtre éventuellement un epic par projectId, exclut explicitement les tickets archivés et les sous-équipes. Les tickets liés hors équipe sont limités à identifier/state ; aucune exploration récursive. Un document exige d’abord la preuve de portée du projet puis du document ; son contenu ne se charge que sur demande.

Partiel : chaque connexion est paginée, y compris labels/enfants/deux sens de relations/jalons/documents. 50 nœuds par page racine, amorce imbriquée de 3 ; 20 pages par connexion, 200 requêtes (reprises comprises), 10 000 entités par occurrence et budget interne 23 s. Un tableau null signifie non lu ; aucun total/aucun tant que la portée requise reste incomplète. Une partialité imbriquée remonte à la collection et au résultat racine. Limites et causes sont publiques ; pas de cache partiel déguisé.

Cache enrichi : cache/ticket-enriched/<empreinte avec domaine dédié>/<empreinte paramètres>.json ; répertoires 0700, fichiers 0600, écriture atomique et date de relevé, TTL 60 s. Identité de clé figée durant toute l’opération ; purge des autres compartiments au prochain accès. Une ancienne lecture concurrente peut recréer son compartiment après purge : il sera purgé au prochain accès et n’est jamais servi à une autre identité. Le contrôle de réflexion du secret détecte la valeur exacte, pas toute représentation arbitrairement encodée.

Budget enrichi : inclut provider, cache, réseau, corps et reprises ; marge de 7 s sur les 30 s de l’interface. HTTP 429 et erreurs GraphQL de débit (même HTTP 400), complexité et en-têtes de reprise sont traités ; jamais plus de deux reprises ni d’attente au-delà du budget. Les messages/corps d’erreur Tracker sont masqués. X-Complexity est exposé comme mesure observée lorsque Tracker le fournit ; null ne signifie pas zéro. Voir ticket-enriched.md pour la borne théorique des requêtes et les vérifications sans compte réel.

Décisions provisoires en 3a : sans clé les lectures enrichies sont indisponibles ; le partiel est rendu avec indicateur ; les liens hors équipe sont minimaux ; les archivés sont exclus et cette exclusion est dite ; le message de clone partiel reste à arbitrer. Toute vérification réelle Gamma/Beta nécessite l’accord de the user.

Preuves 8b : après qa, lire test-proofs avec sessionId ou issueId ; ne jamais interpréter un ancien passed brut comme preuve valable. Les fichiers ignorés, dépendances et environnement ne sont pas audités. Les observations avant/après ne détectent pas une modification transitoire restaurée entre elles. Les limites de lecture rendent inconnu plutôt que de produire un succès incomplet. Les rapports de revue portent le commit source examiné ; refaire propose après un nouveau commit révèle la péremption sans fabriquer le paquet C6.

Correctifs après revue 8b : seul le nom de fichier QA UUID validé détermine les chemins de preuve ; l’identifiant contenu dans le JSON doit correspondre, sinon INVALID_DATA. Les raisons d’observation des actions QA/preuves sont distinctes de leurs erreurs levées. captureCode n’exécute plus git status/diff et ne déclenche pas filter.*.clean ; d’autres actions historiques, notamment inspectGit/propose, emploient encore git status et ne bénéficient pas de cette neutralisation. L’empreinte v2 ajoute le type des fichiers et ne convertit pas silencieusement les anciennes empreintes.

Volume 8b : captureCode ne démarre plus check-ignore par dossier. Les ensembles de chemins sont transmis sur stdin, enregistrements NUL, sans shell ; élager seulement un dossier réellement ignoré, pas un dossier dont Git a compacté les seuls fichiers ignorés (respect des négations). Les seuils 10 000 entrées, 512 Mio, 16 Mio par commande et 8 s sont des bornes de refus prudent, pas une promesse de mesure sur tout dépôt. Un dossier vide non suivi reste hors empreinte mais dans le coût de parcours.

Chemins 8b : check-ignore reçoit ./<chemin relatif> et le retour est validé contre exactement ces formes préfixées avant reconversion. Cela vaut pour les dossiers ignorés et les fichiers spéciaux, notamment :(top)x et :colon. Git 2.54 refuse --literal-pathspecs pour cette commande ; ce drapeau n’est pas utilisé. La sonde de volume vérifie un nombre de processus Git borné indépendamment des 3 000 dossiers : elle refuse encore le parcours historique par dossier, sans faire du plafond réel de 8 s une assertion de vitesse dépendant de la charge.

Cache enrichi concurrent : une acquisition BUSY est reprise avec pauses bornées de 25 ms maximum, dans le budget restant de 23 s. Le verrou global operationLock conserve sa sémantique de refus immédiat pour les autres actions. Budget épuisé : enveloppe partielle deadline ; aucun réseau n’est commencé pendant l’attente.

Parent archivé : parent=null accompagne obligatoirement une raison archived-excluded au chemin du parent ; le ticket, sa collection et la réponse sont partiels, total=null. Cela distingue un parent exclu d’une absence de parent sans divulguer son identifiant, son texte ou son équipe.

Préparations Git : Git >= 2.45 est requis pour --no-lazy-fetch. Un Git antérieur ne peut pas garantir les observations sans téléchargement implicite ; utiliser cette version minimale avant les actions worktree. La machine de validation utilise Git 2.54.

Qualification A4 : appeler ticket-qualify {key,issueId}. Contrôler ready.ok, ready.verified, les six checks et source, pas seulement le transport ok:true. Les choix d’agent/niveau viennent des seuls noms de labels ; prêt/agent:/niveau: sont comparés en NFC et sans casse, provisoirement, sans autre tolérance ; aucun défaut depuis preferredAgent, le texte ou l’appelant. Les associations équipe/projet et labels/aliases réutilisent previewRepository pur : plusieurs aliases d’une même clé sont admis, plusieurs clés sont ambiguës, dépôt unique sans label accepté selon le contrat 1.3. Aucun accès Git ne vérifie encore le dépôt physique.

Rubriques A4 : titres H2 A1 (Besoin, Résultat attendu, Critères d’acceptation, Vérification) ; Bug/Bugs ou Investigation sélectionne A2 (Constat, Gravité, Reproduction, Cause, Critères d’acceptation, Vérification). Les titres H1–H6/Setext ne remplissent pas un corps ; H1/H2 inconnus le ferment, H3–H6 le gardent ouvert pour le texte qui suit. Analyse par parcours bornés, sans regex de liens ou de titres à retour arrière. Après retrait du balisage, destinations et définitions de liens sur une ligne, appels de notes et notes vides, espaces invisibles et entités, il faut au moins une lettre ou un chiffre de texte réel. Ponctuation/symboles/contrôles seuls ne suffisent pas. Les placeholders connus restent manquants, y compris en libellé de lien/image. Un sous-titre suivi d’un paragraphe, une URL automatique http(s), du code en ligne et une note remplie sont admis. Choix provisoire : contenu visible d’un bloc de code ou d’une ligne de code indentée admis, même sans lettre/chiffre ; aucun code exécuté. Ce contrôle formel ne prouve ni le sens d’une cause ni la qualité des preuves.

Dépendances A4 : seuls les prérequis blockedBy bloquent. completed/canceled clôturent ; backlog/triage/unstarted/started restent ouverts. État inconnu ou collection partielle => unverified. Décision the user : même archivé, un prérequis reçu est projeté par identifier/state uniquement (comme un lien hors équipe), sans titre, description, équipe ni exploration supplémentaire. Son état completed/canceled lève la dépendance ; état ouvert => missing ; état absent/inconnu => unverified. Les autres lectures gardent les archivés exclus ; un lien sortant archivé reste exclu et explicitement partiel (archived-excluded), un parent archivé reste partiel.

Transition 4.1 : the user crée manuellement les six labels A3 dans chaque équipe et pose prêt ; aucun label créé ni contournement fourni par cette lecture. Sans eux, le futur circuit ne pourra lancer aucun agent. Le plan Standard/Fort, l’approbation exacte du plan, les modèles/efforts, la base et les plafonds sont des contrôles de mission ultérieurs (lots 4.2/4.3), pas des faits inventés par ready.ok. Les anciennes routes de lancement ne sont pas modifiées par 4.1.

Qualification, choix provisoire après revue 4.1 : seuls prêt et les familles agent:/niveau: ignorent la casse et la forme canonique NFC/NFD. Aucun trim, accent supprimé, synonyme ou autre tolérance. Les doublons normalisés restent ambigus ; les labels/aliases de dépôt gardent leur comparaison exacte du lot 1.3. issueId exige issue.id interne : XJ-12 ne donne jamais prêt par rapprochement approximatif.

Bornes de qualification après revue 2 : description ≤32 768 unités UTF-16 et chaque ligne ≤4 096 unités hors séparateur LF, CRLF ou CR isolé, avant toute analyse Markdown. Dépassement => règle 4 unverified avec QUALIFICATION_DESCRIPTION_LIMIT, jamais satisfied. Les parcours consomment les caractères sans retours arrière ; tests dans des processus enfants bornés pour les liens non fermés, balises/crochets répétés et titres suivis de milliers d’espaces. Aucune taille excessive n’est tronquée pour annoncer prêt. Tests des bornes exactes 32 768/32 769 et 4 096/4 097, dont paires de substitution ; les tests de durée vérifient aussi le résultat et sa raison.

Limites connues de présence : ce n’est pas un rendu complet Markdown/HTML. Les entités numériques valides sont décodées ; amp/lt/gt/quot/apos sont reconnus, les autres entités nommées sont neutralisées (un mot exprimé seulement en entités comme &eacute; peut donc être refusé). Un code en ligne non fermé ou une balise malformée peut demander une phrase claire. « 2024. » seul reste interprété comme marqueur de liste vide ; écrire une phrase ou du code explicite. Note remplie, <https://…>, `<br>` et ligne de code indentée sont couverts comme contenus plausibles. Limite de source distincte, constat 7 : une relation malformed dont le ticket lié est null peut encore être filtrée sans cause ; le schéma Issue! et le rejet des erreurs GraphQL rendent ce cas improbable, pas une garantie défensive ajoutée dans ce lot.

Missions 4.2 : mission-preview recharge le même ticket enrichi que la qualification, puis le plan explicitement sélectionné par identifiants. Standard/Fort sans plan refusé, Léger peut omettre le plan. Aucun plan choisi depuis une prose/URL ni premier document deviné. Le profil vient de profiles.dev[tool][level], avec sa version ; les QA complets viennent du dépôt sélectionné. Les commentaires sont exclus. La branche Tracker n’étant pas exposée par 3a, le fallback sûr du lot 1 est employé, sans déduction depuis le titre.

La mission fige ticket/critères/vérification, contexte/plan intégral, sélection/configRevision, profil/QA, dépôt physique/common-dir/identité, base vérifiée ou confirmation requise, worktree/branche proposés et consigne exacte. Les plafonds restent dans l’enveloppe. La consigne distingue le contrôle des données balisées, échappe < et > dans tout le JSON distant, interdit de lancer d’autres agents, refuse >32 Kio et toute réécriture par le filtre. Ce balisage ne garantit pas à lui seul l’absence d’injection chez un outil.

Capacité 4.2 : réservations locales actives et V1 comptées sauf arrêt explicite postérieur au dernier lancement. La file de revue est au moins n, total non mesuré ; aucune reprise du classement de noms de statut de l’écran. Choix provisoire à confirmer par the user : j’ai vu seulement si la borne basse atteint le plafond ; alternative = le demander aussi quand seul le total est inconnu. Le plafond global dev et les collisions restent des blocages distincts à revalider par 4.3.

Confirmation future : seule une mission publiée, non expirée et dont le hash des octets est recalculé pourra être citée par 4.3. La CLI locale n’authentifie pas l’humain : un autre processus du même utilisateur peut appeler ses actions ; les hashes ne sont pas des signatures contre un utilisateur capable de modifier simultanément tous les fichiers privés. Aucun lancement, exécution C4 ni cycle de revue construit dans 4.2.

Cadre de qualification (revue 3) : la règle sert à ne pas déclarer prêt un gabarit vide ou rempli par accident. Elle ne prétend pas résister à quelqu’un qui écrit exprès du remplissage : une lettre suffit. Elle ne valide ni la qualité du texte ni le sens du ticket ; ce n’est pas un moteur de rendu Markdown/HTML. Les destinations de lien entre chevrons, y compris une parenthèse interne ou un chevron échappé, n’apportent aucun corps. CR isolé sépare les rubriques comme LF/CRLF. Les échappements ASCII de ponctuation hors code sont retirés pour reconnaître les gabarits inchangés.

Limites connues conservées après revue 3 : le contenu script/style/template, une instruction PHP et les destinations/titres d’une définition de lien sur plusieurs lignes peuvent encore être comptés comme texte. Un gabarit réparti sur plusieurs lignes ou répété n’est pas reconnu sémantiquement. Faux refus sûrs : séparateur immédiatement après le titre d’une rubrique, liste puis --- contigus, BOM au début de la description, émoji seul sans lettre/chiffre ; une phrase claire évite ces cas. Le texte alternatif d’une image reste compté même s’il n’est pas affiché comme un paragraphe. Les autres limites déjà décrites (dont relation issue:null préexistante) restent valables.

Compte rendu agent : depuis la racine du worktree, node <chemin absolu du dépôt Mission Control>/scripts/fabrique-console-report.mjs dev --ticket XJ-690 --commit <sha> --repo admin --summary "…" ; review --ticket XJ-690 --n 1 --commit <sha> --verdict accepted|changes_requested --summary "…" [--note "…"]… . --repo vaut le dépôt du dernier rapport dev pour une revue, sinon « . ». --worktree <racine> permet un appel depuis un autre dossier. Le SHA court est résolu en SHA complet existant dans la racine Git indiquée ; branch est lue localement (null si détaché). Fichier .fabrique-console/<ticket>.dev.json ou .review-n.json publié par remplacement atomique, ≤64 Ko comme le lecteur. Aucun push, état Tracker ou terminal modifié. Le chemin absolu du script suffit : aucune installation ni modification de ~/.local/bin requise.

Branches par ticket : ticket-branch {sessionId,ticket:"XJ-690"} crée le voisin <ISSUE>-<TICKET>, branche xj-689--xj-690 depuis la branche issue xj-689 (séparateur -- confirmé par Claude le 2026-11-09 ; xj-689/xj-690 est impossible avec xj-689). Les bases restent figées au rejeu ; ticket suivant créé après fusion ⇒ base mise à jour. La commande de rapport retrouve .fabrique-console/ticket.json même depuis un dépôt imbriqué et écrit le rapport central de l’issue ; elle ajoute baseCommit et un snapshot des SHA de repositories[]. La revue compare chaque baseCommit au commit du ticket, jamais le diff global de l’issue. Le merge refuse les SHA avancés après rapport, les mauvaises branches, les fichiers sales et les opérations Git manuelles ; il ne supprime rien et n’annule jamais une opération préexistante. Le verrou sérialise les actions du layout, sans prétendre bloquer les commandes Git manuelles concurrentes. Git avec merge-tree --write-tree requis (vérifié localement).

Bascule (décision 60) : au premier démarrage de cette version, avant toute lecture de l’état (décision 61) : toute opération des demandes, toute lecture ou écriture des questions quel que soit le lecteur (mission-read, Pilot, le relais), mission-read lui-même, le relais (étape de la conversation) et la chaîne (dev-chain-tick, dev-chain-tick-all, lancement), l’ancien stock est archivé une fois dans archive/legacy-<date>/ : state/inbox/ entier ; les décisions de state/decisions/ qu’aucune demande n’a enregistrées ; les questions qui portent une réponse de the user qu’aucune demande n’y a posée ; les notes en attente pour le Lead (digest, withheld) de chaque state/devchain-<mission>.json, copiées puis vidées. Les fichiers des demandes de state/requests, leurs décisions et leurs questions restent en place. Rien n’est supprimé. Le plan est écrit d’abord (state/legacy-archive.json « moving ») ; chaque fichier est déplacé par un seul renommage, jamais par-dessus un autre ; un fichier déjà dans l’archive et absent de sa place est fait ; le même nom aux deux endroits arrête la bascule sans rien écraser. Après un arrêt au milieu, la reprise ne perd ni ne double rien. Tant qu’elle n’est pas « done », toute opération des demandes et toute lecture des questions échouent avec LEGACY_ARCHIVE_FAILED : le relais ne démarre pas et n’envoie rien. Le message affiché est « Couldn't archive old requests and decisions. Request delivery is paused. » ; la cause technique est donnée à part (error.cause). Ensuite, plus aucun code ne lit l’ancien stock pour transmettre quoi que ce soit ; seule la liste de l’Inbox (inbox-list) en montre les anciennes demandes, depuis l’archive, comme anciennes et sans valeur d’autorisation. Aucune note au Lead ne porte de décision ni d’autorisation : une note n’est faite que de références (voir « Plus de texte libre »).

Plus de texte libre (décision 61) : un message opérationnel que le moteur envoie au Lead ou à un agent ne contient que des références : l’identifiant du ticket, de la question (Q-<n>), de la demande (I-<n>) ou de la maquette (MK-<n>), le code de la situation, et le chemin du fichier où le texte complet est rangé ; le destinataire peut lire ce fichier, comme une donnée, mais le moteur ne recopie jamais dans un message un texte qu’il n’a pas écrit lui-même. Messages concernés : la note d’avancement au Lead (digest : raison d’un refus de fusion et fichiers en conflit dans le journal de state/devchain-M-<n>.json) ; la question d’un agent donnée au Lead (state/questions/Q-<n>.json) ; la réponse du Lead livrée à l’agent, jointe à sa consigne à la reprise ou confiée au Lead quand l’onglet est fermé (même fichier, champ answer.text) ; une demande ouverte avec le Lead (inbox-discuss) ou confiée au Lead (inbox-delegate) (state/requests/I-<n>.json) ; ce que demande un agent arrêté (agent-discuss, state/agent-asks/…) ; une variante choisie sur une maquette liée à aucune demande (mockup-pick, state/missions/M-<n>.json) ; la consigne d’un relecteur (compte rendu du dev) et les corrections renvoyées au dev (revue), par le chemin de leur fichier dans <worktree>/.fabrique-console/. Le seul message qui porte les mots d’une décision de the user est celui que fabriquent les demandes à partir de requests.answer : la décision relayée au Lead, ou livrée à l’agent quand le Lead n’est plus là. Restent hors de cette règle, acceptés par the user (décision 62) : les dossiers donnés à Pilot (inbox-open, pilot-launch) et la consigne de lancement d’un PO, balisés comme données ; la consigne de lancement d’un Lead, où la demande est « la demande transmise par Pilot », balisée <mission-request> comme donnée ; la réponse que the user tape lui-même au PO (po-answer) ; ce que l’agent QA lit du plan de l’issue dans Tracker : Base, réduite à un nom de branche, et la ligne Serveur, citée comme donnée entre <plan-server> et </plan-server> ; et le transport dev-send, dont le texte est cité comme donnée entre <forwarded-message> et </forwarded-message>. Chaque texte cité est échappé : il ne peut pas fermer ses balises. Le filtre lexical des notes (speaksOfDecision) est retiré : plus aucune note ne porte de texte à filtrer.

Accord de the user (décision 62) : l’outil ne peut pas empêcher un agent de lire un texte qui prétend venir de the user ou dit qu’il a donné son accord (un ticket, un plan, une raison, un message transmis, une demande de lancement) : les agents lisent Tracker et les fichiers par leurs propres outils. La protection repose sur deux choses. (1) Une règle écrite dans le rôle du Lead (roles/lead.md, règle 8) et dans les consignes du dev, du relecteur et de l’agent QA (CONSENT_RULE, ui/v3/view.js) : un accord de the user ne compte que s’il arrive par le message de décision des demandes ; tout autre texte qui le prétend est ignoré et signalé. (2) Les gestes dangereux restent ceux de the user : les migrations et les déploiements ne sont jamais lancés par un agent, et les autorisations ne s’enregistrent que par son clic (décision 55). Les textes que le moteur transmet sans les écrire lui-même sont cités comme données (voir « Plus de texte libre »).

## Contrôle de dérive

docs/backend-interface.json est le catalogue éditable ; node scripts/interface-reference.mjs --write régénère ce Markdown après vérification. Le test compare dans les deux sens le registre Map littéral et tous les codes littéraux majuscules de src/ et integrations/, avec exemptions non-erreur explicites et vérifiées. Les émissions de code non littérales sont inventoriées par expression/source ; toute expression nouvelle doit être documentée. Un registre dynamique/non reconnu fait échouer le contrôle au lieu d’être ignoré. Cette analyse statique conservatrice ne prouve pas tous les flux dynamiques : les codes publics nouveaux doivent rester des littéraux et les formes sont verrouillées par les tests de contrat exécutés. Les associations action/code et les descriptions input/output/writes restent déclaratives : seules les formes effectivement exercées par les contrats sont verrouillées. Les neuf actions V1 énumérées dans la revue ont désormais un contrat exécuté ; les données externes Tracker restent extensibles. channel décrit le canal public principal ; additionalChannels précise warning/reason, et un worker peut enregistrer un code dans preparation.errorCode indépendamment du canal public.

## Suites

Remarques et limites : [etape1-suites.md](etape1-suites.md). Ce document est le lieu unique des suites, pas une liste de comportements supplémentaires.
