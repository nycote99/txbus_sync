/**
 * Interrogation du reseau : prochains passages, position estimee des vehicules
 * et heures limites de reservation du taxibus.
 */

import {
  decalerDate, enHeure, enMinutes, instant, instantDeDepart, profilDuJour,
} from './calendrier.js';

export const LIGNES = {
  ligne10: {
    id: 'ligne10',
    nom: 'Ligne 10',
    sousTitre: 'Circuit urbain',
    couleur: 'ligne10',
    directions: {
      cegep: 'Direction CÉGEP de Sorel-Tracy',
      terminus: 'Direction Terminus des Promenades',
    },
  },
  express: {
    id: 'express',
    nom: 'Express 750-753',
    sousTitre: 'Sorel-Tracy ↔ Longueuil',
    couleur: 'express',
    directions: {
      longueuil: 'Direction Longueuil',
      sorel: 'Direction Sorel-Tracy',
    },
  },
};

/** Grille d'une direction pour un jour donne, ou null hors service. */
export function grille(donnees, ligne, direction, profil) {
  return donnees[ligne]?.[profil.service]?.[direction] || null;
}

/**
 * Un « voyage » est une colonne de la grille : le trajet complet d'un vehicule.
 * On le materialise avec des instants absolus pour pouvoir comparer un depart
 * de 00:45 au temps courant sans se soucier du passage de minuit.
 */
export function voyages(donnees, ligne, direction, jourDeService, profil) {
  const bloc = grille(donnees, ligne, direction, profil);
  if (!bloc) return [];
  const nombre = bloc.arrets[0].heures.length;
  const resultat = [];

  for (let colonne = 0; colonne < nombre; colonne += 1) {
    const passages = [];
    bloc.arrets.forEach((arret, rang) => {
      const heure = arret.heures[colonne];
      if (!heure) return;
      passages.push({
        rang,
        arret: arret.nom,
        heure,
        instant: instantDeDepart(jourDeService, heure),
      });
    });
    if (!passages.length) continue;
    resultat.push({
      ligne,
      direction,
      colonne,
      circuit: bloc.circuits ? bloc.circuits[colonne] : null,
      passages,
      depart: passages[0],
      arrivee: passages[passages.length - 1],
    });
  }
  return resultat;
}

/** Liste des arrets d'une ligne, toutes directions confondues. */
export function arretsDeLigne(donnees, ligne) {
  const vus = new Map();
  Object.values(donnees[ligne] || {}).forEach((service) => {
    Object.entries(service).forEach(([direction, bloc]) => {
      bloc.arrets.forEach((arret) => {
        if (!vus.has(arret.nom)) vus.set(arret.nom, new Set());
        vus.get(arret.nom).add(direction);
      });
    });
  });
  return [...vus].map(([nom, directions]) => ({ nom, directions: [...directions] }));
}

/**
 * Prochains passages a un arret. On balaie le jour de service courant puis les
 * suivants, ce qui couvre naturellement la fin de soiree et les jours feries.
 */
export function prochainsPassages(donnees, options) {
  const { ligne, arret, maintenant: instantCourant, jourDeService, limite = 6,
          directions } = options;
  const resultat = [];

  for (let decalage = 0; decalage < 4 && resultat.length < limite; decalage += 1) {
    const jour = decalerDate(jourDeService, decalage);
    const profil = profilDuJour(jour, donnees);
    const cibles = directions || Object.keys(LIGNES[ligne].directions);

    cibles.forEach((direction) => {
      voyages(donnees, ligne, direction, jour, profil).forEach((voyage) => {
        const passage = voyage.passages.find((p) => p.arret === arret);
        if (!passage || passage.instant < instantCourant) return;
        resultat.push({
          voyage,
          passage,
          profil,
          dansMinutes: passage.instant - instantCourant,
        });
      });
    });
  }

  return resultat.sort((a, b) => a.passage.instant - b.passage.instant)
    .slice(0, limite);
}

/**
 * Position estimee d'un vehicule le long de son parcours.
 *
 * La STC ne publie pas de flux temps reel ouvert : cette position est deduite
 * de l'horaire officiel, et l'interface le dit explicitement.
 */
export function position(voyage, instantCourant) {
  const passages = voyage.passages;
  const premier = passages[0];
  const dernier = passages[passages.length - 1];

  if (instantCourant < premier.instant) {
    return {
      etat: 'a_venir',
      avant: premier,
      dansMinutes: premier.instant - instantCourant,
      progression: 0,
    };
  }
  if (instantCourant >= dernier.instant) {
    return { etat: 'termine', progression: 1, avant: dernier };
  }

  for (let i = 0; i < passages.length - 1; i += 1) {
    const depuis = passages[i];
    const vers = passages[i + 1];
    if (instantCourant < vers.instant) {
      const duree = vers.instant - depuis.instant;
      const part = duree > 0 ? (instantCourant - depuis.instant) / duree : 0;
      return {
        etat: instantCourant <= depuis.instant + 0.5 ? 'a_l_arret' : 'en_route',
        depuis,
        vers,
        entre: [i, i + 1],
        partSegment: part,
        dansMinutes: vers.instant - instantCourant,
        progression: (i + part) / (passages.length - 1),
      };
    }
  }
  return { etat: 'termine', progression: 1, avant: dernier };
}

