/**
 * Mise en cache hors-ligne.
 *
 * Un horaire consulte a l'arret, sans reseau, est le cas d'usage le plus
 * frequent : la coquille de l'application et les donnees sont donc servies
 * depuis le cache, puis rafraichies en arriere-plan.
 */

const VERSION = 'sorel-transit-v2';
const COQUILLE = [
  './',
  'index.html',
  'manifest.webmanifest',
  'assets/css/app.css',
  'assets/icone.svg',
  'assets/js/app.js',
  'assets/js/dom.js',
  'assets/js/calendrier.js',
  'assets/js/reseau.js',
  'assets/js/preferences.js',
  'assets/js/rappel.js',
  'assets/js/protobuf.js',
  'assets/js/tempsreel.js',
  'assets/js/vues/communs.js',
  'assets/js/vues/correspondances.js',
  'assets/js/vues/date.js',
  'assets/js/vues/retour.js',
  'assets/js/vues/maintenant.js',
  'assets/js/vues/autobus.js',
  'assets/js/vues/taxibus.js',
  'assets/js/vues/infos.js',
  'data/horaires.json',
  'data/reseau-gtfs.json',
];

self.addEventListener('install', (evenement) => {
  evenement.waitUntil(caches.open(VERSION)
    .then((cache) => cache.addAll(COQUILLE))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (evenement) => {
  evenement.waitUntil(caches.keys()
    .then((cles) => Promise.all(cles
      .filter((cle) => cle !== VERSION)
      .map((cle) => caches.delete(cle))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (evenement) => {
  const requete = evenement.request;
  if (requete.method !== 'GET') return;
  if (new URL(requete.url).origin !== self.location.origin) return;

  evenement.respondWith(caches.match(requete, { ignoreSearch: true })
    .then((enCache) => {
      const reseau = fetch(requete).then((reponse) => {
        if (reponse.ok) {
          const copie = reponse.clone();
          caches.open(VERSION).then((cache) => cache.put(requete, copie));
        }
        return reponse;
      }).catch(() => enCache);
      return enCache || reseau;
    }));
});
