---
titre: Mission Control — le projet en une page
statut: en vigueur
date: 2026-11-20
auteur: Pilot
---

# Mission Control

## But
Nicolas confie une demande (un ticket) et suit son développement par des agents de code jusqu'à sa validation. L'outil doit rester simple et lisible : un seul parcours, peu d'écrans, l'essentiel seulement.

## Le parcours d'une mission
1. **Préparer** : Pilot écrit la spec avec Nicolas. Le Lead propose un découpage en tickets, en brouillon. Nicolas valide ; les sous-tickets sont alors créés.
2. **Développer** : un ou deux devs codent les tickets. Chaque ticket est relu par un relecteur indépendant.
3. **Tester** : l'agent QA teste selon les critères de la spec.
4. **Valider** : Nicolas vérifie, puis clôt. S'il refuse, le Lead en fait des tickets de correction dans la même mission.

## Les rôles
Pilot (spec), Lead (découpage et coordination), dev (1 ou 2), relecteur (autre famille de modèle que le dev), QA. Un veilleur lance l'agent suivant quand le précédent a fini.

## Les briques
- **Écrans** : natifs dans Herdr App, dans une installation de Herdr à part. Quatre écrans : Inbox, Development, la page d'une mission, le terminal d'un agent. En français.
- **Moteur** : en TypeScript, lancé en ligne de commande. Un état lisible par mission.
- **Tickets** : une base propre au système, alimentée par un connecteur par projet (Linear d'abord, puis fichiers MD, Jiroo, Jira).
- **Code** : une branche et une PR par ticket, empilées sur la PR de la mission. GitHub, via `gh`.
- **Plans et mémoire** : dans `docs/` du dépôt de chaque projet.

## Ce que la première version ne fait pas
Limites et alertes de budget, pause et reprise, suivi des écarts au plan, récapitulatif « depuis ta dernière visite », Kanban, plus de deux devs, reprise de l'historique de l'ancien système.

## Règle de conduite
Chaque cas particulier ne devient pas une règle. Avant d'ajouter un état ou une commande, on vérifie qu'aucun existant ne suffit. Voir [[0001-repartir-a-neuf]].