/** Voyages actuellement en circulation sur l'ensemble du reseau. */
export function vehiculesEnCirculation(donnees, jourDeService, instantCourant) {
  const profil = profilDuJour(jourDeService, donnees);
  const enRoute = [];
  Object.keys(LIGNES).forEach((ligne) => {
    Object.keys(LIGNES[ligne].directions).forEach((direction) => {
      voyages(donnees, ligne, direction, jourDeService, profil).forEach((voyage) => {
        const p = position(voyage, instantCourant);
        if (p.etat === 'en_route' || p.etat === 'a_l_arret') {
          enRoute.push({ voyage, position: p });
        }
      });
    });
  });
  return enRoute.sort((a, b) => a.voyage.depart.instant - b.voyage.depart.instant);
}

// --- Taxibus -----------------------------------------------------------------

/** Groupes de departs dont la zone d'origine et la destination correspondent. */
export function groupesTaxibus(donnees, origine, destination, service) {
  return donnees.taxibus.filter((groupe) => groupe.service === service
    && groupe.origines.includes(origine)
    && (!destination || groupe.destinations.includes(destination)));
}

/** Toutes les destinations desservies depuis une zone, un jour donne. */
export function destinationsDepuis(donnees, origine, service) {
  const codes = new Set();
  groupesTaxibus(donnees, origine, null, service)
    .forEach((groupe) => groupe.destinations.forEach((code) => codes.add(code)));
  return donnees.zones.filter((zone) => codes.has(zone.code));
}

/**
 * Heure limite pour reserver un depart de taxibus.
 *
 * Deux regles officielles se cumulent :
 *   1. reservation possible jusqu'a 30 minutes avant le depart ;
 *   2. pour les departs qui ont lieu alors que le Terminus des Promenades est
 *      ferme — soiree tardive, nuit, et debut de matinee du lendemain — la
 *      reservation doit etre faite avant sa fermeture.
 * La plus contraignante des deux l'emporte.
 */
export function limiteReservation(donnees, jourDeService, heure) {
  const instantDepart = instantDeDepart(jourDeService, heure);
  const delai = donnees.regles.reservation_minutes_avant;
  let limite = instantDepart - delai;
  let motif = 'delai';

  const profil = profilDuJour(jourDeService, donnees);
  const ouvertPendantLeDepart = profil.terminusOuvert
    && instantDepart >= instant(jourDeService, profil.ouverture)
    && instantDepart <= instant(jourDeService, profil.fermeture);

  if (!ouvertPendantLeDepart) {
    const fermeture = derniereFermeture(donnees, jourDeService, instantDepart);
    if (fermeture !== null && fermeture < limite) {
      limite = fermeture;
      motif = 'fermeture_terminus';
    }
  }
  return { instantDepart, limite, motif };
}

/** Derniere fermeture du terminus qui precede l'instant vise. */
function derniereFermeture(donnees, jourDeService, instantVise) {
  for (let recul = 0; recul < 14; recul += 1) {
    const jour = decalerDate(jourDeService, -recul);
    const profil = profilDuJour(jour, donnees);
    if (!profil.terminusOuvert) continue;
    const fermeture = instant(jour, profil.fermeture);
    if (fermeture <= instantVise) return fermeture;
  }
  return null;
}

/** Etat d'un depart taxibus par rapport a son heure limite de reservation. */
export function etatReservation(limite, instantCourant, seuilAlerte = 60) {
  const restant = limite.limite - instantCourant;
  if (restant <= 0) {
    return { code: 'ferme', restant, libelle: 'Réservation fermée' };
  }
  if (restant <= seuilAlerte) {
    return { code: 'bientot', restant, libelle: 'Dernière chance' };
  }
  return { code: 'ouvert', restant, libelle: 'Réservable' };
}

/** Departs taxibus a partir de maintenant, avec leur heure limite. */
export function departsTaxibus(donnees, options) {
  const { origine, destination, maintenant: instantCourant, jourDeService,
          limite = 12, inclurePasses = false } = options;
  const resultat = [];

  for (let decalage = 0; decalage < 4 && resultat.length < limite; decalage += 1) {
    const jour = decalerDate(jourDeService, decalage);
    const profil = profilDuJour(jour, donnees);
    const heures = new Set();
    groupesTaxibus(donnees, origine, destination, profil.service)
      .forEach((groupe) => groupe.heures.forEach((h) => heures.add(h)));

    [...heures].forEach((heure) => {
      const info = limiteReservation(donnees, jour, heure);
      if (!inclurePasses && info.instantDepart < instantCourant) return;
      resultat.push({
        heure,
        jour,
        profil,
        ...info,
        etat: etatReservation(info, instantCourant),
        dansMinutes: info.instantDepart - instantCourant,
      });
    });
  }

  return resultat.sort((a, b) => a.instantDepart - b.instantDepart)
    .slice(0, limite);
}

/** Duree relative lisible : « dans 7 min », « dans 2 h 15 », « demain ». */
export function delai(minutes) {
  const m = Math.round(minutes);
  if (m < 0) return 'passé';
  if (m === 0) return "à l'instant";
  if (m < 60) return `${m} min`;
  const heures = Math.floor(m / 60);
  if (heures < 12) return `${heures} h ${String(m % 60).padStart(2, '0')}`;
  return `${Math.round(m / 60)} h`;
}

export { enHeure, enMinutes };
