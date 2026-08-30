/**
 * Le calcul des heures limites de réservation est la seule chose que l'usager
 * ne peut pas vérifier par lui-même : la fiche horaire ne l'imprime nulle part.
 * Ces tests figent la règle, et gardent comme cas de référence le déplacement
 * qui l'expose le mieux — le retour de Longueuil en soirée.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  dateDepuisNumero, enHeure, enMinutes, instant, profilDuJour, versEpoch,
} from '../assets/js/calendrier.js';
import {
  LIGNES, arretsDeDirection, arretsDeLigne, delai, departsTaxibus,
  destinationsDepuis, etatReservation, grille, limiteReservation, position,
  prochainsPassages, retoursAvecTaxibus, vehiculesEnCirculation, voyages,
} from '../assets/js/reseau.js';

import { MARDI, lireHoraires } from './aide.js';

const donnees = lireHoraires();
const profilMardi = profilDuJour(MARDI, donnees);
const SAMEDI = { annee: 2026, mois: 9, jour: 5 };

/** Heure murale d'un instant, pour des assertions lisibles. */
const heure = (moment) => enHeure(((moment % 1440) + 1440) % 1440);

describe('heure limite de réservation du taxibus', () => {
  it('accorde trente minutes avant le départ quand le terminus est ouvert', () => {
    const { limite, motif } = limiteReservation(donnees, MARDI, '19:45');
    assert.equal(heure(limite), '19:15');
    assert.equal(motif, 'delai');
  });

  it('ramène la limite à la fermeture pour un départ de soirée', () => {
    const { limite, motif } = limiteReservation(donnees, MARDI, '21:45');
    assert.equal(heure(limite), '20:30');
    assert.equal(motif, 'fermeture_terminus');
    // Et non 21:15, ce que donnerait la seule règle des trente minutes.
    assert.notEqual(heure(limite), '21:15');
  });

  it('garde la fermeture pour tous les départs de la nuit', () => {
    for (const depart of ['22:15', '23:15', '00:15', '01:15', '01:45']) {
      const { limite, motif } = limiteReservation(donnees, MARDI, depart);
      assert.equal(heure(limite), '20:30', `départ de ${depart}`);
      assert.equal(motif, 'fermeture_terminus', `départ de ${depart}`);
    }
  });

  it('renvoie à la veille au soir un départ d’avant l’ouverture', () => {
    const { limite, motif } = limiteReservation(donnees, MARDI, '04:45');
    assert.equal(motif, 'fermeture_terminus');
    assert.equal(heure(limite), '20:30');
    // La veille, c’est-à-dire le lundi : la limite précède le départ d’un jour.
    assert.equal(limite, instant(
      { annee: 2026, mois: 8, jour: 31 }, enMinutes('20:30')));
  });

  it('bascule sur 16:45 la fin de semaine', () => {
    const tardif = limiteReservation(donnees, SAMEDI, '19:15');
    assert.equal(heure(tardif.limite), '16:45');
    assert.equal(tardif.motif, 'fermeture_terminus');

    const tot = limiteReservation(donnees, SAMEDI, '15:15');
    assert.equal(heure(tot.limite), '14:45');
    assert.equal(tot.motif, 'delai');
  });

  it('remonte au dernier jour ouvert quand le terminus est fermé', () => {
    // Le 25 décembre 2026 est un vendredi et le terminus est fermé ce jour-là ;
    // la veille, jeudi 24, il ferme à 16:45 (horaire de fin de semaine).
    const noel = { annee: 2026, mois: 12, jour: 25 };
    assert.equal(profilDuJour(noel, donnees).terminusOuvert, false);

    const { limite, motif } = limiteReservation(donnees, noel, '10:15');
    assert.equal(motif, 'fermeture_terminus');
    assert.equal(limite, instant(
      { annee: 2026, mois: 12, jour: 24 }, enMinutes('16:45')));
  });

  it('ne place jamais la limite après le départ', () => {
    for (const groupe of donnees.taxibus) {
      const jour = groupe.service === 'semaine' ? MARDI : SAMEDI;
      for (const depart of groupe.heures) {
        const { limite, instantDepart } = limiteReservation(donnees, jour, depart);
        assert.ok(limite <= instantDepart - 30,
          `${depart} : limite trop tardive`);
      }
    }
  });
});

