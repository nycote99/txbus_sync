/**
 * Geometrie du plan du reseau : projeter des coordonnees en points de dessin.
 *
 * Le module s'appelle « plan » et non « carte » parce que `carte()` designe
 * deja une fiche dans les vues — deux sens du meme mot dans le meme code
 * finissent toujours par se confondre.
 *
 * Pas de tuiles, pas de bibliotheque, pas de requete a un tiers. Le reseau
 * tient dans quatre polylignes embarquees (8 ko) et se dessine en SVG — ce qui
 * le rend aussi disponible hors ligne que le reste de l'application, et ne
 * signale a personne quel arret on regarde.
 *
 * La projection est equirectangulaire, calee sur le centre de ce qu'on dessine.
 * A l'echelle du territoire — soixante kilometres au plus — elle est exacte a
 * mieux que le pixel, la ou Mercator ne servirait qu'a compliquer.
 */

/** Metres par degre a la latitude de Sorel-Tracy. */
const METRES_PAR_DEGRE_LAT = 111132;
const METRES_PAR_DEGRE_LON = 111320 * Math.cos((46.03 * Math.PI) / 180);

/** Rapport largeur/hauteur au-dela duquel on cesse d'etirer le cadre. */
export const MARGE = 0.06;

/**
 * Cadre de dessin pour un ensemble de points.
 *
 * Le cadre respecte les proportions reelles du terrain : un corridor de
 * soixante kilometres de long sur deux de large doit se voir comme un trait,
 * pas comme un rectangle rempli. On l'etire donc au format demande en ajoutant
 * du vide, jamais en deformant la geometrie.
 */
export function cadre(points, largeur = 100, hauteur = 100) {
  if (!points.length) return null;

  let minLat = Infinity; let maxLat = -Infinity;
  let minLon = Infinity; let maxLon = -Infinity;
  points.forEach(([lat, lon]) => {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
  });

  const centreLat = (minLat + maxLat) / 2;
  const centreLon = (minLon + maxLon) / 2;
  // Largeur et hauteur du contenu, en metres.
  const enLargeur = Math.max((maxLon - minLon) * METRES_PAR_DEGRE_LON, 1);
  const enHauteur = Math.max((maxLat - minLat) * METRES_PAR_DEGRE_LAT, 1);

  // Une seule echelle pour les deux axes : c'est ce qui garde les proportions.
  const echelle = Math.min(largeur / (enLargeur * (1 + 2 * MARGE)),
    hauteur / (enHauteur * (1 + 2 * MARGE)));

  return {
    centreLat,
    centreLon,
    echelle,
    largeur,
    hauteur,
    metres: { largeur: enLargeur, hauteur: enHauteur },
  };
}

/** Point geographique -> point de dessin, dans le cadre donne. */
export function projeter(cadreDessin, [lat, lon]) {
  const x = (lon - cadreDessin.centreLon) * METRES_PAR_DEGRE_LON
    * cadreDessin.echelle + cadreDessin.largeur / 2;
  // L'axe des y descend en SVG : les latitudes croissantes montent.
  const y = -(lat - cadreDessin.centreLat) * METRES_PAR_DEGRE_LAT
    * cadreDessin.echelle + cadreDessin.hauteur / 2;
  return [arrondir(x), arrondir(y)];
}

/** Chemin SVG d'une polyligne. */
export function chemin(cadreDessin, points) {
  if (!points.length) return '';
  return points.map((point, index) => {
    const [x, y] = projeter(cadreDessin, point);
    return `${index === 0 ? 'M' : 'L'}${x} ${y}`;
  }).join(' ');
}

/** Distance en metres entre deux coordonnees, a plat. */
export function distanceMetres([latA, lonA], [latB, lonB]) {
  return Math.hypot((latA - latB) * METRES_PAR_DEGRE_LAT,
    (lonA - lonB) * METRES_PAR_DEGRE_LON);
}

