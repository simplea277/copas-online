# Copas Online

## Qu'est-ce que ce projet

Jeu de cartes multijoueur en temps réel (3 ou 4 joueurs), variante portugaise
de la Sueca centrée sur les copas (cœurs) : le but est d'en ramasser le moins
possible. Jouable depuis le téléphone de chaque joueur via un simple lien de
salon. Voir `README.md` pour les instructions d'installation/lancement côté
utilisateur — ce fichier-ci est pour la reprise du développement.

**État actuel : fonctionnel et déployé.** Plusieurs parties complètes (3 et 4
joueurs, jusqu'à la fin à 30 points) ont été jouées et testées en conditions
réelles par l'utilisateur, avec plusieurs bugs trouvés et corrigés en cours de
route (détails plus bas). Depuis, un mode joueurs bots (voir plus bas) a été
ajouté et testé (parties solo + parties mixtes humains/bots complètes), ainsi
qu'une section règles du jeu, des animations supplémentaires (pose de carte
avec nom du joueur, tas des plis joués) et plusieurs corrections successives
des animations de pioche. Une session de retouches UI/UX supplémentaire a
suivi le 2026-07-06 (voir décisions techniques ci-dessous pour le détail) :
rythme des bots ralenti et synchronisé avec les animations, noms de bots fixes
(Tia/Romaric/Cyrano/Rose), compteur de copas de la manche en cours (moi +
adversaires), bouton pour inverser le sens de tri de la main, boutons
"Quitter"/"Règles" compactés en icônes harmonisées, bannière "phase de
pioche" allégée, correctif `100dvh` pour la barre d'adresse Safari sur
iPhone. Le 2026-07-09, plusieurs pistes ont été essayées pour rendre mon
tour plus visible (halo autour de ma main, puis halo autour du contour de
l'écran, vibration du téléphone au passage de tour) avant d'être
entièrement abandonnées sur demande de l'utilisateur, qui a préféré revenir
à l'indicateur d'origine (bordure dorée simple sur les cartes jouables +
message de statut texte) — voir "Fausses pistes essayées puis abandonnées"
ci-dessous. Tout est testé et confirmé fonctionnel par l'utilisateur à ces
dates, sauf mention contraire ci-dessous.

## Stack et architecture

- **Node.js ≥ 18**, aucune base de données, aucun build step (JS servi tel quel).
- **Serveur** : `server.js` — Express (fichiers statiques de `public/`) +
  Socket.io (temps réel). État de toutes les parties en cours gardé **en
  mémoire** dans un objet `rooms` (pas de persistance disque/DB — un redémarrage
  du serveur perd toutes les parties en cours).
- **Moteur de jeu** : `game/engine.js` — logique pure des règles (distribution,
  plis, scores), sans dépendance réseau/UI, testée isolément dans
  `game/engine.test.js` (`npm test`).
- **Client** : `public/client.js` — vanilla JS sans framework ni build, un seul
  gros fichier avec un pattern `state` + `render()` (re-génère `innerHTML` à
  chaque changement d'état). `public/style.css` pour le style, `public/index.html`
  le squelette HTML minimal.
- **Déploiement** : Render (plan gratuit), voir section dédiée plus bas.
- **Repo GitHub** : `github.com/simplea277/copas-online`, branche `main`. Push
  sur `main` déclenche normalement un redéploiement auto sur Render (à vérifier
  si ça semble ne pas se déclencher — l'auto-deploy peut être désactivé côté
  dashboard Render).

### Décisions techniques importantes

- **Identité joueur découplée du socket.id.** Chaque joueur a un `playerId`
  (UUID stable, utilisé comme clé partout dans le moteur — mains, scores) et un
  `socketId` (connexion courante, qui change à chaque reconnexion). Un
  `sessionToken` (secret, jamais diffusé aux autres joueurs) permet de
  reprendre sa place via l'événement `session:resume`, stocké côté client dans
  `localStorage` (`copas:session` = `{code, sessionToken}`). Voir la fonction
  `leaveGame()` dans `client.js` pour l'invalidation propre de cette session
  (bouton "Quitter la partie").
- **Tous les gestionnaires Socket.io sont enveloppés dans un try/catch**
  (`withErrorHandling` dans `server.js`) + validation des payloads entrants
  (carte jouée, nom, code de salon) avant de les passer au moteur. Nécessaire
  car une exception non rattrapée dans un handler socket.io faisait planter
  **tout le process Node**, déconnectant tous les joueurs de toutes les
  parties en cours (bug de prod corrigé, voir historique ci-dessous).
- **Enseignes portugaises dessinées en SVG inline** (`SUIT_SVG` dans
  `client.js`) à la place des symboles ♠♥♦♣ : épées (bleu azulejo), coupes
  (rouge), deniers (or/bronze), bâtons (brun). Couleurs définies en variables
  CSS (`--suit-espadas`, `--suit-copas`, `--suit-ouros`, `--suit-paus`) dans
  `style.css`, cohérentes avec le thème vert tapis / or / ivoire.
- **Tri de la main côté client uniquement** (`sortHand()` dans `client.js`) :
  copas → ouros → espadas → paus (ordre des enseignes toujours fixe), force
  croissante ou décroissante dans chaque enseigne selon `state.handSortDesc`.
  Le moteur ne trie rien ; c'est purement un tri d'affichage sur
  `hand.myHand` avant rendu. Bascule via le bouton "Tri" (`#btn-sort-toggle`,
  au-dessus à gauche de `.my-hand-wrap`) ; préférence mémorisée dans
  `localStorage` (`copas:handSortDesc`), volontairement absente de la remise
  à zéro de `leaveGame()` pour persister entre parties/rechargements. Le
  bouton est en miroir exact du compteur de copas de la manche en cours
  (voir plus bas) — même ligne, même boîte visuelle (`.my-copas-count` /
  `.my-sort-toggle-btn` partagent les mêmes valeurs de padding/bordure/
  arrondi/taille de police dans `style.css`) : si l'un des deux est retouché
  visuellement, l'autre doit suivre pour rester assorti. **Piège déjà
  rencontré une fois** : lors d'une harmonisation, le style du bouton "Tri"
  a été appliqué par erreur au compteur de copas au lieu de l'inverse — la
  référence stylistique du couple, c'est le compteur de copas (petit badge
  compact, coins à 10px, padding 2px 7px sauf le padding horizontal du
  bouton "Tri" élargi à 13px pour que le texte respire), pas le bouton.
- **Fin de manche anticipée dès que les 10 copas ont toutes été jouées**
  (`engine.js`, `resolveTrick()`) : plus besoin d'attendre que toutes les
  mains soient vides si le score est déjà scellé. `result.earlyEnd` distingue
  ce cas d'une fin normale, affiché à l'utilisateur dans l'overlay de fin de
  manche (`game:handOver` → `earlyEnd`).
- **Animations cosmétiques (distribution + pioche) pilotées par des petites
  machines à états dans `client.js`** (`state.dealAnim`, `state.drawAnim`,
  `state.justDrawnStage`), toutes suivant le même pattern : un id incrémental
  (`dealAnimCounter`) permet à toute étape en cours de se rendre obsolète
  proprement (vérifiée à chaque `setTimeout`) si un état plus récent arrive
  entre-temps, sans jamais bloquer le jeu ni planter. Toutes respectent
  `prefers-reduced-motion` en sautant directement à l'état final. Éléments
  volants créés dynamiquement dans `#deal-anim-layer` (`pointer-events:none`),
  positionnés via `getBoundingClientRect()` sur des ancres `data-anchor`
  posées sur les éléments concernés (`.opponent`, `.score-chip` du donneur,
  `.my-hand-wrap`, `.draw-pile`).
  - Distribution initiale (début de manche) : cartes envoyées une par une en
    tournant autour de la table (`computeDealSequence`), puis à 3 joueurs une
    étape "pile" dépose la pioche restante au centre.
  - Pioche visible à 3 joueurs (`.draw-pile`) : une seule carte dos face
    cachée avec le nombre restant affiché dessus (pas un badge à part),
    alignée en bas sur les cartes du pli en cours.
  - Pioche en fin de pli (plis 1-3) : après l'affichage du pli résolu,
    rejoue une mini-distribution depuis `.draw-pile` vers chaque joueur.
    **Le contenu réel d'une carte piochée n'est envoyé qu'au joueur
    concerné** (`server.js` émet `game:trickResolved` par socket, pas en
    broadcast room-wide : `myDrawnCard` = contenu réel pour moi, `drawOrder`
    = liste publique des ids sans contenu pour rejouer l'animation chez les
    autres). Ma carte piochée s'affiche ~2,2s face visible au-dessus de ma
    main (`.just-drawn-ghost`) avant de s'intégrer lentement (~1s) avec un
    halo doré (`.pcard.just-drawn`) — timings réglés sur plusieurs allers-
    retours avec l'utilisateur. Le dernier souci connu sur cette animation
    (un flash parasite de la carte dans la main juste avant le ghost, voir
    bug corrigé plus bas) est réglé et confirmé par l'utilisateur.
  - Badge donneur (`.dealer-badge`, jeton doré "D") sur l'opponent-chip ou le
    score-chip de `hand.players[hand.dealerIndex]`, recalculé à chaque rendu.
- **Animation de pose de carte dans le pli en cours** (`beginTrickCardArrival`
  dans `client.js`) : chaque carte jouée (la mienne comme celles des
  adversaires) vole visuellement depuis la position du joueur qui l'a posée
  (`data-anchor="player-X"`, déjà posé sur `.opponent`/`.my-hand-wrap`)
  jusqu'à son emplacement dans `.trick-slots`, plutôt que d'apparaître
  instantanément (~650ms, cf. `TRICK_ARRIVE_MS`). Contrairement aux autres
  vols du projet (clones indépendants dans `#deal-anim-layer`), celle-ci est
  rendue **directement à sa place** dans la grille, animée par un
  `@keyframes` CSS paramétré par carte via des variables CSS
  (`--arrive-dx`/`--arrive-dy`) + un `animation-delay` négatif basé sur le
  temps écoulé (même principe que `.just-drawn-ghost`) : nécessaire pour
  survivre à un `render()` intercurrent (un autre joueur qui joue pendant que
  celle-ci vole encore) sans jamais disparaître puis réapparaître (voir bug
  corrigé plus bas). Le nom du joueur s'affiche au-dessus de chaque carte
  (`renderTrickSlot`) tant que le pli reste visible au centre, qu'il soit en
  cours de constitution ou déjà résolu (juste avant l'envol vers le tas des
  plis joués).
- **Tas des "plis joués" animé** (`.trick-pile-stack`, `runTrickPileAnim`) :
  widget discret sur le bord droit qui grossit au fil de la manche, avec un
  effet de pile négligée (rotation/décalage aléatoires par carte, voir
  `.trick-pile-stack .trick-pile-card` dans `style.css`) plutôt que des dos
  de carte parfaitement alignés. Un clic affiche le dernier pli résolu (les
  vraies cartes + le gagnant), un second clic referme.
- **Mode joueurs bots** (`game/botAI.js` + `server.js`) : un salon peut être
  complété avec des bots (bouton "Compléter avec des bots" dans la salle
  d'attente, événement `room:fillBots`) ou lancé directement en solo contre
  l'ordinateur. `chooseBotCard(hand, playerId)` implémente une heuristique
  simple (jamais de coup illégal, testé par simulation dans
  `botAI.test.js`) : évite les copas à l'ouverture, gère différemment un pli
  "dangereux" (contient des copas) selon qu'il peut ou non éviter de le
  gagner, défausse la copa la plus haute quand il ne peut pas suivre.
  - **Noms fixes, piochés sans doublon** : `BOT_NAMES` dans `server.js` =
    `['Bot Tia', 'Bot Romaric', 'Bot Cyrano', 'Bot Rose 🕊️']` (liste demandée
    par l'utilisateur, y compris l'emoji colombe sur "Rose"). `pickBotNames()`
    mélange les noms non déjà utilisés dans le salon et les distribue un par
    un ; repli (concaténation d'un numéro) si jamais plus de bots que de noms
    sont nécessaires (cas qui ne devrait pas arriver vu `maxPlayers` ≤ 4).
  - **Rythme en deux temps** (`scheduleBotTurnIfNeeded`) : d'abord le temps
    qu'il reste avant la fin estimée des animations client en cours
    (`room.animationBusyUntil`, mis à jour par `markAnimationBusy()` à
    chaque distribution/pose de carte/résolution de pli — durées calquées
    sur les constantes réelles de `client.js`, voir `dealAnimDurationMs()`/
    `trickResolveAnimDurationMs()` dans `server.js`), puis un temps de
    réflexion (`botThinkDelayMs`) de **900-1400ms** si un seul coup est
    possible, sinon **~1500-3000ms**. Remplace l'ancien délai fixe
    (700-1500ms sans lien avec les animations), qui pouvait faire jouer un
    bot pendant qu'une animation cliente n'était pas terminée. `handleCardPlay`
    (factorisé) gère aussi bien un coup humain (`game:playCard`) qu'un coup
    de bot, et rappelle `scheduleBotTurnIfNeeded` après chaque coup pour
    enchaîner naturellement d'un bot au suivant.
- **Section "Règles du jeu"** (`renderRulesOverlay` dans `client.js`) :
  overlay accessible depuis l'accueil (onglets 3/4 joueurs, celui à 3 actif
  par défaut) et depuis une partie en cours (version correspondant au nombre
  de joueurs réel de la manche, sans onglets). Contenu verbatim fourni par
  l'utilisateur (`RULES_INTRO_HTML`, `RULES_3P_HTML`, `RULES_4P_HTML`),
  incluant les noms portugais des figures (Dama/Rei).
- **Compteur de copas de la manche en cours** (`hand.tricksWonCopas`, déjà
  calculé côté serveur, remis à zéro à chaque nouvelle manche) : affiché
  pour moi (`.my-copas-count`, au-dessus à droite de `.my-hand-wrap`) et
  pour chaque adversaire (`.copas-count` dans son `.opponent` chip), au
  format `+X` avec l'icône SVG `SUIT_SVG.copas` (jamais un emoji cœur).
  Couleur dédiée `--copas-bright` (`#ff6b6b`, rouge vif) plutôt que `--copas`
  (rouge brique pensé pour l'ivoire des cartes, peu lisible sur le tapis
  vert). Le nombre de cartes en main des adversaires (`X cartes`) a été
  retiré de leur chip à la même occasion (jugé peu utile).
- **Boutons "Quitter"/"Règles" compactés en icônes** (`.hud-btn`/
  `.hud-btn-face` dans `style.css`) : croix ✕ et libellé "Règles" dans des
  pilules de même échelle (34px de haut), chacune portée par un élément
  `<button>` de 40x40px minimum (zone tactile mobile) contenant une face
  visuelle plus petite centrée dedans. Le bouton "Quitter" n'est pas rendu
  du tout tant que l'overlay des règles est ouvert (évite qu'il reste
  cliquable par-dessus). `.table-wrap` a un `padding-top: 60px` calé pour
  que la rangée de score-chips (et le badge donneur qui déborde de 8px
  au-dessus du chip concerné) passe toujours sous ces boutons fixes, y
  compris à 4 joueurs où les chips s'étalent davantage.
- **`100dvh` (avec repli `100vh`) sur `#app`** (`style.css`) : `100vh` seul
  ne tient pas compte de la barre d'adresse Safari sur iPhone, provoquant un
  défilement vertical parasite quand elle apparaît/disparaît au scroll.

## Fausses pistes essayées puis abandonnées

- **Halo lumineux doré pour indiquer mon tour (myTurn).** Le 2026-07-09,
  plusieurs variantes ont été essayées en session pour renforcer
  l'indicateur visuel de tour au-delà de la bordure dorée déjà présente sur
  les cartes jouables : halo diffus autour de la zone de ma main
  (`.my-hand-wrap`, puis un cadre `.my-hand-frame` dédié pour coller à la
  largeur réelle des cartes plutôt qu'à la largeur pleine écran), puis halo
  diffus autour de tout le contour de l'écran (`.turn-glow-overlay`, en
  `box-shadow` inset plein viewport). Une vibration du téléphone au moment
  du passage de tour a aussi été essayée à la même occasion. **Toutes ces
  pistes ont été entièrement retirées sur demande explicite de
  l'utilisateur** (aucune trace de code résiduelle, vérifié par diff avec le
  commit d'avant ce chantier) — l'indicateur de tour reste donc uniquement
  la bordure dorée sur `.my-hand .pcard.playable` + le message de statut
  texte ("À toi de jouer !" / "Au tour de X…"), comme avant cette session.
  À ne pas réintroduire une variante similaire sans que l'utilisateur ne le
  redemande explicitement.

## Bugs corrigés (et pourquoi, pour éviter de les réintroduire)

1. **Crash serveur global sur payload malformé.** Un `game:playCard` (ou
   `room:create`/`room:join`) avec des données invalides/absentes levait une
   exception non rattrapée dans le handler socket.io → tout le process Node
   plantait → tous les joueurs de toutes les parties déconnectés. Corrigé par
   try/catch systématique + validation des cartes/noms/codes avant appel au
   moteur (`server.js`).
2. **Pas de reconnexion après refresh/coupure réseau.** Tout était indexé par
   `socket.id`, qui change à chaque reconnexion → main/score perdus. Corrigé
   par le système `playerId` (stable) + `sessionToken` (secret) +
   `session:resume`, décrit plus haut.
3. **Impossible de quitter une partie en cours.** Conséquence du point 2 : le
   token de session restait valide indéfiniment, donc tout rechargement de
   page ramenait automatiquement dans l'ancienne partie. Ajout d'un bouton
   "Quitter la partie" (`leaveGame()` + événement serveur `room:leave`, qui
   invalide le `sessionToken`) et de garde-fous côté client pour ignorer les
   évènements tardifs de l'ancien salon une fois revenu à l'accueil.
4. **Fin de manche prématurée à 3 joueurs (copas perdues).** `resolveTrick()`
   dans `engine.js` terminait la manche dès que 10 plis étaient joués, quel
   que soit le nombre de joueurs. Or à 3 joueurs, la pioche de 9 cartes
   distribuées pendant les 3 premiers plis rallonge la manche à **13 plis**
   (39 cartes ÷ 3), pas 10 : la manche s'arrêtait 3 plis trop tôt, avant que
   toutes les copas n'aient été jouées (scores de manche ne totalisant pas
   10). Corrigé en basant la fin de manche sur l'état réel des mains (toutes
   vides) plutôt qu'un compteur fixe. Test de régression dans
   `engine.test.js` : simule une manche complète (3 et 4 joueurs) et vérifie
   que le total des copas vaut toujours 10.
