/**
 * Interrogation du reseau : prochains passages, position estimee des vehicules
 * et heures limites de reservation du taxibus.
 */

import {
  decalerDate, enHeure, enMinutes, instant, instantDeDepart,
  instantDepuisEpoch, profilDuJour,
} from './calendrier.js';
import {
  previsionDuVoyageA, vehiculeDuVoyage, voyageAnnule,
} from './tempsreel.js';

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
        // Identifiant GTFS de l'arret : c'est lui qui apparie le passage a la
        // prevision temps reel, le nom seul ne distinguant pas les deux cotes
        // d'une intersection.
        id: arret.id || null,
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

/** Arrets d'une direction, dans l'ordre du parcours, pour un jour donne. */
export function arretsDeDirection(donnees, ligne, direction, profil) {
  const bloc = grille(donnees, ligne, direction, profil);
  return bloc ? bloc.arrets.map((arret) => arret.nom) : [];
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
 * Passage d'un vehicule a un arret : heure prevue par le flux temps reel si
 * elle existe, heure publiee sinon, avec l'ecart entre les deux.
 */
export function passageReel(etat, voyage, passage) {
  const vehicule = vehiculeDuVoyage(etat, voyage);
  const prevision = previsionDuVoyageA(etat, voyage, passage);
  if (!prevision || prevision.heure === undefined) {
    return { instant: passage.instant, heure: passage.heure, direct: false,
             vehicule };
  }
  const instantPrevu = instantDepuisEpoch(prevision.heure);
  return {
    instant: instantPrevu,
    heure: enHeure(instantPrevu % 1440),
    direct: true,
    vehicule,
    ecart: Math.round(instantPrevu - passage.instant),
  };
}

/**
 * Position d'un vehicule le long de son parcours, deduite de l'horaire publie.
 * Sert de repli quand le flux temps reel ne couvre pas ce voyage : hors ligne,
 * flux indisponible, ou consultation d'une autre journee.
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

/**
 * Vehicules actuellement en circulation.
 *
 * Quand le flux temps reel repond, il fait foi : il ne montre que les vehicules
 * reellement en service, ce qu'un horaire ne peut pas savoir. Sinon on retombe
 * sur les voyages que l'horaire situe en cours.
 */
export function vehiculesEnCirculation(donnees, jourDeService, instantCourant,
                                       etatTempsReel) {
  const profil = profilDuJour(jourDeService, donnees);
  const tous = [];
  Object.keys(LIGNES).forEach((ligne) => {
    Object.keys(LIGNES[ligne].directions).forEach((direction) => {
      tous.push(...voyages(donnees, ligne, direction, jourDeService, profil));
    });
  });

  if (etatTempsReel && etatTempsReel.vehicules.length) {
    const enService = [];
    etatTempsReel.vehicules.forEach((vehicule) => {
      const voyage = tous.find((candidat) => candidat.ligne === vehicule.ligne
        && candidat.direction === vehicule.direction
        && candidat.depart.heure === vehicule.depart);
      if (voyage) enService.push({ voyage, vehicule });
    });
    if (enService.length) {
      return enService.sort((a, b) =>
        a.voyage.depart.instant - b.voyage.depart.instant);
    }
  }

  return tous
    .filter((voyage) => !voyageAnnule(etatTempsReel, voyage))
    .map((voyage) => ({ voyage, position: position(voyage, instantCourant) }))
    .filter(({ position: p }) => p.etat === 'en_route' || p.etat === 'a_l_arret')
    .sort((a, b) => a.voyage.depart.instant - b.voyage.depart.instant);
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

/**
 * Departs de taxibus, avec leur heure limite de reservation.
 *
 * `depuis` filtre les departs (par defaut : maintenant), tandis que
 * `maintenant` sert a evaluer s'il est encore temps de reserver. Les deux
 * different des qu'on prepare une correspondance : on cherche un depart apres
 * l'arrivee de l'autobus, mais la reservation, elle, se joue tout de suite.
 */
export function departsTaxibus(donnees, options) {
  const { origine, destination, maintenant: instantCourant, jourDeService,
          limite = 12, inclurePasses = false } = options;
  const depuis = options.depuis === undefined ? instantCourant : options.depuis;
  const resultat = [];

  for (let decalage = 0; decalage < 4 && resultat.length < limite; decalage += 1) {
    const jour = decalerDate(jourDeService, decalage);
    const profil = profilDuJour(jour, donnees);
    const heures = new Set();
    groupesTaxibus(donnees, origine, destination, profil.service)
      .forEach((groupe) => groupe.heures.forEach((h) => heures.add(h)));

    [...heures].forEach((heure) => {
      const info = limiteReservation(donnees, jour, heure);
      if (!inclurePasses && info.instantDepart < depuis) return;
      resultat.push({
        heure,
        jour,
        profil,
        ...info,
        etat: etatReservation(info, instantCourant),
        dansMinutes: info.instantDepart - instantCourant,
        attente: info.instantDepart - depuis,
      });
    });
  }

  return resultat.sort((a, b) => a.instantDepart - b.instantDepart)
    .slice(0, limite);
}

/**
 * Retours en autobus prolonges par un taxibus.
 *
 * C'est le calcul qui donne son sens a l'application : sur la quasi-totalite
 * des retours de Longueuil, l'heure limite du taxibus tombe avant qu'on ne
 * descende de l'autobus, et souvent avant qu'on n'y monte. Chaque retour porte
 * donc un verdict qui dit *quand* reserver, pas seulement si c'est encore
 * possible.
 */
/**
 * Jeu reel d'une correspondance, en minutes : l'attente annoncee moins le
 * battement qu'on se donne pour descendre et rejoindre l'arret. Une attente de
 * six minutes avec cinq minutes de battement ne laisse qu'une minute de jeu —
 * n'importe quel retard la fait disparaitre.
 */
export const JEU_SERRE = 5;

/** Au-dela de cette attente, la ligne 10 n'est plus une correspondance. */
export const ATTENTE_MAX = 90;

/**
 * Passages de la ligne 10 a un arret, tous sens confondus, sur quatre jours.
 *
 * On les prepare une fois pour toutes : la vue des retours interroge le meme
 * arret trente-quatre fois de suite, une par express de la journee.
 */
export function passagesLigne10(donnees, arret, jourDeService) {
  const resultat = [];
  for (let decalage = 0; decalage < 4; decalage += 1) {
    const jour = decalerDate(jourDeService, decalage);
    const profil = profilDuJour(jour, donnees);
    Object.keys(LIGNES.ligne10.directions).forEach((direction) => {
      voyages(donnees, 'ligne10', direction, jour, profil).forEach((voyage) => {
        const passage = voyage.passages.find((p) => p.arret === arret);
        if (passage) resultat.push({ voyage, passage, jour, direction });
      });
    });
  }
  return resultat.sort((a, b) => a.passage.instant - b.passage.instant);
}

/**
 * Prolongement du retour par la ligne 10, quand l'arret de descente est sur son
 * parcours.
 *
 * C'est l'autre facon de finir le trajet, et la seule qui ne se reserve pas.
 * Mesure sur un mardi : trente-deux des trente-quatre retours de Longueuil ont
 * une ligne 10 au Terminus des Promenades, dix-huit minutes d'attente
 * mediane. Les deux qui n'en ont pas sont ceux de la nuit — precisement ceux
 * dont le taxibus devait etre reserve avant la fermeture du terminus.
 */
export function correspondanceLigne10(passages, arriveeInstant,
                                      correspondance = 5) {
  const suivant = passages
    .find((entree) => entree.passage.instant >= arriveeInstant + correspondance);
  if (!suivant) return null;
  // Au-dela, ce n'est plus une correspondance mais le premier autobus du
  // lendemain : sur ce reseau les vraies attentes vont de 6 a 37 minutes, et
  // apres le dernier passage de la ligne 10 la suivante est a plus de trois
  // heures. Dire « aucune » est alors la reponse honnete.
  if (suivant.passage.instant - arriveeInstant > ATTENTE_MAX) return null;
  const attente = suivant.passage.instant - arriveeInstant;
  return {
    ...suivant,
    heure: suivant.passage.heure,
    instantDepart: suivant.passage.instant,
    attente,
    jeu: attente - correspondance,
    serree: attente - correspondance <= JEU_SERRE,
  };
}

export function retoursAvecTaxibus(donnees, options) {
  const {
    ligne = 'express', direction = 'sorel', embarquement, descente,
    zoneDestination = null, jourDeService, maintenant: instantCourant,
    tempsReel = null, correspondance = 5, limite = 12, aPartirDe = null,
  } = options;

  const profil = profilDuJour(jourDeService, donnees);
  const zone = donnees.zones_des_arrets[descente];
  const plancher = aPartirDe === null ? -Infinity : aPartirDe;
  const passagesL10 = passagesLigne10(donnees, descente, jourDeService);
  const resultat = [];

  for (const voyage of voyages(donnees, ligne, direction, jourDeService, profil)) {
    const depart = voyage.passages.find((p) => p.arret === embarquement);
    const arrivee = voyage.passages.find((p) => p.arret === descente);
    if (!depart || !arrivee || arrivee.instant <= depart.instant) continue;
    if (depart.instant < plancher) continue;

    const departReel = passageReel(tempsReel, voyage, depart);
    const arriveeReelle = passageReel(tempsReel, voyage, arrivee);
    const annule = voyageAnnule(tempsReel, voyage);

    const chercher = (depuis) => (zone ? departsTaxibus(donnees, {
      origine: zone,
      destination: zoneDestination,
      maintenant: instantCourant,
      depuis: depuis + correspondance,
      jourDeService,
      limite: 1,
    })[0] || null : null);

    // Le taxibus que l'horaire promettait, et celui qu'on attrapera vraiment.
    const taxibusPrevu = chercher(arrivee.instant);
    const taxibus = arriveeReelle.direct
      && arriveeReelle.instant !== arrivee.instant
      ? chercher(arriveeReelle.instant) : taxibusPrevu;

    const marge = taxibus ? taxibus.instantDepart - arriveeReelle.instant : null;

    resultat.push({
      voyage,
      depart,
      arrivee,
      departReel,
      arriveeReelle,
      annule,
      zone: zone || null,
      zoneDestination,
      taxibus,
      taxibusPrevu,
      // L'autre prolongement possible, celui qui ne se reserve pas.
      ligne10: correspondanceLigne10(passagesL10, arriveeReelle.instant,
        correspondance),
      attente: marge,
      marge,
      // Le retard a fait glisser la correspondance sur un départ ultérieur.
      correspondancePerdue: Boolean(taxibus && taxibusPrevu
        && taxibus.instantDepart !== taxibusPrevu.instantDepart),
      jeu: marge === null ? null : marge - correspondance,
      // Jeu si court qu'un retard ordinaire ferait perdre le taxibus.
      margeServree: marge !== null && marge - correspondance <= JEU_SERRE,
      verdict: annule ? { code: 'annule' }
        : verdictDeReservation(taxibus, departReel, arriveeReelle),
    });
    if (resultat.length >= limite) break;
  }
  return resultat;
}

/**
 * Quand faut-il reserver ce taxibus, par rapport au trajet en autobus ?
 * Les deux cas qui comptent sont ceux ou la reponse est « plus tot que vous ne
 * le croyez » : avant de descendre, et pire, avant meme de monter.
 */
export function verdictDeReservation(taxibus, departReel, arriveeReelle) {
  if (!taxibus) return { code: 'aucun' };
  if (taxibus.etat.code === 'ferme') return { code: 'ferme' };
  if (taxibus.limite < departReel.instant) {
    return {
      code: 'avant_embarquement',
      avance: departReel.instant - taxibus.limite,
    };
  }
  if (taxibus.limite < arriveeReelle.instant) {
    return {
      code: 'avant_arrivee',
      avance: arriveeReelle.instant - taxibus.limite,
    };
  }
  return { code: 'apres_arrivee' };
}

/** Duree relative lisible : « dans 7 min », « dans 2 h 15 », « demain ». */
export function delai(minutes) {
  const m = Math.round(minutes);
  if (m < 0) return 'passé';
  if (m === 0) return 'à l’instant';
  if (m < 60) return `${m} min`;
  const heures = Math.floor(m / 60);
  if (heures < 12) return `${heures} h ${String(m % 60).padStart(2, '0')}`;
  return `${Math.round(m / 60)} h`;
}

export { enHeure, enMinutes };
