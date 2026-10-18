# Architecture

Sorel Transit est une PWA entièrement statique, hébergée sur GitHub Pages.
Il n'y a ni serveur, ni compte, ni étape de compilation : les fichiers du
dépôt sont les fichiers servis. Cette page cartographie les modules et les
choix qui structurent l'ensemble.

## Vue d'ensemble

```
index.html                  Coquille : navigation, régions aria-live, ancres
assets/js/app.js            Point d'entrée : données, routage, horloge, SW
assets/js/vues/             Un module par écran, fonctions de rendu pures
assets/js/*.js              Modules métier et utilitaires (voir ci-dessous)
data/                       Horaires embarqués et table de correspondance GTFS
service-worker.js           Cache hors ligne de la coquille
tools/                      Scripts Python : extraction, vérification, veille
tests/                      Tests unitaires Node (node --test)
```

## Les modules

| Module             | Responsabilité                                                                                                                                              |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `calendrier.js`    | Le temps : fuseau America/Toronto, journée de service qui bascule à 3 h, jours fériés du Québec, profil d'un jour (service, ouverture du terminus).         |
| `reseau.js`        | L'interrogation des horaires embarqués : grilles, prochains passages, position estimée des véhicules, correspondances, retours prolongés par un taxibus.    |
| `booking-rules.js` | Le moteur de règles de réservation du taxibus : heure limite (délai de 30 min vs fermeture du terminus) et état d'un départ. Pur, sans DOM ni réseau.       |
| `tempsreel.js`     | Le décodage du flux GTFS-RT : positions, prévisions par arrêt, annulations, alertes. Renvoie `null` plutôt que de lever quand le flux est injoignable.      |
| `protobuf.js`      | Un lecteur Protocol Buffers minimal, juste ce qu'exige le schéma GTFS-RT.                                                                                   |
| `gtfs-client.js`   | La télémétrie du flux : interrogation périodique à délai maximal strict et machine à états `DIRECT` / `DEGRADE_HORAIRE` / `HORS_LIGNE` émise en évènements. |
| `plan.js`          | La géométrie du plan : projection des coordonnées, tracés SVG, distances.                                                                                   |
| `proximite.js`     | Géolocalisation de l'appareil et arrêts proches.                                                                                                            |
| `rappel.js`        | La génération du fichier `.ics` de rappel de réservation, alarme comprise.                                                                                  |
| `preferences.js`   | La persistance locale (thème, vue par défaut) dans `localStorage`.                                                                                          |
| `dom.js`           | La fabrique d'éléments `h()` / `s()` : tout enfant texte devient un nœud de texte, jamais du HTML interprété.                                               |
| `vues/*.js`        | Les écrans (maintenant, retour, autobus, taxibus, infos, correspondances, date, plan) : ils reçoivent un contexte, ils renvoient un arbre d'éléments.       |

## Flux de données

1. Au démarrage, `app.js` charge `data/horaires.json` (obligatoire) et
   `data/reseau-gtfs.json` (facultative : sans elle, pas de noms pour le flux,
   mais les horaires restent servis).
2. `gtfs-client.js` interroge le flux GTFS-RT de la STC toutes les 30
   secondes — requête `cache: 'no-store'`, délai maximal de 10 secondes —
   et remet à `app.js` les états décodés par `tempsreel.js`. Les vues
   n'affichent le temps réel que pour la journée en cours.
3. Quand le flux ne répond pas, les positions repassent en estimation
   horaire (`reseau.js`) et l'écran le dit : rien ne laisse croire qu'une
   heure estimée est observée.

## Cache et hors-ligne

Le service worker applique **stale-while-revalidate** à la coquille et aux
données de même origine : réponse depuis le cache d'abord, rafraîchissement
en arrière-plan pour la visite suivante. Le flux GTFS-RT, d'origine externe,
n'est jamais intercepté ni mis en cache. Une nouvelle version ne s'active
que sur un geste de l'usager (bandeau dans `app.js`), jamais sous ses yeux
pendant qu'il lit une heure limite.

## Sécurité

- Aucune donnée personnelle : pas de compte, pas de traceur, la position de
  l'appareil ne quitte pas l'appareil.
- Le contenu du flux GTFS-RT est traité comme non fiable : les textes
  d'alerte sont normalisés (`enTexteSimple`) puis insérés exclusivement via
  des nœuds de texte. La clé `html` de la fabrique `h()` n'est utilisée par
  aucune vue. Toute nouvelle vue doit préserver cet invariant.
- Dependabot surveille les dépendances de développement et les actions
  GitHub ; l'analyse de code (CodeQL) et la détection de secrets sont
  activées côté GitHub.

## Choix assumés

- **Pas de bundler, pas de framework.** Le coût d'exécution est nul et
  chaque panne possible se voit dans le code source servi. L'outillage
  moderne est présent là où il ne coûte rien à l'usager : ESLint, Prettier,
  TypeScript en `checkJs` et tests, tous en CI, tous hors du chemin de
  publication.
- **Typage progressif.** Les modules métier purs (`booking-rules.js`,
  `gtfs-client.js`) sont entièrement annotés en JSDoc et vérifiés par
  `tsc --noEmit` ; les autres modules s'annotent au fil des modifications.
- **Les données sont un livrable comme le code.** Trois vérificateurs
  Python (cohérence des horaires, table GTFS, coquille hors ligne) gardent
  chaque pull request, et une veille hebdomadaire compare les horaires
  embarqués à ceux que la STC publie.