5. **Écran bloqué sur "Chargement de la partie" après la manche finale.**
   Quand la dernière manche amenait un joueur à 30 points, le serveur vidait
   `room.currentHand` puis diffusait quand même un `hand:update` à `null` à
   tout le monde (dans `broadcastHandState`), écrasant l'écran de résultat
   final juste après l'avoir affiché. Corrigé en ne diffusant plus de
   `hand:update` quand `room.currentHand` est vide, + garde-fous côté client
   (`room:update`/`hand:update` ne doivent pas écraser un résultat de fin de
   partie en cours d'affichage).
6. **Repop/redémarrage de l'animation de la carte piochée ("double
   apparition").** `render()` régénère tout le `innerHTML` à chaque
   changement d'état (tour d'un adversaire, fin d'un envol...), ce qui
   remontait l'élément `.just-drawn-ghost`/`.pcard.just-drawn` et relançait
   son animation CSS depuis 0% à chaque fois. Corrigé en pilotant l'entrée
   par une fenêtre de temps précise (`justDrawnStageStartedAt`) avec
   `animation-delay` négatif pour reprendre au bon endroit si un `render()`
   intercurrent recrée l'élément en plein vol.
7. **Clignotement du compteur de pioche + décompte non séquencé.** Le
   compteur (phase des 3 premiers plis, 3 joueurs) sautait à sa valeur finale
   dès l'arrivée de `hand:update` (déjà décrémenté côté serveur), puis
   "revenait en arrière" le temps de l'animation avant de reconverger — un
   va-et-vient au lieu d'une transition propre. Corrigé en figeant
   l'affichage dès `game:trickResolved` (pas seulement au démarrage de
   l'animation 1400ms plus tard) et en décrémentant carte par carte en phase
   avec le vol de chaque carte. Ajout d'un id de séquence
   (`pendingDrawAnimId`) posé dès `trickResolved` : si un pli s'enchaîne plus
   vite que la séquence d'animation du précédent (~2,6s, arrive vite avec des
   bots ou joueurs rapides), l'ancienne séquence se détecte périmée et
   s'arrête proprement au lieu de continuer à décrémenter un compteur qui ne
   lui appartient plus. Ce même pattern d'id de séquence a ensuite servi de
   modèle pour les bugs 8 et 9 ci-dessous.
