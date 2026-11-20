---
titre: Relecture indépendante, approche validée pour les tickets Fort
statut: acceptée
date: 2026-11-20
auteur: Pilot
remplace: aucune
---

# 0007 — Relecture indépendante, approche validée pour les tickets Fort

## Contexte
Un dev de l'ancien système s'est arrêté parce que les règles du projet demandaient de faire valider son approche avant de coder, et que le moteur n'avait pas cette étape.

## Décision
Ticket normal : une relecture, par un relecteur de l'autre famille de modèle que le dev, sur un commit précis. Ticket Fort (sécurité, authentification, paiements, migrations de données) : le dev écrit son approche, le relecteur la valide, le dev code, puis deux relectures. Le relecteur ne corrige pas ; tout correctif demande une nouvelle relecture.

## Pourquoi
L'étape existe dans les règles des projets : le moteur doit la porter au lieu de la découvrir par un blocage.
