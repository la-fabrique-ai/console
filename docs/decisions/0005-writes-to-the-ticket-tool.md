---
titre: Quatre gestes d’écriture dans l’outil de tickets
statut: acceptée
date: 2026-11-20
auteur: Pilot
remplace: aucune
---

# 0005 — Quatre gestes d’écriture dans l’outil de tickets

## Contexte
Le moteur ne doit pas abîmer l'outil de tickets d'un vrai projet.

## Décision
Le moteur n'écrit dans l'outil externe que par quatre gestes du connecteur : créer les sous-tickets du découpage, après validation de Nicolas ; changer leur statut ; ajouter un commentaire (compte rendu, lien de la PR) ; mettre dans le ticket principal un court résumé de la spec et le lien vers son fichier. Jamais de suppression. Le découpage du Lead reste un brouillon dans notre base tant que Nicolas ne l'a pas validé.

## Pourquoi
Des gestes peu nombreux et nommés se testent et se relisent. Une synchronisation large dans les deux sens ne se maîtrise pas.