/**
 * Point du trace le plus proche d'une position, et l'avancement qu'il marque.
 *
 * Sert a placer sur le trace ce dont on n'a pas la position GPS : un vehicule
 * dont le flux ne dit rien, situe par l'horaire entre deux arrets.
 */
export function surLeTrace(trace, point) {
  let meilleur = null;
  let parcouru = 0;
  let total = 0;

  for (let i = 0; i < trace.length - 1; i += 1) {
    const segment = distanceMetres(trace[i], trace[i + 1]);
    const projection = projeterSurSegment(point, trace[i], trace[i + 1]);
    if (meilleur === null || projection.ecart < meilleur.ecart) {
      meilleur = {
        ecart: projection.ecart,
        point: projection.point,
        avant: total + segment * projection.part,
      };
    }
    total += segment;
  }
  if (meilleur === null) return null;
  parcouru = total > 0 ? meilleur.avant / total : 0;
  return { point: meilleur.point, ecart: meilleur.ecart, avancement: parcouru };
}

function projeterSurSegment(point, debut, fin) {
  const ax = (debut[1] - point[1]) * METRES_PAR_DEGRE_LON;
  const ay = (debut[0] - point[0]) * METRES_PAR_DEGRE_LAT;
  const bx = (fin[1] - point[1]) * METRES_PAR_DEGRE_LON;
  const by = (fin[0] - point[0]) * METRES_PAR_DEGRE_LAT;
  const dx = bx - ax;
  const dy = by - ay;
  if (dx === 0 && dy === 0) {
    return { ecart: Math.hypot(ax, ay), point: debut, part: 0 };
  }
  const part = Math.max(0, Math.min(1,
    -(ax * dx + ay * dy) / (dx * dx + dy * dy)));
  return {
    ecart: Math.hypot(ax + part * dx, ay + part * dy),
    point: [debut[0] + (fin[0] - debut[0]) * part,
      debut[1] + (fin[1] - debut[1]) * part],
    part,
  };
}

/** Trace embarque d'une direction, ou null si la table GTFS manque. */
export function traceDeDirection(reference, ligne, direction) {
  if (!reference || !reference.traces) return null;
  return reference.traces[`${ligne}|${direction}`] || null;
}

/**
 * Coupe un trace a un avancement donne : ce qui est parcouru, ce qui reste.
 *
 * Le point de coupe est insere dans les deux morceaux, sinon le trait sauterait
 * d'un sommet a l'autre au lieu de s'arreter ou est le vehicule.
 */
export function couper(trace, avancement) {
  if (trace.length < 2) return { parcouru: [], reste: [...trace] };
  // Aux extremes, couper produirait un segment de longueur nulle : on rend
  // directement le trace entier d'un cote et rien de l'autre.
  if (!(avancement > 0)) return { parcouru: [], reste: [...trace] };
  if (avancement >= 1) return { parcouru: [...trace], reste: [] };
  const borne = avancement;

  const longueurs = [];
  let total = 0;
  for (let i = 0; i < trace.length - 1; i += 1) {
    const segment = distanceMetres(trace[i], trace[i + 1]);
    longueurs.push(segment);
    total += segment;
  }
  const cible = total * borne;

  let cumule = 0;
  for (let i = 0; i < longueurs.length; i += 1) {
    if (cumule + longueurs[i] >= cible) {
      const part = longueurs[i] > 0 ? (cible - cumule) / longueurs[i] : 0;
      const coupe = [
        trace[i][0] + (trace[i + 1][0] - trace[i][0]) * part,
        trace[i][1] + (trace[i + 1][1] - trace[i][1]) * part,
      ];
      return {
        parcouru: [...trace.slice(0, i + 1), coupe],
        reste: [coupe, ...trace.slice(i + 1)],
      };
    }
    cumule += longueurs[i];
  }
  return { parcouru: [...trace], reste: [] };
}

/** Deux decimales suffisent dans un viewBox de cent unites. */
function arrondir(valeur) {
  return Math.round(valeur * 100) / 100;
}
