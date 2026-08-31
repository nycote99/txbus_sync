/**
 * Arrets les plus proches d'une position.
 *
 * La ligne 10 compte quarante-trois arrets ; les nommer tous dans une liste
 * deroulante ne dit pas lequel est au coin de la rue. La position du navigateur
 * repond a cette question — et a elle seule : rien n'est envoye nulle part, le
 * calcul se fait ici.
 */

import { LIGNES } from './reseau.js';

const RAYON_TERRE = 6371000;

/** Distance en metres entre deux points, formule de haversine. */
export function distanceMetres(a, b) {
  const phi1 = (a.lat * Math.PI) / 180;
  const phi2 = (b.lat * Math.PI) / 180;
  const dPhi = phi2 - phi1;
  const dLambda = ((b.lon - a.lon) * Math.PI) / 180;
  const h = Math.sin(dPhi / 2) ** 2
    + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  return 2 * RAYON_TERRE * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** « 120 m », « 1,3 km ». */
export function distanceLisible(metres) {
  if (metres < 1000) return `${Math.round(metres / 10) * 10} m`;
  return `${(metres / 1000).toFixed(1).replace('.', ',')} km`;
}

/**
 * Arrets desservis par l'application, avec leur position.
 *
 * Les coordonnees viennent de la table GTFS ; sans elle — elle est facultative
 * — la liste est vide et l'appelant s'en passe.
 */
export function arretsSitues(donnees, reference) {
  if (!reference || !reference.arrets) return [];
  const vus = new Map();

  Object.keys(LIGNES).forEach((ligne) => {
    Object.values(donnees[ligne] || {}).forEach((service) => {
      Object.entries(service).forEach(([direction, bloc]) => {
        bloc.arrets.forEach((arret) => {
          const situe = arret.id ? reference.arrets[arret.id] : null;
          if (!situe) return;
          if (!vus.has(arret.id)) {
            vus.set(arret.id, {
              id: arret.id,
              nom: arret.nom,
              lat: situe.lat,
              lon: situe.lon,
              lignes: new Set(),
              directions: new Set(),
            });
          }
          vus.get(arret.id).lignes.add(ligne);
          vus.get(arret.id).directions.add(direction);
        });
      });
    });
  });

  return [...vus.values()].map((arret) => ({
    ...arret,
    lignes: [...arret.lignes],
    directions: [...arret.directions],
  }));
}

/**
 * En deca de cette distance, deux arrets sont le meme endroit.
 *
 * Mesure sur le reseau : les paires « meme coin de rue, autre trottoir » vont
 * de 2 a 54 m — parfois sous deux noms differents, « Du Roi / Charlotte » et
 * « Charlotte / Du Roi », ou « Gagné / Fillion » et « Gagné (caserne de
 * pompier) ». L'arret distinct suivant est a 78 m. Le seuil se pose dans cet
 * intervalle.
 */
export const MEME_ENDROIT = 60;

/**
 * Arrets les plus proches d'une position, un endroit par entree.
 *
 * Proposer les deux trottoirs d'une intersection n'aide personne a choisir :
 * on ne garde que le plus proche — celui dont on lira le nom sur le poteau —
 * en retenant les lignes et les directions des deux.
 */
export function arretsProches(donnees, reference, position, options = {}) {
  const { limite = 3, rayon = Infinity, ligne = null } = options;

  const candidats = arretsSitues(donnees, reference)
    .filter((arret) => !ligne || arret.lignes.includes(ligne))
    .map((arret) => ({ ...arret, distance: distanceMetres(position, arret) }))
    .filter((arret) => arret.distance <= rayon)
    .sort((a, b) => a.distance - b.distance);

  const retenus = [];
  candidats.forEach((arret) => {
    const meme = retenus.find((garde) => garde.nom === arret.nom
      || distanceMetres(garde, arret) <= MEME_ENDROIT);
    if (meme) {
      meme.lignes = [...new Set([...meme.lignes, ...arret.lignes])];
      meme.directions = [...new Set([...meme.directions, ...arret.directions])];
      meme.autresNoms = [...new Set([...(meme.autresNoms || []),
        ...(arret.nom === meme.nom ? [] : [arret.nom])])];
      return;
    }
    retenus.push({ ...arret, autresNoms: [] });
  });

  return retenus.slice(0, limite);
}

/**
 * Position du navigateur, ou un motif de refus lisible.
 *
 * On ne leve jamais : la geolocalisation est un raccourci, pas un passage
 * oblige. Un refus doit se dire en une phrase et laisser la liste deroulante
 * faire son travail.
 */
export function localiser(options = {}) {
  const { delai = 10000, geolocalisation } = options;
  const service = geolocalisation
    || (typeof navigator !== 'undefined' ? navigator.geolocation : null);

  if (!service) {
    return Promise.resolve({ erreur:
      'Ce navigateur ne sait pas donner votre position.' });
  }

  return new Promise((resoudre) => {
    service.getCurrentPosition(
      (mesure) => resoudre({
        position: {
          lat: mesure.coords.latitude,
          lon: mesure.coords.longitude,
          precision: mesure.coords.accuracy,
        },
      }),
      (echec) => resoudre({ erreur: motifDeRefus(echec) }),
      { enableHighAccuracy: true, timeout: delai, maximumAge: 60000 },
    );
  });
}

/** Message d'echec de geolocalisation, dans les termes de l'usager. */
export function motifDeRefus(echec) {
  const code = echec && echec.code;
  if (code === 1) {
    return 'Position refusée. Vous pouvez l’autoriser dans les réglages du '
      + 'navigateur, ou choisir votre arrêt dans la liste.';
  }
  if (code === 2) return 'Position indisponible pour l’instant.';
  if (code === 3) return 'La localisation a pris trop de temps.';
  return 'Position introuvable.';
}
