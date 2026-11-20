# Mission Control — page Develop (les devs travaillent), dans le dessin de Prepare

Maquette validée par Nicolas pour la page d'un ticket pendant Develop. Elle reprend le dessin de la page Prepare déjà intégrée (`mission-control-prepare.zip`) : même en-tête, même bandeau, même carte « Plan », mêmes blocs du bas, même colonne de droite de 440 px. Ce qui change : le plan est figé, et il avance.

Ce dossier remplace le dessin de Develop du zip `mission-control-ticket-page.zip`. **Validate et l'avant-clôture ne sont pas refaits ici** : ils gardent l'ancien dessin en attendant.

L'interface est en anglais. Le contenu du projet (titres de tickets, questions, textes) reste en français.

## Contenu

| Dossier | Ce qu'il contient |
|---|---|
| `screens/` | 83 captures 1800 × 1100, une par état |
| `html/` | Les mêmes états en HTML statique (CSS incluse, aucun script) : pour lire les tailles, couleurs et espacements exacts |
| `source/` | `Develop.dc.html` (2 devs), `Develop-1.dc.html` (1 dev), `Develop-3.dc.html` (3 devs). Format interne de l'outil de maquette : ils ne s'exécutent pas tels quels, mais la feuille de style et toute la logique (`renderVals`) s'y lisent. Les trois fichiers ne diffèrent que par la ligne `const TK = 'T1' / 'T2' / 'T3'` |

