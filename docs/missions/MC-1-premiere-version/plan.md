---
titre: Plan de la première version
statut: à valider par Nicolas
date: 2026-11-20
auteur: Pilot
ticket: MC-1
---

# Plan de la première version

## Objectif
Nicolas mène une mission complète avec le nouveau système : une demande dans Linear, une spec, un découpage validé, des tickets développés et relus, une QA, sa validation, des PR empilées. D'abord sur une équipe Linear d'essai, puis sur un vrai ticket FlashGolf.

## Décisions
Toutes dans `docs/decisions/` (0001 à 0012). Ce plan ne les répète pas.

## Limites
- Rien n'est repris de l'ancien code sans décision explicite, brique par brique.
- Aucune écriture dans un projet Linear réel avant le jalon 2.
- Chaque lot est livré avec ses tests, relu par l'autre famille de modèle, et montré à l'écran ou en ligne de commande avant le suivant.
- Un lot tient dans une session d'agent et se relit en une passe. Plus gros, il est redécoupé par le Lead.

## Lots du jalon 1 — le parcours complet minimal
| Lot | Résultat attendu | Fini quand | Dev |
|---|---|---|---|
| 0 Socle | Dépôt en TypeScript strict, tests, vérification du projet ; une installation de Herdr à part qui affiche un écran vide de Mission Control | La vérification passe ; l'écran s'ouvre dans le Herdr à part ; on sait ce que Herdr accepte comme fichier d'écran | Codex (moteur), Claude (écran) |
| 1 Tickets | Le modèle de ticket, la base, le connecteur Linear en lecture | Un ticket de l'équipe d'essai apparaît dans la base avec tous ses champs | Codex |
| 2 Mission | L'état d'une mission et ses quatre étapes, lisible dans un fichier | Une mission se crée à partir d'un ticket et avance d'étape en étape par commande | Codex |
| 3 Agents et demandes | Lancer un agent dans un terminal, lui envoyer un texte une seule fois, recevoir une demande et y répondre | Une demande posée par un agent reçoit sa réponse dans son terminal, une fois, même si la commande est rejouée | Codex |
| 4 Écrans de base | Inbox, Development et le cadre de la page d'une mission | Nicolas ouvre une mission depuis la liste et répond à une demande sur place | Claude |
| 5 Préparer | Pilot écrit la spec dans `docs/`, le Lead propose un découpage en brouillon, Nicolas valide, les sous-tickets sont créés dans Linear | Sur l'équipe d'essai : spec écrite, découpage validé, sous-tickets créés, résumé et lien dans le ticket principal | Codex (moteur), Claude (page) |
| 6 Développer | Un dev code un ticket, un relecteur le relit, la PR du ticket est fusionnée dans la branche de la mission ; niveau Fort compris | Deux tickets à la suite sont acceptés, chacun avec sa PR empilée | Codex (moteur), Claude (page) |
| 7 Tester et valider | QA, validation de Nicolas, corrections dans la même mission, clôture | Une mission d'essai va jusqu'à la clôture, avec un refus corrigé en chemin | Codex (moteur), Claude (page) |

**Jalon 1** : une mission complète sur l'équipe Linear d'essai, menée par Nicolas.

## Lots suivants
| Lot | Résultat attendu |
|---|---|
| 8 Deux devs | Le passage à deux devs à l'écran de préparation, le découpage recalculé, la règle des zones |
| 9 Jetons | La consommation par mission, par agent et par ticket |
| 10 Connecteur MD | Des tickets en fichiers Markdown, pour prouver que le modèle ne dépend pas de Linear |
| 11 Import Linear | Les documents Linear d'un projet copiés dans son `docs/` |
| 12 Machine distante | Des devs lancés sur ai-dev |
| 13 Finition des écrans | Conformité aux maquettes, textes français choisis par Nicolas |

**Jalon 2** : une vraie mission sur FlashGolf, sur un petit ticket choisi par Nicolas. Jiroo et Jira viennent après.

## Ce qui dépend de Nicolas
- Créer l'équipe Linear d'essai et une clé d'accès pour le connecteur.
- Dire si le dépôt est publié sur GitHub (privé), nécessaire pour les PR du projet lui-même.
- Valider les maquettes de QA et de Validate, et choisir les textes.
- Confirmer la décision 0012 (TypeScript).
