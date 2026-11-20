# Mission Control — page Prepare (le plan avant de lancer les devs)

Maquette validée par Nicolas pour la première page d'un ticket : le Lead a découpé la demande, le plan est prêt, Nicolas le lit, règle l'équipe et approuve. Ce dossier remplace la page Prepare du zip `mission-control-ticket-page.zip`. Develop, Validate et la page d'avant clôture ne changent pas.

L'interface est en anglais. Le contenu du projet (titres de tickets, textes) reste dans la langue du projet, ici le français.

## Contenu

| Dossier | Ce qu'il contient |
|---|---|
| `screens/` | 24 captures 1800 × 1100, une par état |
| `html/` | Les mêmes états en HTML statique (CSS incluse, aucun script) : à ouvrir pour lire les tailles, couleurs et espacements exacts |
| `source/` | Le code de la maquette (`Prepare.dc.html` et ses trois variantes de données). Format interne de l'outil de maquette : il ne s'exécute pas tel quel, mais la feuille de style et toute la logique (`renderVals`) s'y lisent |

| Captures | Cas |
|---|---|
| `01` à `15` | Gros ticket : FG-729, 10 tickets, 4 phases |
| `16` à `18` | Petit ticket : FG-752, 2 tickets, 1 phase |
| `19` à `21` | Un seul ticket : FG-760 |
| `22` à `24` | Très gros : 20 tickets, 8 phases (FG-729 doublé, seulement pour montrer le défilement) |

## La page : quatre zones et une colonne de droite

Page fixe, sans défilement vertical. Sous l'en-tête (52 px) et le bandeau vert (76 px), deux colonnes : à gauche les quatre zones, à droite une colonne de 440 px **toujours présente**.

| Zone | Hauteur | Rôle |
|---|---|---|
| 1. Équipe | 44 px | Les devs, et le temps estimé |
| 2. Macro | 66 px | Les phases en ligne, puis Validate |
| 3. Micro | 622 px | Les tickets en ligne, puis QA et Sign-off |
| 4. Blocs du bas | 84 px | Your request, Your decisions, Issue coverage, To plan for |

Les zones 1 à 3 sont dans une même carte « Plan ». Rien ne recouvre jamais rien : tout le détail s'affiche dans la colonne de droite.

### Bandeau

« The plan is ready: 10 tickets in 4 phases », puis une ligne : le temps total avec l'équipe choisie, QA et recette comprises, et le conseil s'il existe mieux (« · 21 h with 2 devs in parallel »). Avec un seul ticket : « 1 ticket, no split needed ». Bouton « Approve and start the dev(s) ».

### Zone 1 — Équipe

- Un dev se déclare **seulement Claude ou Codex** (pastille « D1 Codex ▾ », menu à deux choix, capture `04`). Pas de modèle à ce niveau.
- « + Add a dev » jusqu'à 3 devs, et jamais plus que le nombre de tickets. Avec un seul ticket, le bouton disparaît et une note dit « One ticket: one dev is enough ».
- Ajouter un dev passe le plan en parallèle. Le choix « In sequence / In parallel » n'apparaît qu'à partir de 2 devs.
- À droite, « ≈ 31 h › » : ramène la colonne de droite sur l'estimation.

### Zone 2 — Macro

- Un bloc par phase (numéro, titre, « 4 tickets · ~16 h »), puis un bloc en pointillés « Validate · QA + sign-off · ~3 h ».
- La largeur d'un bloc suit son titre : aucun titre tronqué ni sur deux lignes. S'il reste de la place, elle est répartie entre les blocs.
- **Si tout ne tient pas, la ligne défile** (captures `22`, `23`) : deux flèches grises fines dans une gouttière de 34 px de chaque côté, avec le nombre de phases restantes dessous. Elles ne recouvrent aucun bloc.
- Un clic sur une phase : ses tickets restent nets, les autres s'estompent, la ligne des tickets se cale dessus, et la colonne de droite montre la phase (capture `09`). Un second clic annule.

### Zone 3 — Micro

Une seule rangée, toujours de gauche à droite, jamais repliée. Elle occupe toute la hauteur, et le contenu des cartes dépend du nombre de devs :

