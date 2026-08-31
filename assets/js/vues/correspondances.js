/**
 * Correspondance autobus -> taxibus.
 *
 * C'est le point de jonction des deux services, et le seul endroit ou l'ordre
 * des choses compte vraiment : un taxibus se reserve au moins 30 minutes a
 * l'avance, souvent avant la fermeture du terminus. Quelqu'un qui monte dans
 * l'express a Longueuil doit donc souvent reserver son taxibus *avant de
 * partir*, pas en arrivant. L'application le dit explicitement.
 */

import { h, champSelect } from '../dom.js';
import { dateLongue, enHeure } from '../calendrier.js';
import {
  delai, departsTaxibus, destinationsDepuis, passageReel,
} from '../reseau.js';
import { preferences, definir } from '../preferences.js';
import { carte, messageVide } from './communs.js';

/** Minutes a prevoir entre la descente de l'autobus et le depart du taxibus. */
const CORRESPONDANCE_MINIMALE = 5;

export function carteCorrespondances(contexte, voyage, maintenantInstant) {
  const { donnees, tempsReel, jourDeService } = contexte;
  const arrivee = voyage.arrivee;
  const zone = donnees.zones_des_arrets[arrivee.arret];

  if (zone === undefined || zone === null) {
    return carte('Correspondance taxibus',
      messageVide(`${arrivee.arret} est hors du territoire desservi par le `
        + 'taxibus régional. Pour ce secteur, consultez exo.'));
  }

  const reel = passageReel(tempsReel, voyage, arrivee);
  const instantArrivee = reel.instant;
  const prefs = preferences();
  const zoneArrivee = donnees.zones.find((z) => z.code === zone);

  // Le choix de la destination se fait ici, là où on s'en sert, plutôt que
  // dans l'onglet Taxibus comme c'était le cas.
  const destinations = destinationsDepuis(donnees, zone, contexte.profil.service);
  const zoneDestination = destinations.some((z) => z.code === prefs.zoneDestination)
    ? prefs.zoneDestination : '';

  const departs = departsTaxibus(donnees, {
    origine: zone,
    destination: zoneDestination || null,
    maintenant: maintenantInstant,
    depuis: instantArrivee + CORRESPONDANCE_MINIMALE,
    jourDeService,
    limite: 5,
  });

  const entete = h('p.note',
    `Arrivée à ${arrivee.arret} `,
    h('strong', reel.heure),
    reel.direct ? ' (prévue en direct)' : ' (selon l’horaire)',
    ` — ${zoneArrivee ? zoneArrivee.nom : `zone ${zone}`}. `,
    `Départs de taxibus à partir de ${CORRESPONDANCE_MINIMALE} minutes `
    + 'après votre descente.');

  const selecteur = champSelect('Je poursuis vers',
    [{ valeur: '', texte: 'N’importe quelle zone' }].concat(
      destinations.map((z) => ({
        valeur: z.code,
        texte: `${z.nom} — ${z.municipalites.join(', ')}`,
      }))),
    zoneDestination, (valeur) => {
      definir({ zoneDestination: valeur });
      contexte.rafraichir();
    });

  const corps = departs.length
    ? h('div.pile.pile--serre', selecteur, entete,
        h('ul.passages', departs.map((depart) =>
          h('li', ligneCorrespondance(depart, instantArrivee, maintenantInstant)))),
        h('a.bouton.bouton--principal.bouton--pleine', {
          href: donnees.liens.reservation, target: '_blank', rel: 'noopener',
        }, 'Réserver maintenant sur le portail de la STC'))
    : h('div.pile.pile--serre', selecteur, entete,
        messageVide('Aucun départ de taxibus après cette arrivée.'));

  return carte('Correspondance taxibus', corps);
}

function ligneCorrespondance(depart, instantArrivee, maintenantInstant) {
  const { etat } = depart;
  const couleur = { ouvert: 'ok', bientot: 'alerte', ferme: 'arret' }[etat.code];
  const heureLimite = enHeure(depart.limite);

  // Le cas qui justifie tout cet ecran : la reservation ferme avant meme que
  // l'autobus n'arrive.
  const limiteAvantArrivee = depart.limite < instantArrivee;
  const encoreTemps = etat.code !== 'ferme';

  const consigne = (() => {
    if (!encoreTemps) return 'Réservation fermée pour ce départ.';
    if (limiteAvantArrivee) {
      return `À réserver avant votre arrivée, d’ici ${heureLimite}.`;
    }
    return `À réserver d’ici ${heureLimite}.`;
  })();

  return h(`div.depart${encoreTemps ? '' : '.depart--ferme'}`,
    h('span.passage__heure', depart.heure),
    h('span.passage__detail',
      h('span.passage__titre',
        h(`span.pastille.pastille--${couleur}`, etat.libelle),
        `${delai(depart.attente)} d’attente`),
      h('span.depart__limite',
        limiteAvantArrivee && encoreTemps
          ? h('strong.correspondance__avis', consigne)
          : consigne,
        estAutreJour(depart, maintenantInstant)
          ? ` · ${dateLongue(depart.jour)}` : '')),
    h('span.depart__compte',
      encoreTemps ? delai(etat.restant) : '—',
      h('small', encoreTemps ? 'pour réserver' : 'trop tard')));
}

function estAutreJour(depart, maintenantInstant) {
  return depart.instantDepart - maintenantInstant > 16 * 60;
}