8. **Flash parasite de la carte piochée dans la main avant son animation
   ghost.** `hand:update` (carte déjà dans `myHand` côté serveur) arrivait et
   se rendait avant que le code d'animation ne prenne le relais : la carte
   piochée s'affichait donc brièvement mélangée aux autres cartes de la
   main, disparaissait, puis l'animation de vol se relançait correctement.
   Corrigé en ajoutant un stade intermédiaire `'pending'` posé immédiatement
   dans le handler `game:trickResolved` (la carte est retirée de la main dès
   cet instant, rien affiché à la place) plutôt que d'attendre `startDrawAnim`
   1400ms plus tard.
9. **Disparition parasite des cartes du pli pendant l'animation de pose de
   carte.** Introduit par la fonctionnalité elle-même (voir plus haut) : la
   carte volante vivait d'abord en clone externe dans `#deal-anim-layer`,
   une couche entièrement régénérée à chaque `render()`. Si un autre joueur
   posait sa carte pendant qu'une carte précédente était encore en vol, son
   clone se faisait détruire en plein vol pendant que la vraie carte restait
   cachée, jusqu'à ce que son propre minuteur la révèle bien plus tard — les
   autres cartes du pli disparaissaient donc un instant avant de réapparaître.
   Corrigé en rendant la carte qui arrive directement à sa place dans
   `.trick-slots` (voir plus haut), plus deux bugs connexes découverts en
   creusant : un filtrage par `hand.tricksPlayed` qui changeait de valeur
   avant la fin de l'animation de la dernière carte d'un pli (basculé sur un
   filtrage par index seul), et les N-1 autres cartes déjà posées qui se
   fiaient à `hand.currentTrick` (déjà vidé à ce moment-là) — figé désormais
   via `state.trickBeingResolved`. Confirmé résolu par l'utilisateur en test
   réel (2026-07-06) ; un cas résiduel plus rare persiste sous stress-test
   avec bots très rapides, voir section suivante.