describe('état d’une réservation', () => {
  const limite = { limite: 1000 };

  it('reste ouverte loin de l’échéance', () => {
    assert.equal(etatReservation(limite, 800).code, 'ouvert');
  });

  it('passe en dernière chance dans la dernière heure', () => {
    assert.equal(etatReservation(limite, 950).code, 'bientot');
    assert.equal(etatReservation(limite, 940).code, 'bientot');
    assert.equal(etatReservation(limite, 939).code, 'ouvert');
  });

  it('ferme à l’échéance, pas une minute après', () => {
    assert.equal(etatReservation(limite, 1000).code, 'ferme');
    assert.equal(etatReservation(limite, 1001).code, 'ferme');
    assert.equal(etatReservation(limite, 999).code, 'bientot');
  });
});

describe('départs de taxibus', () => {
  it('ne retient que les zones réellement desservies depuis l’origine', () => {
    const codes = destinationsDepuis(donnees, '4-A', 'semaine').map((z) => z.code);
    // Aucun départ de la zone 4-A vers elle-même : la STC renvoie vers exo.
    assert.ok(!codes.includes('4-A'));
    assert.ok(codes.includes('1'));
    assert.ok(codes.includes('4-B'));
  });

  it('sépare le moment du départ de celui où l’on peut encore réserver', () => {
    const arrivee = instant(MARDI, enMinutes('18:03'));
    const maintenant = instant(MARDI, enMinutes('07:00'));
    const [premier] = departsTaxibus(donnees, {
      origine: '1', destination: '4-A',
      maintenant, depuis: arrivee + 5, jourDeService: MARDI, limite: 1,
    });
    // Le départ suit l’arrivée…
    assert.ok(premier.instantDepart > arrivee);
    // …mais l’état de réservation s’évalue à l’instant présent, pas à l’arrivée.
    assert.equal(premier.etat.code, 'ouvert');
    assert.equal(premier.etat.restant, premier.limite - maintenant);
  });

  it('rend les départs dans l’ordre chronologique', () => {
    const departs = departsTaxibus(donnees, {
      origine: '1', maintenant: instant(MARDI, enMinutes('09:00')),
      jourDeService: MARDI, limite: 10,
    });
    assert.equal(departs.length, 10);
    for (let i = 1; i < departs.length; i += 1) {
      assert.ok(departs[i].instantDepart >= departs[i - 1].instantDepart);
    }
  });

  it('déborde sur les jours suivants en fin de service', () => {
    const departs = departsTaxibus(donnees, {
      origine: '1', maintenant: instant(MARDI, enMinutes('23:50')),
      jourDeService: MARDI, limite: 5,
    });
    assert.ok(departs.length > 0);
    assert.ok(departs.every((d) => d.instantDepart >= instant(MARDI, enMinutes('23:50'))));
  });
});

