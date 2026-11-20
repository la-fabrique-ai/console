---
titre: Une base de tickets propre, un connecteur par projet
statut: acceptée
date: 2026-11-20
auteur: Pilot
remplace: aucune
---

# 0004 — Une base de tickets propre, un connecteur par projet

## Contexte
Nicolas veut un système indépendant de l'outil de tickets : Linear aujourd'hui, Jiroo, Jira ou de simples fichiers MD demain.

## Décision
Le système a sa propre base de tickets, qui fait référence pour le moteur. Un connecteur par projet l'alimente depuis l'outil externe et y reporte les changements. Un projet n'a qu'un connecteur. Ordre : Linear, puis fichiers MD, puis Jiroo et Jira. Champs d'un ticket : identifiant et clé affichée ; origine (connecteur, identifiant externe, lien) ; titre ; description en Markdown ; type (principal ou sous-ticket) et parent ; statut ; priorité (0 à 4) ; taille (Light, Standard, Heavy) ; niveau (normal ou Fort) ; ordre, dépendances, zone de fichiers ; dev prévu ; commentaires. Huit statuts communs, traduits par chaque connecteur : À faire, En préparation, En cours, En revue, En test, À valider, Terminé, Annulé. Pas de pièces jointes, de sprints ni de points dans la première version.

## Pourquoi
Linear et Jiroo rangent tous deux leurs statuts en catégories propres à chaque équipe : une liste commune traduite par le connecteur convient aux deux. Beads a été écarté le 2026-11-20 pour ne pas dépendre d'un outil tiers.