10. **Chevauchement du bouton "Règles" et des score-chips sur mobile.** Le
    `padding-top` de `.table-wrap` n'avait été calé que pour l'ancien bouton
    "Quitter" (texte, ~24px de haut) ; insuffisant une fois ce bouton (et
    "Règles") transformés en icônes avec une zone tactile de 40px (voir
    `.hud-btn` plus haut), plus le badge donneur qui déborde de 8px au-dessus
    du score-chip concerné. Le premier/dernier chip (le plus proche d'un
    bord) passait donc sous le bouton, surtout à 4 joueurs. Corrigé en
    augmentant ce `padding-top` à 60px.

## Ce qu'il reste à faire / à surveiller

- **Limitations connues du README, toujours valables** : une seule partie à
  la fois par salon ; les salons inactifs sont supprimés après 5 minutes si
  tout le monde s'est déconnecté (voir `setTimeout` dans le handler
  `disconnect` de `server.js`).
- **Pas de gestion propre d'un abandon en cours de partie par un joueur
  autre que via le bouton "Quitter"** : si quelqu'un ferme simplement l'onglet
  sans cliquer "Quitter" et ne revient jamais, la partie reste bloquée en
  attendant son tour pour les autres joueurs (pas de timeout/remplacement
  automatique). À envisager si ça devient gênant en usage réel.