describe('retour de Longueuil : les cas de référence', () => {
  const arriveesDuSoir = voyages(donnees, 'express', 'sorel', MARDI, profilMardi)
    .map((voyage) => voyage.arrivee)
    .filter((arrivee) => arrivee.arret === 'Terminus des Promenades - STC'
      && arrivee.instant >= instant(MARDI, enMinutes('17:00')));

  it('compte quinze arrivées après 17 h', () => {
    assert.equal(arriveesDuSoir.length, 15);
  });

  it('a déjà fermé la réservation pour chacune d’elles', () => {
    for (const arrivee of arriveesDuSoir) {
      const [taxibus] = departsTaxibus(donnees, {
        origine: '1', destination: '4-A',
        maintenant: instant(MARDI, enMinutes('04:00')),
        depuis: arrivee.instant + 5, jourDeService: MARDI, limite: 1,
      });
      assert.ok(taxibus, `aucun taxibus après ${arrivee.heure}`);
      assert.ok(taxibus.limite < arrivee.instant,
        `arrivée ${arrivee.heure} : la réservation devrait déjà être close`);
    }
  });

  it('rabat sur la fermeture du terminus dès l’arrivée de 20:58', () => {
    const tardives = arriveesDuSoir.filter(
      (a) => a.instant >= instant(MARDI, enMinutes('20:58')));
    assert.equal(tardives.length, 7);
    for (const arrivee of tardives) {
      const [taxibus] = departsTaxibus(donnees, {
        origine: '1', destination: '4-A',
        maintenant: instant(MARDI, enMinutes('04:00')),
        depuis: arrivee.instant + 5, jourDeService: MARDI, limite: 1,
      });
      assert.equal(taxibus.motif, 'fermeture_terminus', `arrivée ${arrivee.heure}`);
      assert.equal(heure(taxibus.limite), '20:30', `arrivée ${arrivee.heure}`);
    }
  });

  it('ferme le dernier express avant même l’embarquement à Longueuil', () => {
    const voyage = voyages(donnees, 'express', 'sorel', MARDI, profilMardi)
      .find((v) => v.arrivee.heure === '23:18');
    assert.ok(voyage, 'express arrivant à 23:18 introuvable');
    assert.equal(voyage.depart.arret, 'Terminus Longueuil (porte A7)');
    assert.equal(voyage.depart.heure, '22:20');

    const [taxibus] = departsTaxibus(donnees, {
      origine: '1', destination: '4-A',
      maintenant: instant(MARDI, enMinutes('04:00')),
      depuis: voyage.arrivee.instant + 5, jourDeService: MARDI, limite: 1,
    });
    assert.equal(taxibus.heure, '00:15');
    assert.equal(heure(taxibus.limite), '20:30');
    // La réservation ferme 1 h 50 avant qu’on monte dans l’autobus.
    assert.equal(voyage.depart.instant - taxibus.limite, 110);
  });
});

describe('grilles horaires', () => {
  it('expose les deux directions de chaque ligne, les deux types de jour', () => {
    for (const ligne of Object.keys(LIGNES)) {
      for (const service of ['semaine', 'fin_de_semaine']) {
        for (const direction of Object.keys(LIGNES[ligne].directions)) {
          const bloc = grille(donnees, ligne, direction, { service });
          assert.ok(bloc, `${ligne}/${service}/${direction} manquant`);
          assert.ok(bloc.arrets.length >= 2);
        }
      }
    }
  });

  it('construit des voyages dont les passages progressent dans le temps', () => {
    for (const voyage of voyages(donnees, 'ligne10', 'cegep', MARDI, profilMardi)) {
      for (let i = 1; i < voyage.passages.length; i += 1) {
        // Croissance large, et non stricte : deux arrêts distants de deux
        // cents mètres tombent dans la même minute d’horaire.
        assert.ok(voyage.passages[i].instant >= voyage.passages[i - 1].instant,
          `voyage de ${voyage.depart.heure} : passage ${i} recule`);
      }
    }
  });

  it('n’expose que des arrêts rattachés à une zone de taxibus', () => {
    for (const ligne of Object.keys(LIGNES)) {
      for (const arret of arretsDeLigne(donnees, ligne)) {
        assert.ok(arret.nom in donnees.zones_des_arrets,
          `arrêt sans zone : ${arret.nom}`);
      }
    }
  });
});

describe('position estimée d’un véhicule', () => {
  const voyage = voyages(donnees, 'ligne10', 'cegep', MARDI, profilMardi)
    .find((v) => v.depart.heure === '09:05');

  it('annonce un départ à venir', () => {
    const etat = position(voyage, voyage.depart.instant - 10);
    assert.equal(etat.etat, 'a_venir');
    assert.equal(etat.dansMinutes, 10);
  });

  it('se situe entre deux arrêts en cours de trajet', () => {
    const etat = position(voyage, voyage.passages[2].instant + 1);
    assert.equal(etat.etat, 'en_route');
    assert.equal(etat.depuis.arret, voyage.passages[2].arret);
    assert.equal(etat.vers.arret, voyage.passages[3].arret);
    assert.ok(etat.progression > 0 && etat.progression < 1);
  });

  it('se déclare à l’arrêt à l’heure de passage', () => {
    assert.equal(position(voyage, voyage.passages[1].instant).etat, 'a_l_arret');
  });

  it('se déclare terminé après le dernier arrêt', () => {
    const etat = position(voyage, voyage.arrivee.instant + 1);
    assert.equal(etat.etat, 'termine');
    assert.equal(etat.progression, 1);
  });

  it('ne retient en circulation que les voyages en cours', () => {
    const moment = instant(MARDI, enMinutes('09:15'));
    for (const { voyage: enCours } of vehiculesEnCirculation(donnees, MARDI, moment)) {
      assert.ok(enCours.depart.instant <= moment);
      assert.ok(enCours.arrivee.instant >= moment);
    }
  });
});

