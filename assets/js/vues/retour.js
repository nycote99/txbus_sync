/**
 * « Mon retour » : le déplacement que l'application existe pour rendre
 * faisable — rentrer en express, puis prendre un taxibus.
 *
 * Sur la quasi-totalité des retours de Longueuil, l'heure limite du taxibus
 * tombe avant qu'on ne descende de l'autobus, et parfois des heures avant
 * qu'on n'y monte. Cet écran met ce verdict au premier plan, et donne les deux
 * gestes qui en découlent : réserver, ou poser un rappel.
 */

import { h, champSelect } from '../dom.js';
import {
  dateLongue, enHeure, enISO, instant, profilDuJour,
} from '../calendrier.js';
import {
  arretsDeDirection, delai, destinationsDepuis, retoursAvecTaxibus,
} from '../reseau.js';
import { preferences, definir } from '../preferences.js';
import { carte, messageVide, pastilleLigne } from './communs.js';
import { boutonRappel } from '../rappel.js';
import { controleDate } from './date.js';

/** Arrêt d'embarquement proposé par défaut : le terminus de Longueuil. */
const EMBARQUEMENT_PAR_DEFAUT = 'Terminus Longueuil (porte A7)';
const DESCENTE_PAR_DEFAUT = 'Terminus des Promenades - STC';

export function vueRetour(contexte) {
  const { donnees, horloge, jourDeService, profil, rafraichir, etatVue } = contexte;
  const prefs = preferences();
  const maintenantInstant = instant(horloge.date, horloge.minutes);

  const arrets = arretsDeDirection(donnees, 'express', 'sorel', profil);
  const embarquement = choisir(arrets, etatVue.embarquement
    || prefs.embarquement, EMBARQUEMENT_PAR_DEFAUT);

  // On ne descend utilement qu'à un arrêt rattaché à une zone de taxibus, et
  // après être monté : les arrêts qui précèdent l'embarquement sont exclus.
  const descentes = arrets
    .slice(arrets.indexOf(embarquement) + 1)
    .filter((nom) => donnees.zones_des_arrets[nom]);
  const descente = choisir(descentes, etatVue.descente || prefs.descente,
    DESCENTE_PAR_DEFAUT);

  const zone = descente ? donnees.zones_des_arrets[descente] : null;
  const destinations = zone
    ? destinationsDepuis(donnees, zone, profil.service) : [];
  const souhaitee = etatVue.zoneDestination !== undefined
    ? etatVue.zoneDestination : prefs.zoneDestination;
  const zoneDestination = destinations.some((z) => z.code === souhaitee)
    ? souhaitee : '';

  const retours = descente ? retoursAvecTaxibus(donnees, {
    embarquement,
    descente,
    zoneDestination: zoneDestination || null,
    jourDeService,
    maintenant: maintenantInstant,
    tempsReel: contexte.tempsReel,
    aPartirDe: contexte.estAujourdHui ? maintenantInstant : null,
    limite: 40,
  }) : [];

  return h('div.pile',
    carteTrajet(contexte, { arrets, embarquement, descentes, descente,
                            destinations, zoneDestination, rafraichir }),
    resumeDuJour(retours, jourDeService, contexte.estAujourdHui),
    carte(`Retours (${retours.length})`,
      retours.length
        ? h('ul.passages', retours.map((retour) =>
            h('li', ligneRetour(retour, donnees, contexte.estAujourdHui))))
        : messageVide(descente
          ? 'Aucun retour à venir pour cette journée.'
          : 'Choisissez un arrêt de descente.'),
      { plat: retours.length > 0 }));
}

function choisir(valeurs, souhaitee, defaut) {
  if (valeurs.includes(souhaitee)) return souhaitee;
  if (valeurs.includes(defaut)) return defaut;
  return valeurs[valeurs.length - 1] || null;
}

function carteTrajet(contexte, options) {
  const { donnees, jourDeService, rafraichir } = contexte;
  const { arrets, embarquement, descentes, descente, destinations,
          zoneDestination } = options;

  const enOptions = (liste) => liste.map((nom) => ({ valeur: nom, texte: nom }));

  return carte('Mon retour', h('div.pile.pile--serre',
    h('div.grille-champs',
      champSelect('Je pars de', enOptions(arrets), embarquement, (valeur) => {
        definir({ embarquement: valeur });
        rafraichir({ embarquement: valeur, descente: null });
      }),
      champSelect('Je descends à', enOptions(descentes), descente, (valeur) => {
        definir({ descente: valeur });
        rafraichir({ descente: valeur });
      })),
    h('div.grille-champs',
      champSelect('Je poursuis vers',
        [{ valeur: '', texte: 'N’importe quelle zone' }].concat(
          destinations.map((z) => ({
            valeur: z.code,
            texte: `${z.nom} — ${z.municipalites.join(', ')}`,
          }))),
        zoneDestination, (valeur) => {
          definir({ zoneDestination: valeur });
          rafraichir({ zoneDestination: valeur });
        }),
      controleDate(contexte)),
    h('p.note', `${dateLongue(jourDeService)} · `,
      donnees.zones_des_arrets[descente]
        ? `descente en zone ${donnees.zones_des_arrets[descente]}`
        : 'arrêt hors du territoire du taxibus')));
}

