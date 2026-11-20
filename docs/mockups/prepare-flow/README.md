# Mission Control : le parcours « du ticket au plan » (Préparer)

Maquette validée par Nicolas : comment on part d'une issue, ou d'un nouveau ticket, pour arriver au plan. Le parcours a quatre étapes : **Demande → Questions → Spec → Plan**.

La dernière étape, **Plan**, est la page Prepare déjà livrée (`mission-control-prepare.zip`). Elle n'est pas redessinée ici : le parcours y aboutit.

L'interface de ce parcours est **en français, avec « vous »**. Prepare et Develop ont été livrés en anglais. La langue n'est pas encore tranchée : voir « Questions ouvertes ».

## Contenu

| Dossier | Ce qu'il contient |
|---|---|
| `screens/` | 26 captures 1800 × 1100, une par état |
| `html/` | Les mêmes états en HTML statique (CSS incluse, aucun script), pour lire les tailles, couleurs et espacements exacts |
| `source/Flow.dc.html` | La maquette interactive. C'est le format interne de l'outil de maquette : le fichier ne s'exécute pas tel quel, mais la feuille de style et toute la logique (`renderVals`) s'y lisent |

| Captures | Étape |
|---|---|
| `01` | La liste des issues, telle qu'elle est aujourd'hui, avec « Nouveau ticket » |
| `02` à `04`, `22` | Demande à partir d'une issue : l'issue, puis les précisions ajoutées avec le prompt |
| `05` à `07` | Nouveau ticket : la page vide, le besoin écrit dans le prompt, le ticket créé (on revient alors sur la page Demande) |
| `08` | Pilot prépare ses questions |
| `09` à `12`, `23`, `24` | Les questions, une par page : réponse proposée, autre réponse écrite, suggestion mise à jour, dernière question, question rouverte |
| `13` | Les 6 questions ont une réponse |
| `14` à `16`, `25` | La spec : version 1, changement écrit, Pilot met à jour, version 2 avec le passage modifié surligné |
| `17` | Le Lead découpe la spec en tickets |
| `18` à `21`, `26` | Le plan (la page Prepare) : 1 dev, 2 devs, lancement, lancé, ticket choisi |

**À ne pas développer.** Dans `source/` :
- la ligne `.proto` au-dessus de l'application (« Maquette · aller à… ») ;
- le lien « maquette : la suite › » (classe `.mk`) dans les blocs d'attente ; il est masqué dans les captures ;
- les textes déjà écrits qui remplissent le prompt au clic (`NEWTXT`, `ADDS`, la 4ᵉ colonne de `QS`, `SPECMSG`) et les réponses de Pilot écrites à l'avance (5ᵉ colonne de `QS`, spec v2).

Dans le produit, ces contenus viennent de l'utilisateur et des agents.

## Une même page pour chaque étape

Demande, Questions et Spec ont exactement le même cadre :

1. **En-tête** : titre du ticket, `FlashGolf · FG-729`, puis les phases Préparer › Développer › Tester › Valider.
2. **Fil des étapes** sous l'en-tête : quatre pastilles cliquables `1 Demande`, `2 Questions`, `3 Spec`, `4 Plan`. Une étape finie passe en coche verte avec un résumé (« validée », « 6 réponses », « validée · v2 ») ; l'étape en cours est en violet.
3. **Carte principale** (à gauche) : le contenu de l'étape, qui défile si besoin, puis le composeur en bas.
4. **Colonne de droite de 440 px** : la liste propre à l'étape (voir plus bas).

Il n'y a pas de bandeau sur ces étapes. Le bandeau vert « Le plan est prêt » apparaît à l'étape Plan, comme dans Prepare.

## Le composeur : un seul bloc, un seul bouton

C'est le point sur lequel Nicolas a le plus insisté : **le bouton de validation est dans le composeur, en bas, et nulle part ailleurs**. Le message de Pilot n'a aucun bouton.

Le bloc a deux zones distinctes :

| Zone | Rôle | Style |
|---|---|---|
| Haut : le champ | Là où l'on écrit | Fond `#0F1219` (en creux), curseur violet `#8E8FFF` de 2 × 19 px qui clignote (1,1 s), texte 15 px, hauteur mini 66 px |
| Bas : la barre d'action | Là où l'on valide | Fond `#1B1F2B`, trait `#2A2F40` au-dessus, texte d'aide 13,5 px `#8C93A6` à gauche, bouton à droite |

Le bloc : bord `#3A4052`, rayon 14 px. Il passe en bord violet `#4A52A8` dès qu'il y a du texte.

**Le bouton change de rôle selon le champ :**

| Champ | Bouton | Texte d'aide à gauche |
|---|---|---|
| Vide | Vert `#1F7A5C`, bord `#2FA37A`, « ✓ Valider cette réponse » (ou « ✓ Valider la demande », « ✓ Valider la spec », « ✓ Écrire la spec ») | Ce que fait la validation : « ou validez la réponse de Pilot · question 4 ensuite » |
| Rempli | Violet `#6B6CF5`, « Envoyer à Pilot ↑ » | Ce qui va se passer : « Pilot met sa réponse à jour · vous validez ensuite » |
| Agent au travail | Grisé, désactivé : « Pilot prépare ses questions… », « Pilot met la spec à jour… », « Le Lead prépare le plan… » | « Environ 2 min · vous pouvez quitter, l'Inbox vous préviendra » |

Bouton : 40 px de haut, padding 0 18 px, rayon 10 px, 14,5 px gras.

