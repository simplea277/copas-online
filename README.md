# Copas Online — jeu de cartes multijoueur (3 ou 4 joueurs)

Variante portugaise de la Sueca centrée sur les copas (cœurs) : le but est
d'en ramasser le moins possible. Jouable depuis le téléphone de chaque
joueur via un simple lien.

## 1. Tester en local sur ton ordinateur

Il te faut [Node.js](https://nodejs.org) installé (version 18 ou plus récente).

```bash
cd copas-game
npm install
npm test        # lance les tests du moteur de jeu (doivent tous passer)
npm start        # démarre le serveur
```

Le serveur affiche `Serveur "Copas" lancé sur le port 3000`. Ouvre
`http://localhost:3000` dans plusieurs onglets de ton navigateur pour
simuler plusieurs joueurs et vérifier que tout fonctionne avant de
déployer.

## 2. Déployer en ligne gratuitement (pour jouer avec tes amis via un lien)

Plusieurs hébergeurs proposent un plan gratuit adapté à ce genre de petit
projet (Render, Railway, Fly.io...). Les conditions exactes de ces offres
changent souvent — vérifie l'offre actuelle au moment de déployer.
Étapes générales (valables pour la plupart de ces plateformes) :

1. Crée un compte sur la plateforme choisie.
2. Mets ce projet sur GitHub (ou connecte directement le dossier si la
   plateforme le permet).
3. Crée un nouveau service "Web Service" en pointant vers ce dépôt.
4. Build command : `npm install`
5. Start command : `npm start`
6. Une fois déployé, tu obtiens une URL publique (ex :
   `https://ton-jeu.onrender.com`) — c'est ce lien que tu partages à tes
   amis.

Note : les hébergeurs gratuits mettent parfois le serveur en veille après
un moment d'inactivité (le premier chargement peut alors prendre 30-60
secondes le temps qu'il se réveille). C'est normal sur les plans gratuits.

## Structure du projet

```
copas-game/
  server.js              serveur Node.js (Express + Socket.io)
  game/
    engine.js             logique pure des règles du jeu
    engine.test.js         tests unitaires du moteur
  public/
    index.html
    style.css
    client.js              interface jouée par chaque joueur
```

## Limitations connues (MVP)

- Pas de reconnexion automatique : si un joueur ferme son onglet ou perd
  la connexion en cours de partie, il ne peut pas la rejoindre à nouveau
  (à améliorer si besoin).
- Une seule partie à la fois par salon ; les salons inactifs sont
  supprimés après 5 minutes si tout le monde s'est déconnecté.
