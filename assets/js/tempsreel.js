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
  voyageRelation: 4,
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
  arretRelation: 5,
  evenementRetard: 1,
  evenementHeure: 2,
  alerteCibles: 5,
  alerteCause: 6,
  alerteTitre: 10,
  alerteTexte: 11,
  cibleAgence: 1,
  cibleRoute: 2,
  cibleVoyage: 4,
  cibleArret: 5,
  traductions: 1,
  traductionTexte: 1,
};

/** TripDescriptor.ScheduleRelationship : 3 = CANCELED, 7 = DELETED. */
const VOYAGES_SUPPRIMES = new Set([3, 7]);

/** StopTimeUpdate.ScheduleRelationship : 1 = SKIPPED. */
const ARRET_SAUTE = 1;

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
  // Les previsions indexees par ligne, direction et heure de depart : c'est le
  // seul index qui fonctionne quand le flux publie des mises a jour de voyage
  // sans position de vehicule, ce que rien n'interdit.
  const previsionsParVoyage = new Map();
  const alertes = [];
  const annulations = new Map();

  sousMessages(flux, F.fluxEntite).forEach((entite) => {
    const vehicule = sousMessage(entite, F.entiteVehicule);
    if (vehicule) {
      const lu = lireVehicule(entite, vehicule, reference);
      vehicules.push(lu);
      noterAnnulation(annulations, sousMessage(vehicule, F.vehiculeVoyage),
        reference, lu);
    }

    const miseAJour = sousMessage(entite, F.entiteMiseAJour);
    if (miseAJour) {
      const voyage = sousMessage(miseAJour, F.majVoyage);
      const identifiant = voyage && texte(voyage, F.voyageId);
      const lues = lirePrevisions(miseAJour, reference);
      if (identifiant) previsions.set(identifiant, lues);

      const cle = cleDuDescripteur(voyage, reference);
      if (cle && lues.length) previsionsParVoyage.set(cle, lues);
      noterAnnulation(annulations, voyage, reference, null);
    }

    const alerte = sousMessage(entite, F.entiteAlerte);
    if (alerte) alertes.push(lireAlerte(alerte, reference));
  });

  return { horodatage, vehicules, previsions, previsionsParVoyage, alertes,
           annulations };
}

/** Cle « ligne|direction|depart » d'un TripDescriptor, ou null. */
function cleDuDescripteur(voyage, reference) {
  if (!voyage) return null;
  const identifiant = texte(voyage, F.voyageId);
  const fiche = identifiant ? reference.voyages[identifiant] : undefined;
  const route = reference.routes[texte(voyage, F.voyageRoute)
    || (fiche && fiche.route)];
  const depart = texte(voyage, F.voyageDepart);
  if (!route || !route.famille || !fiche || !fiche.direction || !depart) {
    return null;
  }
  return cleDeVoyage(route.famille, fiche.direction, depart.slice(0, 5));
}

/**
 * Retient les voyages que la STC declare supprimes.
 *
 * La cle reprend les seules donnees communes au flux et a l'horaire publie :
 * ligne, direction et heure de depart. Annoncer un autobus qui ne viendra pas
 * est la pire chose que puisse faire un afficheur d'horaires.
 */
function noterAnnulation(annulations, voyage, reference, dejaLu) {
  if (!voyage) return;
  if (!VOYAGES_SUPPRIMES.has(entier(voyage, F.voyageRelation))) return;

  const identifiant = texte(voyage, F.voyageId);
  const fiche = identifiant ? reference.voyages[identifiant] : undefined;
  const route = reference.routes[texte(voyage, F.voyageRoute)
    || (fiche && fiche.route)];
  const depart = texte(voyage, F.voyageDepart);
  const ligne = dejaLu ? dejaLu.ligne : (route ? route.famille : null);
  const direction = dejaLu ? dejaLu.direction : (fiche ? fiche.direction : null);
  if (!ligne || !direction || !depart) return;

  annulations.set(cleDeVoyage(ligne, direction, depart.slice(0, 5)), {
    voyageId: identifiant,
    ligne,
    direction,
    depart: depart.slice(0, 5),
  });
}

export function cleDeVoyage(ligne, direction, depart) {
  return `${ligne}|${direction}|${depart}`;
}