Le texte du champ et le texte d'aide se lisent comme un choix : « Écrivez une autre réponse… » en haut, « ou validez la réponse de Pilot » en bas.

| Étape | Texte du champ vide | Bouton (champ vide) |
|---|---|---|
| Nouveau ticket | « Décrivez ce que vous voulez obtenir… » | « Créer le ticket », désactivé tant que le champ est vide |
| Demande | « Ajoutez une précision… » | « ✓ Valider la demande » |
| Question | « Écrivez une autre réponse… » | « ✓ Valider cette réponse » |
| Question, après correction | « Écrivez encore, Pilot ajuste sa réponse… » | « ✓ Valider la suggestion mise à jour » |
| Question déjà validée, rouverte | « Écrivez une autre réponse… » | « ✓ Garder cette réponse » |
| Questions terminées | « Autre chose à dire à Pilot ? » | « ✓ Écrire la spec » |
| Spec | « Demandez un changement… » | « ✓ Valider la spec » |
| Le Lead découpe | « Dire quelque chose au Lead pendant qu'il découpe… » | grisé |

## Les étapes

### Issues (`01`)
La liste telle qu'elle est dans l'application : identifiant, titre, état. Bouton « Nouveau ticket » en haut à droite. Pas de colonne de droite. Un clic sur une issue ouvre sa page Demande.

### Demande (`02` à `07`, `22`)
- **Depuis une issue** : l'issue précisée (titre, puces d'état, texte). Chaque précision envoyée par le prompt s'ajoute dans le fil : votre message (bulle violette à droite), puis l'accusé de Pilot (bulle neutre). Le fil se termine par un message de Pilot : « La demande me suffit pour commencer… » ou, après une précision, « Autre chose à préciser ? Sinon je lis le projet… ».
- **Nouveau ticket** : la même page, vide, centrée : « Que voulez-vous faire dans FlashGolf ? ». On décrit le besoin dans le prompt, le bouton dit « Créer le ticket ». Le ticket est créé (titre proposé par Pilot) et l'on arrive sur la page Demande normale.
- **Colonne de droite** « La demande en bref » : rangement (projet, type), vos précisions, ce qui vient ensuite. Pour un nouveau ticket vide : « Comment ça se passe », en 4 étapes.

### Questions (`08` à `13`, `23`, `24`)
Le principe de Grill : **une question par page, une réponse proposée par Pilot ; vous validez, ou vous écrivez autre chose.**
- En haut : « Question 3 sur 6 », la question en titre (26 px), une ligne de contexte.
- Le message de Pilot « Pilot · réponse proposée », sa réponse en gras.
- **Valider** enregistre la réponse et affiche tout seul la question suivante (la prochaine sans réponse).
- **Écrire autre chose** : la première réponse passe en gris (« Première réponse proposée par Pilot »), votre message s'affiche, puis Pilot renvoie « Pilot · suggestion mise à jour ». Vous validez cette suggestion, ou vous écrivez encore.
- Attente (`08`) : « Pilot prépare ses questions », bloc bleu avec l'arc qui tourne.
- Fin (`13`) : « Les 6 questions ont une réponse », avec le récapitulatif.
- **Colonne de droite** « Les questions de Pilot » : « n sur 6 », les 6 questions avec leur état (coche verte = validée telle quelle, crayon ambre = validée après correction, numéro = à venir) et la réponse retenue en dessous. La question en cours est encadrée en violet (`#1C2040`, contour `#4A52A8`). **Un clic sur une question la rouvre** (`24`). Mention : « Pilot peut ajouter une question selon vos réponses. »

### Spec (`14` à `16`, `25`)
- En tête, le message de Pilot : « Voici la spec, écrite d'après vos 6 réponses… », puis le document par sections (le problème, la solution, ce que l'utilisateur pourra faire, ce qui ne change pas, hors mission). À droite de chaque passage, sa source : « votre demande », « réponse 3 », « proposé par Pilot ».
- Un changement se demande par le prompt. Pendant la mise à jour (`15`), la spec passe à 45 % d'opacité, avec votre message et le bloc « Pilot met la spec à jour ».
- Version 2 (`16`) : Pilot dit ce qui a changé ; le passage modifié est encadré ambre avec l'étiquette « modifié · v2 ».
- **Colonne de droite** « Vos réponses » : les 6 réponses (mises à jour si le changement les touche) et les versions de la spec.

### Le Lead découpe (`17`)
Rien à valider. Bloc d'attente, les tickets trouvés au fur et à mesure (cartes en pointillés pour celui qui est encore cherché). Colonne de droite « En ce moment » : ce que fait le Lead, étape par étape.

### Plan (`18` à `21`, `26`)
La page Prepare livrée, avec le fil des étapes au-dessus.

## Inventé pour la maquette
Les textes des questions et des réponses de Pilot, la spec, les durées d'attente (« environ 2 min », « environ 3 min »), le ticket FG-761 et les issues de la liste. Seuls les mécanismes et le dessin sont validés.

## Questions ouvertes (à confirmer avec Nicolas)
1. **Langue** : ce parcours est en français avec « vous » ; Prepare et Develop sont en anglais.
2. **Phases** : ce parcours en montre quatre (Préparer, Développer, Tester, Valider), les pages Develop trois (Prepare, Develop, Validate).
3. **Page Plan** : elle garde « Approuver et lancer » dans son bandeau, sans composeur. Pour l'homogénéité, elle pourrait recevoir le même composeur.
4. **Réponse écrite par l'utilisateur** : aujourd'hui Pilot la reformule et l'on valide encore une fois. L'autre option : Pilot l'enregistre et passe directement à la question suivante.