/** Une phrase qui dit d'emblée combien de ces retours se jouent à l'avance. */
function resumeDuJour(retours, jourDeService, estAujourdHui) {
  const aReserverTot = retours.filter((r) =>
    r.verdict.code === 'avant_arrivee' || r.verdict.code === 'avant_embarquement');
  if (!aReserverTot.length) return null;

  const avantDepart = aReserverTot.filter(
    (r) => r.verdict.code === 'avant_embarquement').length;

  return h('div.bandeau.bandeau--alerte',
    h('div',
      h('strong', `${aReserverTot.length} de ces ${retours.length} retours `
        + 'exigent de réserver avant la descente'),
      h('span', avantDepart
        ? `dont ${avantDepart} avant même de monter dans l’autobus, `
          + 'parce que le terminus aura fermé.'
        : 'la réservation ferme pendant que vous êtes encore en route.')));
}

const LIBELLES = {
  avant_embarquement: 'À réserver avant de partir',
  avant_arrivee: 'À réserver avant d’arriver',
  apres_arrivee: 'Réservable après la descente',
  ferme: 'Réservation fermée',
  aucun: 'Aucun taxibus',
  annule: 'Course annulée',
};

const COULEURS = {
  avant_embarquement: 'arret',
  avant_arrivee: 'alerte',
  apres_arrivee: 'ok',
  ferme: 'neutre',
  aucun: 'neutre',
  annule: 'arret',
};

function ligneRetour(retour, donnees, estAujourdHui) {
  const { departReel, arriveeReelle, taxibus, verdict, annule } = retour;
  const code = verdict.code;
  const clos = code === 'ferme' || code === 'aucun' || annule;

  return h(`div.retour${clos ? '.retour--clos' : ''}`,
    h('div.retour__trajet',
      h(`span.retour__heure${annule ? '.retour__heure--annule' : ''}`,
        departReel.heure),
      h('span.retour__fleche', '→'),
      h(`span.retour__heure${annule ? '.retour__heure--annule' : ''}`,
        arriveeReelle.heure),
      pastilleLigne('express', retour.voyage.circuit),
      annule ? h('span.pastille.pastille--arret', 'Annulé') : null,
      !annule && arriveeReelle.direct
        ? mentionEcartArrivee(arriveeReelle) : null),

    annule
      ? h('p.retour__suite', h('span.pastille.pastille--arret', LIBELLES.annule))
      : taxibus
        ? h('p.retour__suite',
            h('strong', `Taxibus ${taxibus.heure}`),
            ` · ${delai(retour.attente)} d’attente · `,
            h(`span.pastille.pastille--${COULEURS[code]}`, LIBELLES[code]))
        : h('p.retour__suite', h('span.pastille.pastille--neutre',
            LIBELLES[code])),

    annule
      ? h('p.retour__limite', 'La STC déclare cette course supprimée : '
        + 'ne comptez pas dessus pour votre correspondance.')
      : alerteCorrespondance(retour),

    !annule && taxibus
      ? h('p.retour__limite', consigne(retour, estAujourdHui)) : null,

    !clos && taxibus
      ? h('div.retour__actions',
          boutonRappel(retour, donnees),
          h('a.bouton.bouton--principal', {
            href: donnees.liens.reservation, target: '_blank', rel: 'noopener',
          }, 'Réserver'))
      : null);
}

/** L'écart entre l'heure prévue en direct et la fiche horaire. */
function mentionEcartArrivee(arriveeReelle) {
  if (Math.abs(arriveeReelle.ecart) < 2) {
    return h('span.pastille.pastille--ok', 'à l’heure');
  }
  const signe = arriveeReelle.ecart > 0 ? '+' : '−';
  return h(`span.pastille.pastille--${arriveeReelle.ecart > 0 ? 'alerte' : 'neutre'}`,
    `${signe}${Math.abs(arriveeReelle.ecart)} min`);
}

/**
 * Ce que le temps réel change à la correspondance : soit elle est perdue et
 * il faut viser le départ suivant, soit elle tient de si peu qu'il vaut mieux
 * le savoir avant de compter dessus.
 */
function alerteCorrespondance(retour) {
  if (retour.correspondancePerdue) {
    return h('p.retour__risque',
      h('strong', `Correspondance perdue : le taxibus de `
        + `${retour.taxibusPrevu.heure} n’est plus rattrapable.`),
      ` Le retour se reporte sur celui de ${retour.taxibus.heure}.`);
  }
  if (retour.margeServree && retour.taxibus) {
    return h('p.retour__risque',
      `Correspondance serrée : ${delai(retour.jeu)} de jeu seulement `
      + 'une fois la descente faite. Un retard la ferait manquer.');
  }
  return null;
}

/**
 * Le compte à rebours ne s'affiche que pour aujourd'hui : « il reste 60 h »
 * pour un mardi consulté le samedi n'apprend rien à personne.
 */
function consigne(retour, estAujourdHui) {
  const { taxibus, verdict, arriveeReelle } = retour;
  const limite = enHeure(taxibus.limite);
  const restant = estAujourdHui
    ? [' Il reste ', h('strong', delai(taxibus.etat.restant)), '.'] : [];

  if (verdict.code === 'ferme') {
    return `La réservation fermait à ${limite}.`;
  }
  if (verdict.code === 'avant_embarquement') {
    return [`Réservez d’ici ${limite}, soit `,
      h('strong', `${delai(verdict.avance)} avant de monter`),
      ' — le terminus ferme avant votre départ.', restant];
  }
  if (verdict.code === 'avant_arrivee') {
    return [`Réservez d’ici ${limite}, pendant le trajet : `,
      h('strong', `${delai(verdict.avance)} avant d’arriver`), '.', restant];
  }
  return [`Réservez d’ici ${limite}, après votre arrivée de `,
    arriveeReelle.heure, '.', restant];
}

export { enISO };