| Captures | Équipe |
|---|---|
| `1dev-01` à `1dev-18` | 1 dev (Codex), les tickets un par un |
| `2devs-01` à `2devs-21` | 2 devs en parallèle (Dev 1 Codex, Dev 2 Claude), toutes les situations |
| `2devs-22` à `2devs-44` | Les panneaux de la colonne de droite et les gestes (réponse, approbation, onglets d'un ticket, blocs du bas, menu « ⋯ ») |
| `3devs-01` à `3devs-21` | 3 devs en parallèle (Codex, Claude, Codex), toutes les situations |

**À ne pas développer** : dans `source/`, la ligne `.proto` au-dessus de l'application (« Maquette · aller à… ») et tout ce qui fabrique les situations (`SIT`, `MOM`, `OKD`, `DEVT`, `goP`, le calcul de `EL`, `USE`, `EV`). Dans le produit, l'état vient des agents.

## Ce qui a été fait, par rapport à Prepare

| Zone | Prepare | Develop |
|---|---|---|
| Bandeau | Vert, « The plan is ready » | Un seul message à la fois, avec sa couleur et ses boutons (voir plus bas) |
| Ligne Plan | Devs modifiables, « + Add a dev », « In parallel / In sequence », estimation | Devs figés avec un point d'état, « Line / Kanban » à gauche, et à droite le temps passé sur le temps estimé |
| Phases | Tickets et durée estimée | L'avancement : « 1 of 4 · 2 h of ~3 h », coche verte quand la phase est finie, bord bleu quand elle est en cours |
| Tickets | Ce que le ticket couvre | Son état, qui le tient, ses étapes avec leurs durées, l'estimé et le modèle |
| Fin de ligne | QA, Sign-off | En parallèle, une carte « Merge branches » avant la QA |
| Blocs du bas | Your request, Your decisions, Issue coverage, To plan for | « Drift from plan » remplace « Issue coverage » (la couverture est dedans) |
| Colonne de droite | L'estimation par défaut | « Right now » par défaut |

Réglages repris de l'application : ligne Plan à 32 px avec des boutons de 30 px, blocs de phase à 52 px, boutons « ‹ n » « n › » violets, cartes de la phase choisie à la couleur de son bloc, aucun espacement entre les lettres.

Retiré de la ligne Plan à la demande de Nicolas : les points de progression, « 3 of 10 accepted » et le mot « frozen ». Tout est figé dès que les devs sont lancés ; il n'y a pas besoin de l'écrire.

## La page

Page fixe, sans défilement vertical. Mêmes mesures que Prepare, sauf la zone des tickets qui gagne la place libérée.

| Zone | Hauteur |
|---|---|
| En-tête | 52 px |
| Bandeau | 76 px |
| Ligne Plan | 32 px |
| Phases | 52 px |
| Tickets | 648 px (32 px de titres d'étape, puis les voies) |
| Blocs du bas | 84 px |

Hauteur d'une carte : 616 px avec 1 dev, 303 px avec 2 devs, 198 px avec 3 devs.

### Le bandeau : un message à la fois

Dans cet ordre de priorité. Le premier qui s'applique gagne.

| Situation | Couleur | Message | Boutons |
|---|---|---|---|
| Vérification de l'environnement en échec | Rouge | « Start held: the test environment check failed » | Run the check again, See the check |
| Tu as demandé un changement | Bleu, arc qui tourne | « The Lead is updating the plan for your request » ; le reste de la page est figé et estompé | aucun |
| Fusion des branches | Bleu | « All 10 tickets accepted: merging the branches » | Pause |
| Conflit à la fusion | Bleu | « The Lead is resolving a merge conflict » ; rien n'est attendu de Nicolas | See the conflict, Pause |
| Tout est fusionné | Vert | « Branches merged: ready for QA » (1 dev : « All 10 tickets accepted: ready for QA ») | Start QA |
| QA lancée | Bleu | « QA is starting » | Pause |
| En pause | Gris | « Paused · 3 of 10 accepted » | Resume |
| Pause demandée | Bleu | « Pausing: the agents finish their turn » | Resume |
| Le plan a changé | Ambre | « The plan changed since you approved it », ou « The Lead updated the plan: 1 change applied, 1 set aside » | Review changes |
| Une question et un blocage | Ambre | « Two things wait for you » | Answer, See what's blocking |
| Une question | Ambre | « Waiting on you: a question from Dev 2 on FG-734 » | Answer |
| Des textes à choisir | Ambre | « Waiting on you: 3 texts to choose on FG-736 » | Choose |
| Un blocage | Rouge | « FG-734 is blocked » | See what's blocking |
| Tout roule | Bleu | « On track: FG-733 in dev, FG-734 in review » | Pause |

La ligne de détail porte, quand tout roule : les tickets acceptés, le temps passé sur le temps estimé, les jetons utilisés sur les jetons estimés.

### La ligne Plan

- Une pastille par dev : « D1 Codex », avec un point d'état (bleu qui pulse : il travaille ; gris : il attend ; ambre : il t'attend ; rouge : bloqué ; vert : fini). Avec 1 ou 2 devs, la pastille porte aussi le ticket en cours.
- « Line / Kanban », juste après les devs.
- À droite, « 1 h 43 of ≈ 4 h 15 » : ramène la colonne de droite sur « Right now ».

### Les phases

Même ligne que Prepare. Chaque bloc dit « 1 of 4 · 2 h of ~3 h » dès qu'un ticket a démarré, « 2 of 2 · 29 min » quand la phase est finie. Le bloc Validate ne porte que sa durée. Un clic met la phase à droite et colore ses cartes.

### Les tickets

Même rangée que Prepare : jamais repliée, aucune carte coupée, une voie par dev en parallèle, des colonnes « Step ».

- **La rangée se cale seule** sur l'étape en cours, avec une colonne déjà faite à gauche. L'étape en cours est marquée « STEP 3 · NOW ».
- **Choix à connaître** : en parallèle, les voies partagent les mêmes colonnes. La rangée se cale donc une seule fois, pour toutes les voies, et non voie par voie.
- À gauche de chaque voie : le dev, son outil, « 2 of 6 accepted », « 1 h 05 of ≈ 2 h 30 », et ce qu'il fait (« building FG-733 », « FG-734 in review », « waits for you on FG-735 », « blocked on FG-734 », « waits for FG-732 », « all accepted »).

#### La carte d'un ticket

De haut en bas : numéro, identifiant et phase, pastilles, dev propriétaire ; titre ; **la ligne « qui tient le ticket »** ; les étapes ; le texte ; pied avec la taille, l'estimé et le modèle.

**Qui tient le ticket** — c'est la réponse à « est-ce encore le dev qui travaille ? » :

| Pastille | Texte | Sens |
|---|---|---|
| D1, D2, D3, fond qui pulse doucement | « Building », « Fixing · round 1 » | Ce dev travaille dessus |
| R en pointillés, qui pulse | « In review », « In review · 1 of 2 » | Le relecteur a le ticket, le dev attend |
| You, ambre plein | « Waiting on you » | Le ticket attend Nicolas |
| !, rouge plein | « Blocked » | Bloqué |
| ❙❙ | « Paused » | En pause |
| Point vert | « Accepted » | Accepté |
| Point gris | « To do », « Added by the Lead », « Merged into FG-736 », « Cancelled · you declined it » | Rien ne tourne |

À droite de cette ligne : le temps réel passé dans l'état. Le pied garde l'estimé (« ~45 min »). Réel et estimé sont donc tous les deux sur la carte.

**Le fil de progression** : un trait de 3 px en haut de la carte active, qui avance avec le temps passé sur le temps estimé. Bleu quand un agent travaille, ambre quand le ticket t'attend, rouge s'il est bloqué, gris en pause. Il doit rester discret.

**Les étapes** (cartes de 1 et 2 devs) : Dev, Review 1, Fix · round n, Review 1 again, Review 2. ✓ faite, ● en cours avec l'agent nommé (« Codex is building », « Claude is reviewing »), ○ à venir, ✗ corrections demandées, ◆ attend ta décision, ! bloquée. Un ticket Heavy passe deux revues. Le relecteur est toujours de l'autre famille que le dev.

**Avec 3 devs**, la carte est trop basse pour les étapes : elles sont dans la colonne de droite. La ligne « qui tient le ticket » porte alors aussi les marques de revue (✓ ✓, ✗).

| État | Classe | Aspect |
|---|---|---|
| À faire | `k-todo`, `hv` si Heavy | Neutre, teinte violette si Heavy |
| En dev, en revue, en correction | `k-dev`, `k-rev`, `k-fix` | Bord et fond bleus |
| Attend ta réponse | `k-wait` | Bord et fond ambre |
| Bloqué | `k-blk` | Bord et fond rouges |
| Accepté | `k-ok` | Vert sombre |
| En pause | `k-pau` | Bord gris |
| Ajouté par le Lead, pas encore approuvé | `k-new` | Pointillés ambre |
| Fusionné dans un autre, annulé | `k-off` | Pointillés, estompé |

Pastilles à côté de l'identifiant : « ? » une question, « ! » un blocage, « ≠ » un écart avec le plan approuvé, « T » un texte à écrire.

#### Merge, QA, Sign-off

Ils ferment la rangée et gardent l'allure d'un ticket rayé.

- **En parallèle** : trois cartes empilées dans une colonne « Validate » : Merge branches, QA, Sign-off. Chaque dev travaille sur sa branche ; le Lead les fusionne quand tout est accepté, puis la QA démarre.
- **Avec 1 dev** : pas de fusion. QA et Sign-off à la suite, sur toute la hauteur.
- États de la fusion : « To come », « Lead is merging », « Conflict » (pastille « ! »), « Merged ».

### Le Kanban

Les mêmes tickets rangés par état, dans la zone de la rangée. Cinq colonnes de 190 px : To do, In dev, In review, Accepted, Validate. La carte est la même, réduite au titre et à la ligne « qui tient le ticket ». Un ticket qui t'attend ou qui est bloqué reste dans sa colonne, en ambre ou en rouge. « Accepted » met le dernier accepté en haut. Une colonne montre 5 cartes ; au-delà, 4 cartes et « +N more ».

### Les blocs du bas

| Bloc | Sur le bloc | À droite au clic |
|---|---|---|
| Your request | L'identifiant | Le but, l'approche du Lead (lien « Lead's approach »), les demandes et leurs tickets |
| Your decisions | Le nombre de réponses, ou « 2 waiting » en ambre | Ce qui attend (avec « Answer », « See what's blocking », « Review changes »), puis les réponses données |
| Drift from plan | « none », ou « 2 changes » en ambre, ou « v2 » | Les écarts avant et après, l'effet sur l'estimation, la copie figée, la couverture |
| To plan for | Étapes, risques, textes | Environnement (« Run the check again »), étapes manuelles, risques, textes, maquettes, comptes de test |

## La colonne de droite : un panneau à la fois

La croix ramène à « Right now ».

| Panneau | Quand | Contenu |
|---|---|---|
| Right now | Par défaut | **Time and usage**, réel sur estimé : le temps, les jetons, Claude et Codex séparés (quotas séparés), puis une ligne par dev. **Who is working** : Lead, devs, relecteurs, agent QA, chacun avec son état et « Open tab ». **Since your last visit** : une ligne par fait, en ambre ce qui t'attend. **Recent activity**. **References** : issue, dépôt, branches, état du code |
| Un ticket | Clic sur une carte | Quatre onglets. **Summary** : ce que ça change, comment, qui le fait (dev, modèle, relecteur ; figé à l'approbation, « Ask the Lead for a change »), estimé sur réel, ce qu'il attend, ce qu'il débloque. **Timeline** : les étapes et leurs durées, les remarques de la revue, les commits, les tests lancés, les jetons du ticket. **Technical** : les zones touchées, le risque de conflit en parallèle, la branche. **Tests & criteria**. Flèches ‹ › entre tickets |
| Une question | « Answer », ou situation ouverte dessus | La question, le contexte, les choix avec le recommandé en premier et ce que chacun apporte, « Let the Lead decide », « Answer differently… (opens Pilot) », le ticket concerné. Une fois répondu : le choix reste, les autres s'estompent |
| Des textes à choisir | « Choose » | Le même panneau, avec trois variantes |
| Un blocage | « See what's blocking » | Depuis combien de temps, pourquoi, ce qui a été tenté, ce qu'on attend de toi, « Run the check again » |
| Drift from approved plan | Bloc du bas, ou « Review changes » | Chaque changement avant et après avec sa raison, ce que le Lead a écarté et pourquoi, l'effet sur l'estimation, « Approve these changes » puis une fenêtre de confirmation |
| Frozen copy | Depuis l'écart | Ce qui a été approuvé, et les versions précédentes |
| Lead's approach | Depuis « Your request » | L'approche, les phases, l'organisation décidée par le Lead, le risque de conflit |
| Merge branches | Clic sur la carte, ou « See the conflict » | Les branches, l'état, le fichier en conflit et les deux tickets, le rappel du risque signalé dans le plan |
| Environment check | « See the check » | Ce qui a été vérifié, ce qu'on attend de toi |
| Une phase, Validate | Clic sur un bloc de phase | Ses tickets avec leur état, ce qu'elle couvre |

## Les règles

- **Tout est figé à l'approbation** : l'équipe, le dev et le modèle de chaque ticket. Un changement, qu'il vienne de Nicolas ou du Lead, n'entre en vigueur qu'après une nouvelle approbation. En attendant, les devs continuent sur le plan approuvé.
- **Ce que Nicolas change devient une demande** au Lead. Pendant qu'il retravaille le plan, le bandeau est bleu et le reste de la page est figé. Ensuite le bandeau dit ce qui a été appliqué et ce qui a été écarté, avec la raison.
- **Un ticket ajouté par le Lead** apparaît tout de suite dans le plan, en pointillés ambre avec « ≠ », et ne compte dans rien tant qu'il n'est pas approuvé.
- **Une question ou un blocage n'arrête que son ticket.** Avec plusieurs devs, le reste continue. Avec un seul dev, rien d'autre ne tourne et le bandeau le dit.
- **Pause** : l'agent en cours finit son tour, rien d'autre ne démarre.
- **Estimations à l'échelle des agents** : Light 10 min, Standard 20 min, Heavy 45 min, fusion 5 min, QA 35 min, recette 30 min. « Estimated from 42 past tickets ».
- **Risque de conflit** : deux tickets de la même étape qui touchent la même zone sont signalés « May conflict in parallel » (onglet Technical, approche du Lead, panneau de fusion).

## Les situations dessinées

Chaque équipe a les mêmes, dans le même ordre : `start`, `environment-check-failed`, `in-dev`, `in-review`, `fixes-requested`, `ticket-timeline`, `question-from-dev`, `question-in-review`, `blocked`, `question-and-blocked` (2 et 3 devs), `copy-to-choose`, `pause-requested`, `paused`, `lead-updating-plan`, `lead-answer`, `plan-drift`, `merged-and-cancelled`, `merging-branches` et `merge-conflict` (2 et 3 devs), `ready-for-qa`, `kanban`.

## Ce que l'application doit fournir, en plus de Prepare

Par ticket : son état, qui le tient, le temps passé dans chaque étape, le tour de correction, les remarques de revue, les commits, les tests lancés, les jetons, les zones touchées, la question ouverte ou le blocage.

Par dev : ce qu'il fait maintenant, ses tickets acceptés, son temps réel et estimé, sa branche.

Pour la mission : le temps et les jetons réels et estimés (par outil), les faits depuis la dernière visite, l'activité récente, l'état de la fusion, les écarts avec le plan approuvé et ses versions.

## Inventé dans la maquette

- Toutes les durées réelles, les jetons, « 42 past tickets », les heures.
- Les sept questions et leurs choix, le blocage (clé de test refusée), la migration 0026 manquante.
- Le ticket ajouté FG-740, la fusion de FG-737 dans FG-736, le fichier en conflit `messaging/send.ts`, les zones touchées, les branches, la PR #412, les commits.
- La répartition des tickets à 3 devs, et l'estimation des jetons à 1 et 3 devs.
- Le palier Codex « sol · xhigh » pour le modèle changé. « luna · medium » et « sol · high » viennent de l'application.

Repris de Prepare : les dix tickets, les quatre phases, la couverture. La répartition à 2 devs est celle de l'application (Dev 1 : 730, 731, 733, 735, 737, 739 ; Dev 2 : 732, 734, 736, 738).

## Ce qui ne fait rien dans la maquette

« Talk to Pilot », « ‹ », « Open tab », « Full report », « Open in the tracker », « Ask the Lead for a change », « Run the check again », « Open mockup », « Answer differently… », les entrées du menu « ⋯ ».

## Points encore ouverts

- Le défilement à la molette, colonne par colonne, n'est pas dans la maquette : elle n'a que les boutons.
- « Fusion refusée » n'existe que comme une ligne dans « Your decisions » ; elle n'a pas d'état de carte.
- Le nombre de tickets acceptés n'est plus dans la ligne Plan. Il est dans le bandeau quand tout roule ou qu'une chose t'attend, et toujours dans les phases et dans « Right now ».
- « frozen at approval » reste dans le détail d'un ticket, au-dessus du dev et du modèle.
- Validate et l'avant-clôture restent à refaire dans ce dessin.

## Pour une application native (GPUI)

Aucun espacement entre les lettres, aucun flou, pas d'ombres empilées. Les seules animations : l'arc du bandeau qui tourne, le fond des pastilles D1 / R qui pulse, le point d'état qui pulse. Les rayures des cartes Merge, QA et Sign-off sont un dégradé simple.

Dans `source/Develop.dc.html`, la logique suit l'ordre de la page, sous des commentaires en français : la demande et l'équipe, les situations, l'état de chaque ticket (`stOf`), les étapes (`stepsOf`), qui tient le ticket (`holder`), la zone micro (`mkCard`, `mkVal`), le Kanban, la zone macro, le bandeau (`band`), la colonne de droite (`now`, `d`, `QS`, `G`), les blocs du bas.