- **État 100% en mémoire** : un redéploiement/redémarrage du serveur Render
  (ou la mise en veille + réveil du plan gratuit) fait perdre toutes les
  parties en cours. Acceptable pour l'usage actuel (parties entre amis,
  courtes), mais à garder en tête si le projet grandit.
- **Pas de suite de tests end-to-end automatisée dans le repo** : toutes les
  vérifications de bout en bout (Socket.io multi-joueurs, Playwright pour le
  rendu visuel) ont été faites manuellement en session via des scripts
  temporaires (`*.tmp.js`, supprimés après usage) et des dépendances installées
  avec `--no-save` puis désinstallées. Si des régressions reviennent souvent,
  envisager de committer un vrai test end-to-end réutilisable plutôt que de
  recréer ce genre de script à chaque fois.
- **Vérifier que l'auto-deploy Render est bien actif** avant de pousser en
  supposant que ça se redéploie tout seul (sinon : Manual Deploy dans le
  dashboard Render).
- **Cas résiduel rare sur l'animation de pose de carte (bug 9 ci-dessus) :**
  sous stress-test avec des bots jouant à un rythme très rapide et régulier
  (300ms-1,4s, sans pause humaine), une carte du pli peut encore parfois
  disparaître brièvement (~300-650ms) avant de réapparaître, le plus souvent
  juste au moment où un pli se résout et que le suivant démarre. Cause
  exacte non identifiée malgré une investigation poussée (plusieurs
  hypothèses corrigées en cours de route, voir bug 9). **Confirmé résolu par
  l'utilisateur en conditions de jeu réelles** (rythme humain, 2026-07-06) ;
  à ne rouvrir que si ça revient en usage réel, en repartant du principe que
  le déclencheur est un chevauchement entre la fenêtre d'affichage du pli
  résolu (1400ms) et le pli suivant qui démarre côté serveur avant qu'elle
  ne soit passée côté client.
