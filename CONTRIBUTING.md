# Contribuer à Sorel Transit

L'application est un site statique sans étape de compilation : les fichiers du
dépôt sont les fichiers servis. Tout l'outillage ci-dessous sert à vérifier,
jamais à transformer le code avant publication.

## Prérequis

- **Node.js 18 ou plus** (la CI utilise Node 22) — pour les tests et les
  contrôles statiques. L'application elle-même n'a besoin de rien.
- **Python 3.12** — pour les vérificateurs de données et les outils
  d'extraction des horaires dans `tools/`.
- Aucune dépendance à l'exécution. Les dépendances npm sont des outils de
  développement uniquement (`devDependencies`).

## Installation

```bash
git clone https://github.com/nycote99/txbus_sync.git
cd txbus_sync
npm ci
```

## Lancer l'application

```bash
npx serve .
# ou
python3 -m http.server 8000
```

Puis ouvrir `http://localhost:3000` (ou `:8000`). Le service worker ne
s'enregistre qu'en HTTPS ou sur `localhost`.

## Vérifications

Chaque commande doit passer avant d'ouvrir une pull request ; la CI les
rejoue toutes.

| Commande               | Rôle                                                                                        |
| ---------------------- | ------------------------------------------------------------------------------------------- |
| `npm test`             | Tests unitaires (node --test) : règles de réservation, calendrier, GTFS-RT, client à états. |
| `npm run verifier`     | Cohérence des données embarquées, table GTFS et coquille hors ligne (Python).               |
| `npm run lint`         | ESLint sur l'application et les tests.                                                      |
| `npm run typecheck`    | TypeScript en mode `checkJs` sur les annotations JSDoc.                                     |
| `npm run format:check` | Prettier : le formatage est homogène.                                                       |
| `ruff check tools/`    | Ruff sur les scripts Python.                                                                |

`npm run format` applique le formatage Prettier d'un coup.

## Conventions

- **Zéro dépendance à l'exécution, zéro compilation.** Un module ajouté dans
  `assets/js/` doit être ajouté à la liste `COQUILLE` de `service-worker.js`
  (le vérificateur de coquille échoue sinon) et la version du cache incrémentée.
- **La logique métier est pure et testée.** Tout calcul d'heure limite, de
  correspondance ou de position doit être couvert par un test dans `tests/`,
  importable sans DOM ni réseau.
- **Aucun `innerHTML` avec des données extérieures.** Les textes du flux
  GTFS-RT passent par la fabrique `h()` de `dom.js`, qui insère des nœuds de
  texte. C'est l'invariant anti-XSS du projet ; ne pas le contourner.
- **Accessibilité non négociable** : navigation au clavier complète, focus
  restauré après chaque rendu, changements importants annoncés dans la région
  `aria-live`.
- Commentaires en français, dans le ton du code existant : ils expliquent le
  _pourquoi_ (la règle de la STC, le cas limite), jamais le _quoi_.

## Pull requests

1. Une branche par sujet, des commits au message explicite en français.
2. `npm test`, `npm run verifier`, `npm run lint`, `npm run typecheck` et
   `npm run format:check` verts en local.
3. La CI rejoue ces contrôles plus un audit Lighthouse ; le déploiement sur
   GitHub Pages n'a lieu qu'après fusion dans `main`, contrôles réussis.