/** Ce voyage de l'horaire publie est-il annule aujourd'hui ? */
export function voyageAnnule(etat, voyage) {
  if (!etat || !etat.annulations || !etat.annulations.size) return false;
  return etat.annulations.has(
    cleDeVoyage(voyage.ligne, voyage.direction, voyage.depart.heure));
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
      saute: entier(maj, F.arretRelation) === ARRET_SAUTE,
    };
  }).filter((prevision) => prevision.heure !== undefined || prevision.saute);
}

function lireAlerte(alerte, reference) {
  return {
    cause: entier(alerte, F.alerteCause),
    titre: enTexteSimple(traduire(sousMessage(alerte, F.alerteTitre))),
    texte: enTexteSimple(traduire(sousMessage(alerte, F.alerteTexte))),
    portee: lirePortee(alerte, reference),
  };
}

/**
 * Ce que l'avis concerne.
 *
 * La STC n'y met aujourd'hui que son identifiant d'agence : tous ses avis
 * visent donc le reseau entier. Le champ est neanmoins lu, pour qu'un avis
 * un jour rattache a une ligne s'affiche au bon endroit plutot que partout.
 */
function lirePortee(alerte, reference) {
  const lignes = new Set();
  const arrets = new Set();
  let reseau = false;

  const cibles = sousMessages(alerte, F.alerteCibles);
  if (!cibles.length) reseau = true;

  cibles.forEach((cible) => {
    const route = reference.routes[texte(cible, F.cibleRoute)];
    const arretId = texte(cible, F.cibleArret);
    if (route && route.famille) lignes.add(route.famille);
    if (arretId && reference.arrets[arretId]) {
      arrets.add(reference.arrets[arretId].nom);
    }
    // Une cible qui ne nomme que l'agence porte sur tout le reseau.
    if (!route && !arretId && !sousMessage(cible, F.cibleVoyage)) reseau = true;
  });

  return { reseau: reseau || (!lignes.size && !arrets.size),
           lignes: [...lignes], arrets: [...arrets] };
}

/** L'avis concerne-t-il cette ligne ? Un avis reseau concerne tout le monde. */
export function alerteConcerne(alerte, ligne) {
  if (!alerte.portee || alerte.portee.reseau) return true;
  return alerte.portee.lignes.includes(ligne);
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
  return chercherPrevision(etat.previsions.get(vehicule.voyageId), nomArret);
}

/**
 * Previsions d'un voyage de l'horaire publie, qu'un vehicule ait ete
 * positionne ou non. Un flux qui ne publierait que des mises a jour resterait
 * ainsi exploitable.
 */
export function previsionsDuVoyage(etat, voyage) {
  if (!etat) return null;
  const parVoyage = etat.previsionsParVoyage;
  if (parVoyage) {
    const trouvees = parVoyage.get(
      cleDeVoyage(voyage.ligne, voyage.direction, voyage.depart.heure));
    if (trouvees) return trouvees;
  }
  const vehicule = vehiculeDuVoyage(etat, voyage);
  return vehicule && vehicule.voyageId
    ? etat.previsions.get(vehicule.voyageId) || null : null;
}

/**
 * Prevision d'un voyage a un arret.
 *
 * `arret` est un passage de la grille — `{ id, arret }` — ou, a defaut, un nom.
 * L'identifiant tranche ce que le nom ne peut pas trancher : les
 * deux sens de la ligne 10 s'arretent de part et d'autre de la meme
 * intersection, sous le meme nom, a des heures differentes.
 */
export function previsionDuVoyageA(etat, voyage, arret) {
  return chercherPrevision(previsionsDuVoyage(etat, voyage), arret);
}

function chercherPrevision(previsions, arret) {
  if (!previsions || !arret) return null;
  const id = typeof arret === 'string' ? null : arret.id;
  const nom = typeof arret === 'string' ? arret : arret.arret;
  if (id) {
    const parId = previsions.find((prevision) => prevision.arretId === id);
    if (parId) return parId;
  }
  return previsions.find((prevision) => prevision.arret && nom
    && memeArret(prevision.arret, nom)) || null;
}

/**
 * Repli quand l'identifiant manque : les deux sources nomment les arrets un peu
 * differemment — « Hôtel-Dieu (Hôpital) » dans le GTFS, « Hôtel-Dieu (hôpital) »
 * sur la fiche horaire. On compare des formes reduites.
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