- **Chantier "historique des parties" (base de données) : pas encore
  commencé.** Voir section "Prochaines étapes" ci-dessous — actuellement
  aucune trace de Supabase ni de persistance dans le code (`grep -ri
  supabase` ne remonte que ce fichier). Le projet reste 100% en mémoire
  (voir plus haut) tant que ce chantier n'a pas démarré.

## Prochaines étapes prévues

- **Historique des parties persistant.** Actuellement, tout est en mémoire
  et perdu au moindre redémarrage serveur (voir plus haut) — aucune partie
  jouée n'est conservée nulle part une fois terminée. Idée évoquée par
  l'utilisateur : une base de données Supabase pour garder trace des parties
  passées (scores, date, joueurs) et pouvoir les consulter plus tard. Pas
  encore commencé : à cadrer avec l'utilisateur (quelles infos garder par
  partie/par manche ? consultable par qui — seulement les joueurs de la
  partie, ou une liste globale ?) avant d'introduire une dépendance externe
  (compte Supabase, clé API, schéma de table) dans un projet qui n'en a
  aucune aujourd'hui.
- **Section "histoire du site" avec photos.** Une page/section à ajouter
  (accueil ou séparée) racontant l'histoire du projet, avec des photos —
  contenu et emplacement exact à définir avec l'utilisateur le moment venu.
