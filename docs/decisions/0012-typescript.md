---
titre: Le moteur est écrit en TypeScript strict
statut: proposée
date: 2026-11-20
auteur: Pilot
remplace: aucune
---

# 0012 — Le moteur est écrit en TypeScript strict

## Contexte
L'ancien moteur est en JavaScript simple. Nicolas demande quelque chose de plus solide.

## Décision
Le moteur et les connecteurs sont en TypeScript strict. Node 24 exécute TypeScript directement : pas d'étape de compilation pour lancer une commande, et un contrôle des types dans la vérification du projet. Le modèle de ticket, l'état d'une mission et le contrat des commandes sont des types partagés. Les écrans restent des fichiers JavaScript tant que Herdr App ne charge pas autre chose ; ils utilisent ces mêmes types par contrôle de leurs annotations. À vérifier dans le lot 0 : ce que Herdr App accepte comme fichier d'écran.

## Pourquoi
Les types font respecter le contrat entre moteur, connecteurs et écrans, là où l'ancien système comptait sur des tests et des conventions.
