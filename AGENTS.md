# Mission Control — règles pour les agents

## Avant de travailler
Lis `docs/contexte.md`, puis la spec ou le plan de ta mission dans `docs/missions/<ticket>/`, puis les décisions qu'il cite dans `docs/decisions/`. Un dev ne lit que son ticket, sa mission et les décisions citées.

## Où vont les documents
- `docs/contexte.md` : le projet en une page. Mis à jour par Pilot à la clôture d'une mission, si une décision a changé l'architecture ou une règle.
- `docs/decisions/` : une décision par fichier, numérotée. Une décision ne se modifie pas : une nouvelle la remplace et le dit. Elle n'est valable qu'avec l'accord de Nicolas.
- `docs/missions/<ticket>/` : `spec.md`, `decoupage.md`, `bilan.md`. Un fichier par auteur : deux agents n'écrivent jamais le même fichier.
- `docs/index.md` : généré, jamais écrit à la main.
- Chaque document porte en tête : titre, statut, date, auteur.

## Règles de travail
- Un ticket ou une consigne dit quoi obtenir et comment on saura que c'est fini. Le dev choisit son approche.
- Tests écrits avant le code pour tout ce qui touche à l'envoi dans un terminal, à l'outil de tickets ou à git.
- L'auteur d'un changement ne fait jamais sa propre revue : relecteur de l'autre famille de modèle, sur un commit précis.
- Aucun push, fusion, création de dépôt distant ou écriture dans un outil de tickets réel sans l'accord explicite de Nicolas, tant que le système ne le fait pas lui-même dans le cadre d'une mission validée.
- Aucun secret dans le dépôt, les journaux, les captures ou les consignes.
- Aucune mention de l'auteur (Claude ou Codex) dans les commits et les PR.
- Tout texte visible à l'écran est en français, rédigé par Codex et choisi par Nicolas.
- Pas de rustine : un défaut se corrige à sa cause. Si la cause n'est pas trouvée, on le dit au lieu d'ajouter une couche.
- Ne jamais modifier l'ancien système ni son installation de Herdr.

## Calibrage : faire petit
L'ancien système est devenu une usine à gaz parce que chaque cas imaginé est devenu une règle. Ici, la mesure d'un bon lot est ce qu'il n'a pas ajouté.

- Fais ce que le lot demande, rien de plus. Pas de commande, d'état, d'option ni de réglage que le critère de réussite n'exige pas.
- Ne traite pas un cas hypothétique. Si tu vois un cas limite que le lot ne demande pas, ne le code pas : note-le dans ton compte rendu, sous « Non traité », en une ligne. Nicolas décide.
- Pas d'abstraction pour un seul usage. Une couche, une interface ou un fichier de plus se justifie par deux usages réels, pas par un usage futur.
- Avant d'ajouter un état ou une commande, vérifie qu'un existant ne suffit pas, et dis-le dans le compte rendu.
- Taille : un lot de moteur vise quelques centaines de lignes de code, tests à part. Au-delà de 400 lignes, arrête-toi et demande : le lot est trop gros ou tu en fais trop.
- Tests proportionnés : ils vérifient le contrat du lot (ce qui entre, ce qui sort, les refus demandés), pas chaque branche imaginable. Les tests ne dépassent pas nettement le code qu'ils vérifient.
- Un refus ou un code d'erreur n'existe que si quelqu'un s'en sert : un écran qui l'affiche, ou un agent qui agit dessus.
- Le compte rendu finit par trois listes courtes : ce qui est fait, ce qui est volontairement non traité, ce qui pourrait être retiré.
- Le relecteur vérifie la proportion comme le reste : tout ce que le lot ne demandait pas est une remarque « à retirer ».
