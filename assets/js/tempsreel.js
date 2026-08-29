/**
 * Couche temps reel : positions GPS des vehicules, heures de passage prevues
 * et alertes de service, lues dans le flux GTFS-RT de la STC.
 *
 * Le flux ne transporte que des identifiants ; `data/reseau-gtfs.json` les
 * traduit en noms de lignes, d'arrets et de directions.
 *
 * Tout ici est facultatif par construction : si le flux est injoignable — hors
 * ligne, panne, ou consultation d'une journee autre qu'aujourd'hui —
 * l'application retombe sur l'estimation calculee depuis l'horaire publie.
 */

import {
  entier, entierSigne, flottant, lireMessage, sousMessage, sousMessages, texte,
} from './protobuf.js';

/** Numeros de champs du schema GTFS-RT (gtfs-realtime.proto, version 2.0). */
const F = {
  fluxEntete: 1,
  fluxEntite: 2,
  enteteVersion: 1,
  enteteHorodatage: 3,
  entiteId: 1,
  entiteMiseAJour: 3,
  entiteVehicule: 4,
  entiteAlerte: 5,
  voyageId: 1,
  voyageDepart: 2,
  voyageDate: 3,
  voyageRoute: 5,
  vehiculeVoyage: 1,
  vehiculePosition: 2,
  vehiculeSequence: 3,
  vehiculeStatut: 4,
  vehiculeHorodatage: 5,
  vehiculeArret: 7,
  vehiculeDescripteur: 8,
  positionLatitude: 1,
  positionLongitude: 2,
  positionCap: 3,
  positionVitesse: 5,
  majVoyage: 1,
  majArrets: 2,
  arretSequence: 1,
  arretArrivee: 2,
  arretDepart: 3,
  arretId: 4,
  evenementRetard: 1,
  evenementHeure: 2,
  alerteCause: 6,
  alerteTitre: 10,
  alerteTexte: 11,
  traductions: 1,
  traductionTexte: 1,
};

/** VehiclePosition.VehicleStopStatus */
const STATUTS = { 0: 'approche', 1: 'a_l_arret', 2: 'en_route' };

export const DELAI_RAFRAICHISSEMENT = 30000;

/**
 * Telecharge et decode le flux. Renvoie null si le flux est injoignable, sans
 * lever d'erreur : l'appelant continue avec l'horaire theorique.
 */
export async function chargerTempsReel(reference, signal) {
  let octets;
  try {
    const reponse = await fetch(reference.flux_temps_reel, {
      cache: 'no-store',
      signal,
    });
    if (!reponse.ok) return null;
    octets = new Uint8Array(await reponse.arrayBuffer());
  } catch {
    return null;
  }

  try {
    return interpreter(lireMessage(octets), reference);
  } catch {
    // Un flux malforme ne doit jamais empecher l'application de fonctionner.
    return null;
  }
}

function interpreter(flux, reference) {
  const entete = sousMessage(flux, F.fluxEntete);
  const horodatage = entete ? entier(entete, F.enteteHorodatage) : undefined;

  const vehicules = [];
  const previsions = new Map();
  const alertes = [];

  sousMessages(flux, F.fluxEntite).forEach((entite) => {
    const vehicule = sousMessage(entite, F.entiteVehicule);
    if (vehicule) vehicules.push(lireVehicule(entite, vehicule, reference));

    const miseAJour = sousMessage(entite, F.entiteMiseAJour);
    if (miseAJour) {
      const voyage = sousMessage(miseAJour, F.majVoyage);
      const identifiant = voyage && texte(voyage, F.voyageId);
      if (identifiant) {
        previsions.set(identifiant, lirePrevisions(miseAJour, reference));
      }
    }

    const alerte = sousMessage(entite, F.entiteAlerte);
    if (alerte) alertes.push(lireAlerte(alerte));
  });

  return { horodatage, vehicules, previsions, alertes };
}

function lireVehicule(entite, vehicule, reference) {
  const voyage = sousMessage(vehicule, F.vehiculeVoyage);
  const position = sousMessage(vehicule, F.vehiculePosition);
  const descripteur = sousMessage(vehicule, F.vehiculeDescripteur);

  const voyageId = voyage && texte(voyage, F.voyageId);
  const routeId = voyage && texte(voyage, F.voyageRoute);
  const arretId = texte(vehicule, F.vehiculeArret);
  const fiche = voyageId ? reference.voyages[voyageId] : undefined;
  const route = reference.routes[routeId || (fiche && fiche.route)];

  const depart = voyage && texte(voyage, F.voyageDepart);

  return {
    id: (descripteur && texte(descripteur, F.entiteId)) || texte(entite, F.entiteId),
    voyageId,
    ligne: route ? route.famille : null,
    circuit: route ? route.numero : null,
    couleur: route ? route.couleur : null,
    direction: fiche ? fiche.direction : null,
    destination: fiche ? fiche.destination : null,
    depart: depart ? depart.slice(0, 5) : null,
    date: voyage && texte(voyage, F.voyageDate),
    latitude: position && flottant(position, F.positionLatitude),
    longitude: position && flottant(position, F.positionLongitude),
    cap: position && flottant(position, F.positionCap),
    vitesse: position && flottant(position, F.positionVitesse),
    arretId,
    arret: arretId && reference.arrets[arretId]
      ? reference.arrets[arretId].nom : null,
    sequence: entier(vehicule, F.vehiculeSequence),
    statut: STATUTS[entier(vehicule, F.vehiculeStatut)] || 'en_route',
    horodatage: entier(vehicule, F.vehiculeHorodatage),
  };
}