| Équipe | Disposition | Ce que montre une carte |
|---|---|---|
| 1 dev (ou plusieurs en séquence) | Une ligne, cartes de 590 px de haut | Tout : ce que ça change, How, Covers, To watch, « after 730 » |
| 2 devs en parallèle | Une ligne par dev (290 px), colonnes « Step 1, Step 2… » | Ce que ça change, Covers (3 lignes au plus, puis « +N more ») |
| 3 devs en parallèle | Une ligne par dev (190 px) | Titre, deux lignes de texte |

Sur toutes les cartes : numéro, identifiant, taille (Light / Heavy, rien pour Standard), temps, **modèle** en bas à droite, et la pastille du dev en haut à droite dès qu'il y a plus d'un dev. En parallèle, la phase est abrégée après l'identifiant (« FG-732 · P2 »).

- QA et Sign-off ferment la rangée : deux cartes rayées à la suite avec une ligne, empilées dans une colonne « Validate » en parallèle. Elles gardent l'allure d'un ticket.
- **Aucune carte n'est jamais coupée.** La largeur est calculée : on prend le plus grand nombre de colonnes entières qui tiennent (largeur minimale 220 px sur une ligne, 176 px en parallèle), puis on étire les cartes pour remplir exactement. La rangée défile par pages de ce nombre de colonnes.
- Défilement : « ‹ 2 » et « 9 › », petits boutons gris à droite de la ligne des étapes.
- Au-dessus des cartes, sur une ligne : le nom de la phase (« 2 · ENVOIS AUTOMATIQUES ») qui reste visible quand on défile ; en parallèle, « STEP n ».
- Ticket sélectionné : contour blanc. Ce qu'il attend : contour bleu. Ce qu'il débloque : contour vert.

### Zone 4 — Blocs du bas

Quatre blocs d'une ligne. Un clic ouvre le détail à droite, un second clic revient à l'estimation.