- **Autres retouches visuelles éventuelles**, au fil des retours de
  l'utilisateur en conditions de jeu réelles (ce projet avance surtout par
  petites itérations ciblées après une session de jeu, plutôt que par de
  grosses refontes planifiées à l'avance).

## Comment tester

```bash
cd copas-game
npm install
npm test        # tests unitaires du moteur (game/engine.test.js) — doivent tous passer
npm start        # démarre le serveur sur le port 3000 (ou $PORT)
```

Ouvrir `http://localhost:3000` dans plusieurs onglets pour simuler plusieurs
joueurs.

**Pour un test de bout en bout plus poussé** (comme fait au fil de cette
session) : installer temporairement `socket.io-client` et/ou `playwright` avec
`npm install --no-save <package>`, écrire un script Node dans le dossier du
projet (pas ailleurs, sinon problèmes de résolution de module) qui simule
plusieurs clients (création de salon, jointure, parties jouées automatiquement
en choisissant toujours la première carte jouable), puis désinstaller la
dépendance temporaire et supprimer le script une fois fini. C'est la méthode
qui a permis de détecter/vérifier les bugs 1, 2, 4 et 5 ci-dessus — utile pour
toute modification future touchant au moteur de jeu ou à la synchronisation
Socket.io.

Playwright (`chromium`) doit être installé une fois via
`npx playwright install chromium` s'il ne l'est pas déjà (~150 Mo, mis en
cache dans `%LOCALAPPDATA%\ms-playwright` sous Windows).

