# Journal des changements

Tous les changements notables de Sorel Transit sont consignés ici. Le format
suit [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) ; le projet est
publié en continu, les entrées sont donc datées plutôt que numérotées.

## 2026-10-18 — Réponse à l'audit externe (82/100)

### Ajouté

- Moteur de règles de réservation du taxibus isolé dans
  `assets/js/booking-rules.js`, pur et testé unitairement, avec la forme
  générique `evaluateBookingStatus` (dates JS, résultat gelé).
- Client du flux GTFS-RT à états explicites dans `assets/js/gtfs-client.js` :
  `TransitFeedService` (EventTarget), modes DIRECT / DEGRADE_HORAIRE /
  HORS_LIGNE, timeout strict de 10 secondes.
- Outillage de développement : ESLint, Prettier, TypeScript en mode
  `checkJs` sur les annotations JSDoc, Ruff pour les scripts Python.
- CI : analyse statique JavaScript et Python, audit Lighthouse (accessibilité
  bloquante à 0,90), analyse CodeQL, Dependabot hebdomadaire.
- Documentation : LICENSE (MIT), CONTRIBUTING.md, ARCHITECTURE.md, badges CI
  dans le README, section détaillant les fichiers de `data/` et leurs
  fréquences de synchronisation.

### Corrigé

- L'échappement iCalendar du point-virgule (`\;`, RFC 5545) manquait dans les
  fichiers `.ics` de rappel produits par `assets/js/rappel.js` ; le test qui
  attendait la chaîne fautive a été corrigé avec la source.

## 2026-08-30 — Première version publique (demande #1)

### Ajouté

- Heures limites de réservation du taxibus : délai de 30 minutes combiné à la
  fermeture du Terminus des Promenades, compte à rebours et état par départ.
- Suivi en direct par le flux GTFS-RT de Zenbus : positions GPS, prévisions
  aux arrêts, avis de service et courses supprimées affichées barrées.
- Écran « Mon retour » : express de Longueuil prolongés par un taxibus, temps
  d'attente, verdict de réservation et rappel calendrier (`.ics`).
- Ligne 10 complète (43 arrêts), parcours réel dessiné hors ligne, arrêts les
  plus proches calculés sur l'appareil.
- Veille hebdomadaire des horaires publiés par la STC
  (`tools/veiller_sources.py`), avec issue automatique au premier écart.
- Accessibilité : navigation complète au clavier, lecteurs d'écran, contrastes
  mesurés et corrigés, focus préservé lors des redessins.
- Les nouvelles versions du service worker s'annoncent par un bandeau au lieu
  de s'imposer pendant la lecture.
- Vérifications en CI dès la première version : tests unitaires du calcul
  des heures limites, cohérence des horaires et de la coquille hors ligne.