| Bloc | Sur le bloc | Dans la colonne de droite |
|---|---|---|
| Your request | L'identifiant de la demande | Le but, les demandes avec leurs tickets, le hors périmètre, « Open the full ticket page › » (capture `11`) |
| Your decisions | Nombre de réponses, blocages | Les questions auxquelles Nicolas a répondu et ce que ça a changé, les blocages pendant le découpage (`12`, `21` quand il n'y en a pas) |
| Issue coverage | « 10 of 10 » | Chaque demande et les tickets qui la couvrent (`13`) |
| To plan for | Étapes, risques, textes ; pastille ambre « 1 to check » si l'environnement n'est pas vérifié | Environnement, étapes manuelles, risques, textes à écrire, maquettes, comptes de test (`14`, `18`) |

## La colonne de droite

Un seul panneau à la fois. La croix ramène à l'estimation.

| Affiche | Quand | Contenu |
|---|---|---|
| Estimate | Par défaut | Total, détail (Development, Merge branches, QA, Your sign-off), « Would more devs help? » avec une ligne par taille d'équipe (un clic applique), le conseil, la charge par dev, « Why not faster » |
| Ticket | Clic sur une carte | En haut, **« Done by » et « Model »** (modifiables), puis l'adaptation éventuelle, What it changes, How, To watch, la maquette, Covers, Waits for / Unblocks (cliquables), Reviews. Flèches ‹ › pour passer au ticket voisin |
| Phase | Clic sur un bloc de phase | Le but, ses tickets, ce qu'elle couvre |
| Validate | Clic sur QA, Sign-off ou le bloc Validate | Ce qui se passe et combien de temps |
| Les quatre blocs | Clic sur un bloc du bas | Voir plus haut |

## Le modèle, ticket par ticket

Le Lead propose le modèle selon la taille du ticket et l'outil du dev. Nicolas le change dans le panneau du ticket ; la carte se met à jour (captures `06`, `07`).

| Taille | Claude | Codex |
|---|---|---|
| Light | haiku 5.5 | gpt-6.1-sol, effort low |
| Standard | sonnet 5.5 | gpt-6.1-sol, effort medium |
| Heavy | opus 5.5 | gpt-6.1-sol, effort high |

**Cette grille est une hypothèse, surtout côté Codex.** Prends les vrais modèles et paliers de l'application.

Le dev aussi se change par ticket (« Done by »). Par défaut le Lead envoie les tickets Heavy et ceux qui ont des textes à écrire vers Claude quand l'équipe en a un.

## L'estimation

Dans la maquette, tout est calculé à partir de la taille : Light 1 h, Standard 2 h, Heavy 4 h.

- **1 dev, ou plusieurs en séquence** : la somme des tickets.
- **En parallèle** : les tickets sont rangés en étapes. Un ticket démarre après ceux qu'il attend, sur un dev libre ; une étape dure le temps de son ticket le plus long. On ajoute la fusion des branches.
- **Toujours ajoutés** : QA et recette. Ils comptent dans le total affiché partout.
- **Le conseil** compare 1, 2 et 3 devs et dit lequel est le plus rapide. Quand un dev de plus ne gagne rien, la page le dit (« no gain over 2 devs », capture `08`) et propose « Ask the Lead to re-split for more parallel work › ».
- **Why not faster** : la plus longue chaîne de tickets qui s'attendent fixe le plancher.

Sur FG-729 : 31 h avec 1 dev, 21 h avec 2 devs en parallèle, 21 h avec 3.

**Ces durées sont inventées.** Dans l'application, l'estimation doit venir du Lead. Ce qui compte ici, c'est ce que la page montre : un total, sa décomposition, la comparaison par taille d'équipe et la raison du plancher.

## Ce que l'application doit fournir

Par demande : identifiant, titre, but, demandes initiales, hors périmètre, questions posées avec les réponses, blocages, état de l'environnement, étapes manuelles, risques, textes à écrire, maquettes, comptes de test.

Par phase : nom, but.

Par ticket : identifiant, phase, taille, titre, ce que ça change, comment, tickets attendus, risque, texte à écrire, maquette, demandes couvertes, adaptation faite après une réponse, temps estimé, dev et modèle proposés.

## Ce qui est inventé dans la maquette

- Sur FG-729 : les titres de FG-735 à FG-739, tous les textes « ce que ça change » et « comment », les dépendances au-delà de FG-732, le contenu de Q-34, le blocage « token budget exceeded », le but, le hors périmètre, les risques, les étapes manuelles, les comptes de test.
- FG-752 et FG-760 en entier.
- Toutes les durées, y compris QA, recette et fusion.
- L'hypothèse « en parallèle, une branche par dev, fusionnées avant la QA ».

Vrai sur FG-729 : le titre de la demande, les titres de FG-730 à FG-734, les noms des quatre phases, les dix lignes de couverture, le choix de la maquette (variante A), les comptes (5 étapes, 5 risques, 2 textes), « Environment not checked ».

## Ce qui ne fait rien dans la maquette

« Approve and start the dev(s) », « Talk to Pilot », « ⋯ », « Open the full ticket page › », « Open mockup › », « Ask Pilot to adjust this ticket › », « Ask the Lead to re-split for more parallel work › », « Check now ».

## Points encore ouverts

- Le mode « In sequence » avec plusieurs devs ne fait jamais gagner de temps. Nicolas n'a pas tranché s'il reste.
- Avec un seul ticket, les zones Équipe et Macro apportent peu. Elles sont laissées telles quelles (capture `19`).
- Changer de modèle ne change pas le temps estimé.

## Repères visuels

Fond #12151D, cartes #1B1F2B, bordures #2A2F40. Bleu : un agent travaille. Ambre : attend Nicolas. Vert : prêt. Rouge : bloqué. Violet : Heavy. Polices Geist et JetBrains Mono. Les valeurs exactes sont dans la balise `<style>` de `source/Prepare.dc.html` et dans chaque fichier de `html/`.

Dans `source/Prepare.dc.html`, la logique suit l'ordre de la page, sous des commentaires en français : la répartition (`sched`), l'estimation (`est`), la zone micro (`cards`, calcul de `CW` et `nVis`), la zone macro (`mac`, mesure des blocs), l'estimation par équipe (`OPT`), le détail d'un ticket (`d`), les panneaux (`G`), les blocs du bas (`tile`). Les trois autres fichiers ne diffèrent que par la ligne `const D = DATA[...]`.
