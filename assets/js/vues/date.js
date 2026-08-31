/**
 * Choix de la journée consultée.
 *
 * Le moteur sait calculer n'importe quel jour de service ; l'interface ne
 * l'offrait nulle part. C'est pourtant le cas d'usage principal du taxibus :
 * la réservation en ligne ouvre deux semaines à l'avance, donc on prépare son
 * retour de jeudi le lundi.
 */

import { h } from '../dom.js';
import {
  dateLongue, decalerDate, depuisISO, enISO, jourDeServiceActuel, maintenant,
} from '../calendrier.js';

/** Fenêtre de réservation en ligne offerte par la STC, en jours. */
export const HORIZON = 14;

export function controleDate(contexte) {
  const { jourDeService, rafraichir, donnees } = contexte;
  const aujourdHui = jourDeServiceActuel(maintenant());
  const horizon = donnees.regles.reservation_max_en_ligne_jours || HORIZON;

  const champ = h('input', {
    type: 'date',
    value: enISO(jourDeService),
    min: enISO(aujourdHui),
    max: enISO(decalerDate(aujourdHui, horizon)),
    'aria-label': 'Journée consultée',
    onchange: (evenement) => {
      const choisi = depuisISO(evenement.target.value);
      rafraichir({ jour: choisi ? enISO(choisi) : null });
    },
  });

  const estAujourdHui = enISO(jourDeService) === enISO(aujourdHui);

  return h('label.champ',
    h('span', 'Quel jour'),
    champ,
    estAujourdHui
      ? h('span.note', 'aujourd’hui')
      : h('button.lien-discret', {
          type: 'button',
          onclick: () => rafraichir({ jour: null }),
        }, `${dateLongue(jourDeService)} · revenir à aujourd’hui`));
}