describe('prochains passages', () => {
  it('ne rend que des passages à venir, ordonnés', () => {
    const moment = instant(MARDI, enMinutes('09:00'));
    const passages = prochainsPassages(donnees, {
      ligne: 'ligne10', arret: 'Hôtel-Dieu (Hôpital)',
      maintenant: moment, jourDeService: MARDI, limite: 6,
    });
    assert.equal(passages.length, 6);
    for (let i = 0; i < passages.length; i += 1) {
      assert.ok(passages[i].passage.instant >= moment);
      if (i > 0) {
        assert.ok(passages[i].passage.instant >= passages[i - 1].passage.instant);
      }
    }
  });

  it('bascule sur le lendemain après le dernier passage de la journée', () => {
    const passages = prochainsPassages(donnees, {
      ligne: 'ligne10', arret: 'Terminus des Promenades - STC',
      maintenant: instant(MARDI, enMinutes('01:30')) + 1440,
      jourDeService: MARDI, limite: 2,
    });
    assert.ok(passages.length > 0);
  });
});

describe('formatage des délais', () => {
  it('écrit les minutes, puis les heures', () => {
    assert.equal(delai(0), 'à l’instant');
    assert.equal(delai(1), '1 min');
    assert.equal(delai(59), '59 min');
    assert.equal(delai(60), '1 h 00');
    assert.equal(delai(85), '1 h 25');
    assert.equal(delai(-5), 'passé');
  });
});

