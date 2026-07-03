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
route (détails plus bas).

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
  copas → ouros → espadas → paus, force croissante dans chaque enseigne. Le
  moteur ne trie rien ; c'est purement un tri d'affichage sur `hand.myHand`
  avant rendu.
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
    retours avec l'utilisateur, à retoucher si retour "pas parfait" sans
    précision (dernier état connu : fonctionnel mais peut-être encore à
    affiner, voir avec l'utilisateur ce qui cloche exactement avant de
    retoucher au hasard).
  - Badge donneur (`.dealer-badge`, jeton doré "D") sur l'opponent-chip ou le
    score-chip de `hand.players[hand.dealerIndex]`, recalculé à chaque rendu.

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
- **Animation de mise en évidence de la carte piochée (fin de pli 1-3, voir
  plus haut) : dernier retour utilisateur "pas parfait" sans plus de détail**,
  juste avant qu'il n'aille se coucher (2026-07-04). Les timings ont déjà été
  ajustés deux fois (durée d'affichage, vitesse d'intégration) suite à ses
  retours précédents. À reprendre en lui demandant précisément ce qui ne va
  pas (position ? vitesse ? lisibilité ? autre chose ?) plutôt que de
  retoucher au hasard.

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

Il n'existe pas de script/commande pour vérifier automatiquement qu'un
déploiement Render a réussi depuis cet environnement — c'est à vérifier
manuellement sur l'URL publique (`https://<nom-du-service>.onrender.com`)
après le push, **sauf si l'utilisateur fournit une clé API Render** (donnée
en clair dans le chat lors d'une session précédente, non stockée dans ce
repo ni ailleurs pour des raisons de sécurité — si besoin, la redemander).
Avec une clé, vérifier via l'API :

```bash
curl -s -H "Authorization: Bearer $RENDER_API_KEY" \
  "https://api.render.com/v1/services/srv-d93orn57vvec73deij20/deploys?limit=1"
```

Service id du web service `copas-online` : `srv-d93orn57vvec73deij20`.
Attendre `deploy.status == "live"` avec `deploy.commit.id` correspondant au
commit poussé (séquence typique : `build_in_progress` → `update_in_progress`
→ `live`, ~15-30s).
