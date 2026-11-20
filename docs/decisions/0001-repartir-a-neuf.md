---
titre: Repartir à neuf, moteur compris
statut: acceptée
date: 2026-11-20
auteur: Pilot
remplace: aucune
---

# 0001 — Repartir à neuf, moteur compris

## Contexte
L'ancien système empile quatre générations d'écrans (14 écrans) et un moteur de 13 000 lignes, 96 commandes et plus de 110 décisions numérotées dans le code. Chaque correction en casse une autre. Nicolas, le 2026-11-19 : « c'est une usine à gaz ».

## Décision
On reconstruit écrans et moteur dans un nouveau dépôt, `~/Developer/mission-control`, avec une installation de Herdr à part. On ne reprend de l'ancien que des briques éprouvées, une par une, quand elles servent le nouveau besoin : accès à Linear, envoi dans un terminal, lancement d'un agent. L'ancien système est gelé (correctifs bloquants seulement), finit les missions en cours, puis s'arrête. Aucun historique n'est transféré.

## Pourquoi
Un périmètre volontairement petit donne un résultat lisible. Un ménage de l'ancien moteur garderait son architecture, qui est la source de la complexité.