describe('retours prolongés par un taxibus', () => {
  const options = {
    embarquement: 'Terminus Longueuil (porte A7)',
    descente: 'Terminus des Promenades - STC',
    zoneDestination: '4-A',
    jourDeService: MARDI,
    maintenant: instant(MARDI, enMinutes('04:00')),
    limite: 40,
  };

  it('rend un retour par express de la journée', () => {
    const retours = retoursAvecTaxibus(donnees, options);
    assert.equal(retours.length, 34);
    for (const retour of retours) {
      assert.equal(retour.depart.arret, options.embarquement);
      assert.equal(retour.arrivee.arret, options.descente);
      assert.ok(retour.arrivee.instant > retour.depart.instant);
      assert.equal(retour.zone, '1');
    }
  });

  it('les rend dans l’ordre des départs', () => {
    const retours = retoursAvecTaxibus(donnees, options);
    for (let i = 1; i < retours.length; i += 1) {
      assert.ok(retours[i].depart.instant > retours[i - 1].depart.instant);
    }
  });

  it('mesure l’attente entre la descente et le taxibus', () => {
    for (const retour of retoursAvecTaxibus(donnees, options)) {
      if (!retour.taxibus) continue;
      assert.equal(retour.attente,
        retour.taxibus.instantDepart - retour.arrivee.instant);
      assert.ok(retour.attente >= 5, 'la marge minimale doit être respectée');
    }
  });

  it('signale qu’il faut réserver avant même de monter dans l’autobus', () => {
    const dernier = retoursAvecTaxibus(donnees, options)
      .find((r) => r.arrivee.heure === '23:18');
    assert.equal(dernier.depart.heure, '22:20');
    assert.equal(dernier.taxibus.heure, '00:15');
    assert.equal(dernier.verdict.code, 'avant_embarquement');
    assert.equal(dernier.verdict.avance, 110);
  });

  it('compte les retours à réserver avant l’embarquement', () => {
    const avantEmbarquement = retoursAvecTaxibus(donnees, options)
      .filter((r) => r.verdict.code === 'avant_embarquement');
    // Six express du soir vers Contrecœur : on quitte Longueuil après 20:30,
    // l’heure à laquelle le terminus a déjà fermé les réservations.
    assert.equal(avantEmbarquement.length, 6);
    for (const retour of avantEmbarquement) {
      assert.equal(retour.taxibus.motif, 'fermeture_terminus');
      assert.ok(retour.depart.instant > retour.taxibus.limite);
    }
  });

  it('compte les retours à réserver avant la descente, zone par zone', () => {
    // La proportion dépend de la zone visée : les départs de taxibus vers
    // Contrecœur et vers Sorel-Tracy ne tombent pas aux mêmes minutes.
    const attendu = { '1': 29, '2-A': 27, '2-B': 28, '3': 28, '4-A': 27, '4-B': 27 };
    for (const [zone, ferme] of Object.entries(attendu)) {
      const codes = retoursAvecTaxibus(donnees, { ...options, zoneDestination: zone })
        .map((r) => r.verdict.code);
      assert.equal(codes.length, 34, `zone ${zone}`);
      const avant = codes.filter((c) => c === 'avant_arrivee'
        || c === 'avant_embarquement').length;
      assert.equal(avant, ferme, `zone ${zone}`);
    }
  });

  it('ferme le verdict quand l’heure limite est déjà passée', () => {
    const [premier] = retoursAvecTaxibus(donnees, {
      ...options, maintenant: instant(MARDI, enMinutes('12:00')), limite: 1,
      aPartirDe: instant(MARDI, enMinutes('05:00')),
    });
    assert.equal(premier.verdict.code, 'ferme');
    assert.equal(premier.taxibus.etat.code, 'ferme');
  });

  it('ne retient que les départs postérieurs au plancher demandé', () => {
    const midi = instant(MARDI, enMinutes('12:00'));
    for (const retour of retoursAvecTaxibus(donnees, {
      ...options, aPartirDe: midi,
    })) {
      assert.ok(retour.depart.instant >= midi);
    }
  });

  it('rend un verdict « aucun » hors du territoire du taxibus', () => {
    const [retour] = retoursAvecTaxibus(donnees, {
      ...options,
      embarquement: 'Terminus des Promenades - STC',
      descente: 'Terminus Longueuil (porte A7)',
      direction: 'longueuil',
      limite: 1,
    });
    assert.equal(retour.zone, null);
    assert.equal(retour.taxibus, null);
    assert.equal(retour.verdict.code, 'aucun');
  });

  it('sait aussi partir de Saint-Roch, en zone 2-A', () => {
    const retours = retoursAvecTaxibus(donnees, {
      ...options,
      descente: 'Mairie St-Roch-de-Richelieu - 1111 rue du Parc',
      zoneDestination: null,
      limite: 5,
    });
    assert.ok(retours.length > 0);
    assert.ok(retours.every((r) => r.zone === '2-A'));
  });
});

describe('arrêts d’une direction', () => {
  it('les rend dans l’ordre du parcours', () => {
    const arrets = arretsDeDirection(donnees, 'express', 'sorel', profilMardi);
    assert.equal(arrets[0], 'Terminus Longueuil (porte A7)');
    assert.equal(arrets[arrets.length - 1], 'Terminus des Promenades - STC');
  });

  it('rend une liste vide pour une direction inconnue', () => {
    assert.deepEqual(
      arretsDeDirection(donnees, 'express', 'inexistante', profilMardi), []);
  });
});

