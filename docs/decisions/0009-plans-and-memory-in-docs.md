---
titre: Les plans et la mémoire vivent dans docs/ du projet
statut: acceptée
date: 2026-11-20
auteur: Pilot
remplace: aucune
---

# 0009 — Les plans et la mémoire vivent dans docs/ du projet

## Contexte
Les plans étaient dans Linear, ce qui ne marche pas avec les autres connecteurs. Un dépôt `plans` séparé, Obsidian Sync et plusieurs outils tiers ont été comparés le 2026-11-20.

## Décision
Chaque projet range dans son dépôt : `docs/context.md`, `docs/index.md` (généré par le moteur à partir des en-têtes), `docs/decisions/` et `docs/missions/<ticket>/` (spec, découpage, bilan). La spec et le découpage sont écrits sur la branche de la mission et fusionnés avec elle. Lecture selon le rôle : Pilot lit tout le projet, le Lead et les devs leur mission et les décisions citées. Pilot rédige une décision quand elle est prise avec Nicolas ; à la clôture, le Lead écrit le bilan et propose les décisions apparues en route. Un seul parcours et un seul format par défaut ; chaque projet peut régler les emplacements et le modèle de spec. Linear ne porte plus les plans : une commande d'import, par projet, copie ses documents en Markdown dans `docs/` sans rien y supprimer, puis Pilot propose le contexte et les décisions à en tirer. Nicolas lit dans Obsidian en ouvrant `docs/`.

## Pourquoi
Une machine qui a le code a les plans, serveur distant compris. La spec voyage avec le code qu'elle demande, et une décision devient valable quand son code est fusionné.