/**
 * Heures de passage prevues, arret par arret. Zenbus publie des heures
 * absolues plutot que des retards : le retard se deduit en comparant a
 * l'horaire publie.
 */
function lirePrevisions(miseAJour, reference) {
  return sousMessages(miseAJour, F.majArrets).map((maj) => {
    const arrivee = sousMessage(maj, F.arretArrivee);
    const depart = sousMessage(maj, F.arretDepart);
    const evenement = arrivee || depart;
    const arretId = texte(maj, F.arretId);
    return {
      sequence: entier(maj, F.arretSequence),
      arretId,
      arret: arretId && reference.arrets[arretId]
        ? reference.arrets[arretId].nom : null,
      heure: evenement ? entier(evenement, F.evenementHeure) : undefined,
      retard: evenement ? entierSigne(evenement, F.evenementRetard) : undefined,
    };
  }).filter((prevision) => prevision.heure !== undefined);
}

function lireAlerte(alerte) {
  return {
    cause: entier(alerte, F.alerteCause),
    titre: enTexteSimple(traduire(sousMessage(alerte, F.alerteTitre))),
    texte: enTexteSimple(traduire(sousMessage(alerte, F.alerteTexte))),
  };
}

/**
 * Ramene a l'alphabet latin les caracteres mathematiques gras que la STC
 * utilise pour mettre ses avis en valeur. Ils s'affichent correctement, mais
 * les lecteurs d'ecran les enoncent lettre par lettre, ou les ignorent.
 */
export function enTexteSimple(valeur) {
  if (!valeur) return valeur;
  let resultat = '';
  for (const caractere of valeur) {
    const point = caractere.codePointAt(0);
    resultat += PLAGES_MATHEMATIQUES.reduce((acc, plage) => {
      if (acc !== null) return acc;
      if (point < plage.debut || point > plage.debut + plage.taille - 1) return null;
      return String.fromCharCode(plage.cible + (point - plage.debut));
    }, null) ?? caractere;
  }
  return resultat.replace(/\s+\n/g, '\n').trim();
}

/** Blocs « Mathematical Alphanumeric Symbols » vers ASCII. */
const PLAGES_MATHEMATIQUES = [
  { debut: 0x1d400, taille: 26, cible: 65 },  // gras majuscules
  { debut: 0x1d41a, taille: 26, cible: 97 },  // gras minuscules
  { debut: 0x1d5d4, taille: 26, cible: 65 },  // sans empattement gras maj.
  { debut: 0x1d5ee, taille: 26, cible: 97 },  // sans empattement gras min.
  { debut: 0x1d608, taille: 26, cible: 65 },  // sans empattement italique maj.
  { debut: 0x1d622, taille: 26, cible: 97 },  // sans empattement italique min.
  { debut: 0x1d7ec, taille: 10, cible: 48 },  // chiffres gras
  { debut: 0x1d7ce, taille: 10, cible: 48 },  // chiffres gras (serif)
];

function traduire(chaineTraduite) {
  if (!chaineTraduite) return null;
  const traductions = sousMessages(chaineTraduite, F.traductions);
  if (!traductions.length) return null;
  return texte(traductions[0], F.traductionTexte) || null;
}

/**
 * Retrouve le vehicule qui assure un voyage de l'horaire publie.
 * L'appariement se fait sur la ligne, la direction et l'heure de depart, les
 * seules donnees communes aux deux sources.
 */
export function vehiculeDuVoyage(etat, voyage) {
  if (!etat) return null;
  return etat.vehicules.find((vehicule) => vehicule.ligne === voyage.ligne
    && vehicule.direction === voyage.direction
    && vehicule.depart === voyage.depart.heure) || null;
}

/** Heure de passage prevue d'un vehicule a un arret nomme, en secondes epoch. */
export function previsionA(etat, vehicule, nomArret) {
  if (!etat || !vehicule || !vehicule.voyageId) return null;
  const previsions = etat.previsions.get(vehicule.voyageId);
  if (!previsions) return null;
  return previsions.find((prevision) => prevision.arret
    && memeArret(prevision.arret, nomArret)) || null;
}

/**
 * Les deux sources nomment les arrets un peu differemment : « Hôtel-Dieu
 * (Hôpital) » dans le GTFS, « Hôtel-Dieu (hôpital) » sur la fiche horaire.
 * On compare des formes reduites.
 */
export function memeArret(a, b) {
  return reduire(a) === reduire(b);
}

function reduire(nom) {
  return nom.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\b(de|du|des|la|le|les|l|d)\b/g, '')
    .replace(/[^a-z0-9]/g, '');
}