describe('correspondance mise à l’épreuve du temps réel', () => {
  const base = {
    embarquement: 'Terminus Longueuil (porte A7)',
    descente: 'Terminus des Promenades - STC',
    zoneDestination: '1',
    jourDeService: MARDI,
    maintenant: instant(MARDI, enMinutes('04:00')),
    limite: 40,
  };

  /**
   * Flux fictif : le voyage nommé arrive avec le retard demandé. Le reste de
   * l'application ne saurait pas distinguer ce flux d'un vrai.
   */
  function fluxAvecRetard(heureDepart, retardMinutes, annule = false) {
    const voyage = voyages(donnees, 'express', 'sorel', MARDI, profilMardi)
      .find((v) => v.depart.heure === heureDepart);
    // Le flux transporte des secondes epoch, pas les minutes internes de
    // l'application : la fixture doit faire la même conversion que Zenbus.
    const previsions = voyage.passages.map((passage) => {
      const jour = Math.floor(passage.instant / 1440);
      const epoch = versEpoch(dateDepuisNumero(jour),
        passage.instant - jour * 1440 + retardMinutes);
      return { arret: passage.arret, heure: epoch / 1000 };
    });
    return {
      horodatage: 0,
      vehicules: [{
        voyageId: 'essai', ligne: 'express', direction: 'sorel',
        depart: heureDepart, arret: voyage.depart.arret, statut: 'en_route',
      }],
      previsions: new Map([['essai', previsions]]),
      alertes: [],
      annulations: annule
        ? new Map([[`express|sorel|${heureDepart}`, {}]]) : new Map(),
    };
  }

  it('mesure le jeu réel, attente moins battement', () => {
    // L’arrivée de 16:39 laisse six minutes avant le taxibus de 16:45 : en
    // retirant les cinq minutes de battement, il ne reste qu’une minute.
    const retour = retoursAvecTaxibus(donnees, base)
      .find((r) => r.arrivee.heure === '16:39');
    assert.equal(retour.marge, 6);
    assert.equal(retour.jeu, 1);
    assert.equal(retour.margeServree, true);
    assert.equal(retour.correspondancePerdue, false);
  });

  it('ne signale pas une correspondance confortable', () => {
    const retour = retoursAvecTaxibus(donnees, base)
      .find((r) => r.jeu !== null && r.jeu > 15);
    assert.ok(retour, 'aucune correspondance large trouvée');
    assert.equal(retour.margeServree, false);
  });

  it('déclare la correspondance perdue quand le retard dépasse la marge', () => {
    // Six minutes de marge, huit minutes de retard : le taxibus est manqué.
    const retours = retoursAvecTaxibus(donnees, {
      ...base, tempsReel: fluxAvecRetard('15:35', 8),
    });
    const retour = retours.find((r) => r.depart.heure === '15:35');

    assert.equal(retour.arriveeReelle.direct, true);
    assert.equal(retour.arriveeReelle.ecart, 8);
    assert.equal(retour.correspondancePerdue, true);
    assert.equal(retour.taxibusPrevu.heure, '16:45');
    assert.notEqual(retour.taxibus.heure, retour.taxibusPrevu.heure);
    assert.ok(retour.taxibus.instantDepart > retour.taxibusPrevu.instantDepart);
  });

  it('garde la correspondance quand le retard tient dans le jeu', () => {
    // On choisit un retour largement pourvu, puis un retard qui y tient.
    const large = retoursAvecTaxibus(donnees, base)
      .find((r) => r.jeu !== null && r.jeu >= 10);
    const retard = large.jeu - 2;

    const retour = retoursAvecTaxibus(donnees, {
      ...base, tempsReel: fluxAvecRetard(large.depart.heure, retard),
    }).find((r) => r.depart.heure === large.depart.heure);

    assert.equal(retour.arriveeReelle.ecart, retard);
    assert.equal(retour.correspondancePerdue, false);
    assert.equal(retour.taxibus.heure, retour.taxibusPrevu.heure);
  });

  it('perd la correspondance dès que le retard dépasse le jeu, d’une minute', () => {
    const serre = retoursAvecTaxibus(donnees, base)
      .find((r) => r.jeu === 1);

    const tenu = retoursAvecTaxibus(donnees, {
      ...base, tempsReel: fluxAvecRetard(serre.depart.heure, 1),
    }).find((r) => r.depart.heure === serre.depart.heure);
    assert.equal(tenu.correspondancePerdue, false);

    const perdu = retoursAvecTaxibus(donnees, {
      ...base, tempsReel: fluxAvecRetard(serre.depart.heure, 2),
    }).find((r) => r.depart.heure === serre.depart.heure);
    assert.equal(perdu.correspondancePerdue, true);
  });

  it('ne déclare rien de perdu quand une avance rapproche le taxibus', () => {
    const retour = retoursAvecTaxibus(donnees, {
      ...base, tempsReel: fluxAvecRetard('15:35', -4),
    }).find((r) => r.depart.heure === '15:35');
    assert.equal(retour.arriveeReelle.ecart, -4);
    assert.equal(retour.taxibus.heure, retour.taxibusPrevu.heure);
  });

  it('marque un voyage annulé et lui refuse tout verdict de réservation', () => {
    const retour = retoursAvecTaxibus(donnees, {
      ...base, tempsReel: fluxAvecRetard('15:35', 0, true),
    }).find((r) => r.depart.heure === '15:35');

    assert.equal(retour.annule, true);
    assert.equal(retour.verdict.code, 'annule');
  });

  it('laisse les autres voyages intacts quand un seul est annulé', () => {
    const retours = retoursAvecTaxibus(donnees, {
      ...base, tempsReel: fluxAvecRetard('15:35', 0, true),
    });
    assert.equal(retours.filter((r) => r.annule).length, 1);
    assert.ok(retours.filter((r) => !r.annule).length > 30);
  });

  it('ne voit aucune annulation sans flux', () => {
    for (const retour of retoursAvecTaxibus(donnees, base)) {
      assert.equal(retour.annule, false);
      assert.notEqual(retour.verdict.code, 'annule');
    }
  });
});

