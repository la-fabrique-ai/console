---
titre: Une PR par ticket, empilée sur la PR de la mission
statut: acceptée
date: 2026-11-20
auteur: Pilot
remplace: aucune
---

# 0008 — Une PR par ticket, empilée sur la PR de la mission

## Contexte
Nicolas veut un système de pile : le ticket principal a sa PR, chaque sous-ticket la sienne.

## Décision
La PR principale va de la branche de la mission vers la branche principale du projet. Chaque sous-ticket a sa branche et sa PR, qui vise la branche de la mission. Un ticket qui dépend d'un autre démarre après la fusion de celui-ci. Le système pousse les branches, ouvre les PR en brouillon et fusionne la PR d'un ticket quand le relecteur l'accepte. La PR principale n'appartient qu'à Nicolas : il la fusionne après sa validation. GitHub seulement, via `gh`, dans la première version.

## Pourquoi
Toutes les PR visant la branche de la mission, il n'y a pas de rebase en chaîne, et deux tickets en parallèle ne se gênent pas.
