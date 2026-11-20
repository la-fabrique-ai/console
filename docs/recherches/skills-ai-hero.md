---
titre: Skills « AI Hero » de Matt Pocock — lesquels utiliser, et comment
statut: en vigueur
date: 2026-11-20
auteur: recherche
---

# Skills « AI Hero » (plugin mattpocock-skills 1.3.1)

Source lue : `~/.claude/plugins/cache/claude-plugins-official/mattpocock-skills/1.3.1/`. 38 skills : 20 engineering, 7 productivity, 4 misc, 7 in-progress. Le plugin n'en charge que 27 (engineering + productivity). Cadre A = projets courants de Nicolas. Cadre B = Mission Control.

## 1. Le parcours d'ensemble

1. `setup-matt-pocock-skills`, une fois par dépôt : écrit `docs/agents/issue-tracker.md`, `domain.md`, `triage-labels.md`, et un bloc `## Agent skills` dans `CLAUDE.md` (sinon `AGENTS.md`).
2. `grill-with-docs` = `grilling` + `domain-modeling` : interroge par tours, écrit `GLOSSARY.md` (racine) et `docs/adr/NNNN-titre.md`, créés seulement au premier besoin.
3. Détours possibles : `research` (agent de fond, note citée dans le dépôt), `prototype` (code jetable, gardé sur une branche `prototype/<nom>`), `to-questionnaire` (fichier `to-questionnaire-<sujet>.md`), `handoff` (fichier dans `$TMPDIR`).
4. `to-spec` : résume la conversation en spec, sans interview, et la publie comme ticket (ou `.scratch/<sujet>/spec.md`), label `ready-for-agent`.
5. `to-tickets` : découpe en tranches verticales avec leurs blocages ; un ticket par tranche (ou `.scratch/<sujet>/issues/NN-titre.md`).
6. `implement` (un ticket) appelle `tdd`, puis `code-review`, puis commite. `implement-spec` fait toute la spec : sous-agents en worktrees, une branche d'intégration, une revue à la fin.
7. `tdd` s'appuie sur `codebase-design`. `code-review` lit `CODING_STANDARDS.md`, `CONTRIBUTING.md` et la spec. `pr` donne la forme du texte de la PR.
8. `retro` clôt : propose des contrôles automatiques, des règles de revue, des pointeurs. Il ne touche pas au code.
9. Entrées latérales : `triage` (tickets reçus, mémoire des refus dans `.out-of-scope/`), `diagnosing-bugs`, `wayfinder` (carte de décisions dans l'outil de tickets), `improve-codebase-architecture` (rapport HTML dans le dossier temporaire).
10. Règle de contexte (`ask-matt`) : étapes 2 à 5 dans une seule session, puis `/clear` entre chaque ticket. Un skill « user-invoked » ne peut être lancé que par un humain, jamais par un autre skill.

## 2. Tous les skills

| Skill | Ce qu'il fait | Cadre A | Cadre B | Verdict |
|---|---|---|---|---|
| setup-matt-pocock-skills | Écrit `docs/agents/` et le bloc `## Agent skills` | Oui, une fois par dépôt | Lot 0 | Adapter : option « autre » (Linear), chemins de `docs/` |
| ask-matt | Dit quel skill prendre ; arbre continuer / clear / handoff / sous-agent / compact | Oui, en cas de doute | Ordre des rôles, passage d'une étape à l'autre | Tel quel (A) ; source d'idées (B) |
| grill-with-docs | Interview + glossaire + décisions | Avant tout changement non trivial | Pilot | Adapter : chemins des décisions |
| to-spec | Conversation → spec publiée | Travail de plusieurs sessions | Pilot | Adapter : écrire `spec.md` dans `docs/`, liste courte |
| to-tickets | Spec → tranches verticales avec blocages | Oui | Lead | Adapter : brouillon d'abord, zone de fichiers en plus |
| implement | Un ticket : tdd, revue, commit | Petits tickets | Dev | Adapter : sans l'auto-revue, avec PR |
| implement-spec | Toute la spec par sous-agents en parallèle | Non : la revue croisée saute | Modèle pour le moteur, pas un skill à lancer | Ignorer le skill, reprendre ses idées |
| tdd | Rouge puis vert, une tranche à la fois, aux coutures convenues | Oui | Dev | Tel quel |
| code-review | Revue du diff depuis un point fixe, deux axes : règles et spec | Oui, lancé par le relecteur | Relecteur | Tel quel ; nom en conflit avec le `/code-review` de Claude Code |
| pr | Texte de PR : résumé visuel, preuve avant/après, danger de fusion | Oui | Dev, et PR de la mission | Tel quel |
| diagnosing-bugs | Six phases ; d'abord une commande qui échoue sur ce bug | Bugs durs | Dev (correction), QA | Tel quel |
| research | Agent de fond, sources premières, note citée | Oui | Pilot, Lead ; sortie dans `docs/recherches/` | Tel quel |
| domain-modeling | Tient `GLOSSARY.md` et les ADR à jour pendant la discussion | Oui | Pilot | Adapter : `docs/adr/` au lieu de `docs/adr/` |
| codebase-design | Vocabulaire des modules profonds, test de suppression | Oui | Dev, relecteur (connecteurs) | Tel quel |
| prototype | Prototype jetable : un fichier HTML (logique) ou variantes d'écran | Oui | Pilot : état d'une mission (lot 2) | Adapter : variantes d'écran selon la règle des maquettes Herdr |
| triage | Fait passer les tickets reçus par cinq états | Non : pas de demandes externes | Non : statuts de 0004 | Ignorer ; garder `AGENT-BRIEF.md` |
| wayfinder | Gros chantier flou → carte de tickets de décision | Rare | Non pour l'instant | Ignorer ; écrit et supprime dans l'outil de tickets |
| improve-codebase-architecture | Cherche les modules à approfondir, rapport HTML | De temps en temps, vieux projets | Après le jalon 1 | Tel quel (A) |
| retro | Après une session : améliorer l'environnement de l'agent | Oui, surtout après une session ratée | Lead, au bilan | Tel quel |
| wizard | Script bash qui guide l'humain (clés, secrets, bascule) | Oui | « Ce qui dépend de Nicolas » : clé Linear | Tel quel |
| grill-me | Même interview, sans rien écrire | Hors dépôt (Pilot dans `~/Developer`) | Non | Tel quel |
| grilling | L'interview elle-même : tours, frontière, réponse recommandée | Oui | Pilot ; forme des demandes | Tel quel |
| handoff | Résume la session dans un fichier pour un autre agent | Claude ↔ Codex | Passage entre rôles | Adapter : pas dans `$TMPDIR` |
| teach | Cours sur plusieurs sessions dans un dossier | Hors sujet | Non | Ignorer |
| to-questionnaire | Questionnaire pour quelqu'un d'autre | Rare (client) | Non | Ignorer |
| wait-what | « Redis-le simplement, avec les mots du glossaire » | Oui | Non | Tel quel |
| writing-for-agents | Comment écrire pour un agent : pointeurs, critères de fin, élagage | AGENTS.md, consignes Codex | Consignes de tous les rôles | Tel quel |
| git-guardrails-claude-code (misc) | Hook qui bloque `git push`, `reset --hard`… | Non | Idée : seul le moteur pousse | Ignorer : Claude seulement, gelé |
| migrate-to-shoehorn (misc) | Remplace `as` dans les tests TypeScript | Non | Non | Ignorer |
| scaffold-exercises (misc) | Dossiers d'exercices de ses cours | Non | Non | Ignorer |
| setup-pre-commit (misc) | Husky, lint-staged, Prettier, types, tests | Projets Node et Next.js | Lot 0, si voulu | Adapter : un garde-fou par dépôt suffit |
| loop-me (en cours) | Specs de tâches récurrentes : déclencheur, point de contrôle, brief | Non | Vocabulaire pour demandes et validation | Adapter (idées) |
| chief-of-staff (en cours) | Une session longue qui coordonne des sous-agents | Non | Lead, veilleur | Adapter (idées) |
| claude-handoff (en cours) | Handoff + lance `claude --bg` | Non | Non : le moteur lance les agents | Ignorer |
| setup-ts-deep-modules (en cours) | dependency-cruiser : un paquet ne s'importe que par ses fichiers racine | Outils Node | Moteur, connecteurs | Adapter, après le lot 0 |
| writing-fragments (en cours) | Récolte de fragments pour un article | Non | Non | Ignorer |
| writing-shape (en cours) | Fragments → article, paragraphe par paragraphe | Non | Non | Ignorer |
| writing-beats (en cours) | Article construit temps par temps | Non | Non | Ignorer |

## 3. À adopter en priorité

1. **grilling** (Pilot) : « Ask the whole frontier in one round: number each question and give your recommended answer. » « Word each question so "yes" accepts your recommended answer. » « Finding facts is your job, never the user's. »
2. **domain-modeling** (Pilot) : un glossaire sans détail technique, mis à jour sur le moment. Une décision ne s'écrit que si elle est « hard to reverse », « surprising without context » et « the result of a real trade-off ».
3. **to-tickets** (Lead) : chaque tranche « cuts a narrow but COMPLETE path through every layer », est « demoable or verifiable on its own » et « sized to fit in a single fresh context window ». Chaque ticket déclare ses blocages.
4. **AGENT-BRIEF.md** (annexe de triage ; format de ticket et de consigne Codex) : « Behavioral, not procedural », « Durability over precision », « Explicit scope boundaries », critères vérifiables un par un.
5. **tdd** (dev) : « Test only at pre-agreed seams. » Un test, puis son code, puis le suivant. La valeur attendue vient d'une source indépendante, pas du code.
6. **code-review** (relecteur) : point fixe, `git diff <point>...HEAD`. Deux rapports séparés, jamais fusionnés. L'axe spec signale « behaviour in the diff that wasn't asked for (scope creep) ».
7. **diagnosing-bugs** (dev, QA) : « No red-capable command, no Phase 2. » Pas d'hypothèse avant une commande rapide et stable qui échoue sur ce bug précis. Puis 3 à 5 hypothèses réfutables.
8. **pr** (dev) : trois blocs : Summary (le plus petit schéma utile), Evidence (avant / après), Merge Danger (« one-way or two-way door », rayon d'impact).
9. **writing-for-agents** (toutes les consignes de rôle) : chaque étape finit par un critère de fin vérifiable. Dire quoi faire, pas quoi éviter. Supprimer toute phrase que le modèle suit déjà (« no-op »).
10. **retro** (Lead, bilan) : une faute mécanique devient un contrôle automatique ; un jugement va dans `CODING_STANDARDS.md`, lu à la revue. `AGENTS.md` reste court : des pointeurs.

## 4. Face aux décisions de Mission Control

Contradictions :
- **0005** : `to-spec`, `to-tickets`, `triage` et `wayfinder` écrivent eux-mêmes dans l'outil de tickets (tickets, labels, clôtures). `wayfinder` dit aussi « update or delete those tickets ». Chez nous, seul le connecteur écrit, après validation, sans suppression. Pilot et Lead doivent écrire dans `docs/missions/<ticket>/`.
- **0007** : `implement` lance `code-review` dans la session du dev, puis commite. `implement-spec` corrige après la revue, sans nouvelle revue. Chez nous : relecteur d'une autre famille, nouvelle relecture après correctif. Le skill `code-review` va au relecteur, pas au dev.
- **0008** : `implement` commite sur la branche courante, sans PR. `implement-spec` fusionne les tickets sans PR et ne relit qu'à la fin. Sa « integration branch » est pourtant notre branche de mission.
- **0003** : `implement-spec` vise « maximum concurrency » et règle les conflits à la fusion. Chez nous : deux devs au plus, zones vérifiées au découpage.
- **0003, 0004** : `to-tickets` dit « avoid specific file paths ». Nos tickets déclarent une zone de fichiers. À garder comme champ du ticket, hors du texte.
- **0009** : les skills visent `docs/adr/`, `GLOSSARY.md` à la racine, la spec dans l'outil de tickets, `.scratch/`, `$TMPDIR`. Nous : `docs/adr/`, `docs/missions/<ticket>/spec.md`. `prototype` et `wayfinder` poussent des branches jamais fusionnées : contraire à « aucun push sans accord » (AGENTS.md).
- **0001 et calibrage** : `to-spec` demande « a LONG, numbered list of user stories […] extremely extensive ». Contraire à « faire petit ».
- **Plan MC-1** : les lots 1 à 4 sont des couches (base, état, agents, écrans), et les lots 5 à 7 séparent moteur et page. `to-tickets` et `tdd` appellent cela « horizontal slicing ». À trancher par Nicolas : la règle « maquette = Claude » impose ce partage.

Améliorations possibles :
- **0006** : une demande = une question avec la réponse recommandée, formulée pour qu'un « oui » suffise (`grilling`). Un agent ne demande que des décisions, jamais des faits qu'il peut trouver. `loop-me` ajoute : demander tard, une fois, avec un « brief » prêt à décider.
- **0007** : deux axes de relecture séparés (spec, règles). Pour un ticket Fort, « l'approche » peut être la liste des coutures de test (`tdd`). Un `CODING_STANDARDS.md` lu par le seul relecteur (`retro`).
- **0008** : le dev fusionne la pointe de la branche de mission dans la sienne avant de rendre (`implement-spec`). Texte de PR selon `pr`.
- **0009** : ajouter un `GLOSSARY.md` (mission, lot, ticket, sous-ticket, demande, zone, niveau Fort). Appliquer les trois conditions avant d'écrire une décision (0010 serait sans doute une simple note).
- **0004** : « One adapter means a hypothetical seam. Two adapters means a real one » (`codebase-design`). L'interface de connecteur se justifie par Linear plus un faux de test, pas par Jiroo futur.
- **0010** : un ticket tient en « one 100K token agent session » (`wayfinder`). La consommation affichée sert à vérifier la taille des tickets.
- **0012** : `setup-ts-deep-modules` fait vérifier par un outil la frontière moteur / connecteurs / écrans.

## 5. Prérequis par projet

- `setup-matt-pocock-skills` est à lancer à la main, dans chaque dépôt. Il n'existe pas de réglage global. Il crée `docs/agents/issue-tracker.md` et `docs/agents/domain.md` (plus `triage-labels.md` si `triage` est installé), et le bloc `## Agent skills`. `GLOSSARY.md` et `docs/adr/` ne sont créés que plus tard, au premier terme ou à la première décision.
- Il écrit dans `CLAUDE.md` s'il existe. Ici `CLAUDE.md` ne fait que renvoyer à `AGENTS.md` : déplacer le bloc dans `AGENTS.md`, sinon Codex ne le lit pas.
- État actuel : aucun projet de `~/Developer` n'a `docs/agents/` ni `GLOSSARY.md`. Seul FlashGolf a un `docs/adr/`.
- « Autre outil : Linear » : aucun modèle n'est fourni (refus écrit dans `.out-of-scope/mainstream-issue-trackers-only.md`). Nicolas décrit le fonctionnement en un paragraphe ; le skill l'écrit tel quel dans `issue-tracker.md`. Il faut donc y dire nous-mêmes : avec quoi on accède à Linear (serveur MCP ou CLI, pour Claude et pour Codex), comment créer, lire, commenter et clore un ticket, comment faire un sous-ticket et un lien « bloqué par », ce que veut dire « publier » et « récupérer le ticket », et la forme des clés (`GON-104`) que `code-review` cherche dans les commits.
- Labels : `to-spec` et `to-tickets` posent `ready-for-agent`. Dans Linear, le créer par équipe, ou écrire dans `issue-tracker.md` de ne pas le poser. `wayfinder` demande en plus ses labels `wayfinder:*`.
- Le plugin se met à jour seul et ne se modifie pas. Toute adaptation va dans `docs/agents/*.md`, dans `AGENTS.md`, ou dans les consignes de rôle de Mission Control (licence MIT : le texte peut être repris).
- Les skills misc et in-progress ne sont pas dans le plugin : `npx skills@latest add mattpocock/skills --skill=<nom>`.
- Pour le cadre B : mettre `docs/adr/` et `docs/missions/` dans `docs/agents/domain.md` et `issue-tracker.md` de chaque projet piloté.

## 6. Non vérifié

- Aucun skill n'a été lancé. Le comportement réel avec Linear en mode « autre » n'est pas testé.
- `domain-modeling` cite `docs/adr/` en dur : je ne sais pas s'il suit un autre chemin écrit dans `docs/agents/domain.md`.
- Codex : le plugin est déclaré dans `~/.codex/config.toml`. Son chargement et le blocage des skills « user-invoked » n'ont pas été vérifiés.
- Un texte `/to-tickets` envoyé par le moteur dans un terminal lance-t-il un skill « user-invoked » ? Non testé. Sinon, la consigne du rôle doit contenir le texte du skill.
- Accès Linear de Codex, et du serveur MCP hors de l'espace FlashGolf : non vérifié.
- Lus en entier : les 38 `SKILL.md` et leurs annexes de texte. Survolés : `CHANGELOG.md`, les 28 pages de `docs/` (une lue en entier, questions fréquentes de dix autres), `wizard/template.sh`, les formats de `teach`, la fin de `HTML-REPORT.md`. Pages aihero.dev non consultées.