/**
 * Les fiches horaires ne publient qu'une dizaine de points de passage. Le
 * parcours complet vient du GTFS, greffé sur elles à la construction des
 * données (tools/parcours_gtfs.py). Ces tests vérifient le résultat de la
 * greffe, puisque c'est lui que l'application sert.
 */
describe('parcours complet des lignes', () => {
  it('expose les quarante-trois arrêts de la ligne 10', () => {
    assert.equal(
      arretsDeDirection(donnees, 'ligne10', 'cegep', profilMardi).length, 43);
    assert.equal(
      arretsDeDirection(donnees, 'ligne10', 'terminus', profilMardi).length, 41);
  });

  it('conserve les heures publiées aux points de passage des fiches', () => {
    // Trois repères relevés sur la fiche du 17 août 2026 : premier départ,
    // départ de pointe, dernier départ de la journée.
    const grilleCegep = grille(donnees, 'ligne10', 'cegep', profilMardi);
    const terminus = grilleCegep.arrets
      .find((arret) => arret.nom === 'Terminus des Promenades - STC');
    assert.equal(terminus.heures[0], '04:45');
    assert.equal(terminus.heures[terminus.heures.length - 1], '23:05');
    const hopital = grilleCegep.arrets
      .find((arret) => arret.nom === 'Hôtel-Dieu (Hôpital)');
    assert.equal(hopital.heures[0], '04:58');
  });

  it('rattache chaque passage à son identifiant d’arrêt GTFS', () => {
    for (const ligne of Object.keys(LIGNES)) {
      for (const direction of Object.keys(LIGNES[ligne].directions)) {
        for (const voyage of voyages(donnees, ligne, direction, MARDI,
                                     profilMardi)) {
          for (const passage of voyage.passages) {
            assert.ok(passage.id, `passage sans identifiant : ${passage.arret}`);
          }
        }
      }
    }
  });

  it('donne le même nom aux deux côtés d’une intersection, mais pas le même '
     + 'identifiant', () => {
    const aller = grille(donnees, 'ligne10', 'cegep', profilMardi).arrets
      .find((arret) => arret.nom === 'Marie-Victorin / Rivard');
    const retour = grille(donnees, 'ligne10', 'terminus', profilMardi).arrets
      .find((arret) => arret.nom === 'Marie-Victorin / Rivard');
    assert.ok(aller && retour);
    assert.notEqual(aller.id, retour.id);
  });

  it('mène du Terminus au Cégep sans reculer', () => {
    const parcours = arretsDeDirection(donnees, 'ligne10', 'cegep', profilMardi);
    assert.equal(parcours[0], 'Terminus des Promenades - STC');
    assert.equal(parcours[parcours.length - 1], 'Cégep de Sorel-Tracy');
  });

  it('rattache à une zone de taxibus les arrêts nouvellement exposés', () => {
    assert.equal(donnees.zones_des_arrets['Marie-Victorin / Rivard'], '1');
    assert.equal(donnees.zones_des_arrets['Charlotte / Phipps'], '1');
    assert.equal(
      donnees.zones_des_arrets['Mairie St-Roch-de-Richelieu - 1111 rue du Parc'],
      '2-A');
    assert.equal(donnees.zones_des_arrets['Terminus Longueuil (porte A7)'], null);
  });
});