## Comment redéployer (Render)

Le déploiement se fait via GitHub → Render :

1. Committer et pousser sur `main` :
   ```bash
   git add <fichiers>
   git commit -m "..."
   git push origin main
   ```
2. Render (`github.com/simplea277/copas-online` connecté à un Web Service
   Render, plan gratuit) redéploie automatiquement sur push si l'auto-deploy
   est activé. Sinon : dashboard Render → le service → **Manual Deploy** →
   **Deploy latest commit**.
3. Build command : `npm install` — Start command : `npm start`.
4. Le plan gratuit met le serveur en veille après inactivité : le premier
   chargement après une veille peut prendre 30-60 secondes.

Depuis le 2026-07-06, une clé API Render est disponible **localement** dans
`.env` à la racine du repo (`RENDER_API_KEY=...`), gitignorée (vérifié
`.env` bien listé dans `.gitignore`, jamais commitée/poussée) — pas besoin
de redemander la clé à l'utilisateur tant que ce fichier existe. Vérifier un
déploiement :

```bash
set -a && source .env && set +a
curl -s -H "Authorization: Bearer $RENDER_API_KEY" \
  "https://api.render.com/v1/services/srv-d93orn57vvec73deij20/deploys?limit=1"
```

Service id du web service `copas-online` : `srv-d93orn57vvec73deij20`.
Attendre `deploy.status == "live"` avec `deploy.commit.id` correspondant au
commit poussé (séquence typique : `build_in_progress` → `update_in_progress`
→ `live`, ~30-45s en pratique). Si `.env` est absent (nouvel environnement,
clé expirée...), redemander une clé fraîche à l'utilisateur plutôt que de
supposer qu'une ancienne fonctionne encore.
