/** Preferences locales (aucune donnee ne quitte l'appareil). */

const CLE = 'sorel-transit:preferences';

const DEFAUTS = {
  theme: 'auto',
  arretFavori: 'Terminus des Promenades - STC',
  ligneFavorite: 'ligne10',
  zoneOrigine: '1',
  zoneDestination: '',
  vue: 'maintenant',
};

let cache = null;

export function preferences() {
  if (cache) return cache;
  try {
    cache = { ...DEFAUTS, ...JSON.parse(localStorage.getItem(CLE) || '{}') };
  } catch {
    cache = { ...DEFAUTS };
  }
  return cache;
}

export function definir(modifications) {
  cache = { ...preferences(), ...modifications };
  try {
    localStorage.setItem(CLE, JSON.stringify(cache));
  } catch {
    /* navigation privee ou stockage refuse : les preferences restent en memoire */
  }
  return cache;
}
