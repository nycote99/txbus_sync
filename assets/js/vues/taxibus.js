/**
 * Vue taxibus : departs par zone, avec l'heure limite de reservation calculee
 * pour chacun. C'est le coeur de l'application, parce qu'un depart de taxibus
 * n'existe que si la reservation a ete faite a temps.
 */

import { h, champSelect, segments } from '../dom.js';
import { dateLongue, enHeure, instant } from '../calendrier.js';
import { delai, departsTaxibus, destinationsDepuis } from '../reseau.js';
import { preferences, definir } from '../preferences.js';
import { carte, messageVide } from './communs.js';

export function vueTaxibus(contexte) {
  const { donnees, horloge, jourDeService, rafraichir } = contexte;
  const prefs = preferences();
  const maintenantInstant = instant(horloge.date, horloge.minutes);

  const zonesOrigine = donnees.zones.map((zone) => ({
    valeur: zone.code,
    texte: `${zone.nom} — ${zone.municipalites.join(', ')}`,
  }));

  const zoneCourante = donnees.zones.find((z) => z.code === prefs.zoneOrigine)
    || donnees.zones[0];
  const service = contexte.profil.service;
  const destinations = destinationsDepuis(donnees, zoneCourante.code, service);

  const choixDestination = [{ valeur: '', texte: 'Toutes les destinations' }]
    .concat(destinations.map((zone) => ({
      valeur: zone.code,
      texte: `${zone.nom} — ${zone.municipalites.join(', ')}`,
    })));

  const destinationValide = prefs.zoneDestination
    && destinations.some((z) => z.code === prefs.zoneDestination)
    ? prefs.zoneDestination : '';

  const departs = departsTaxibus(donnees, {
    origine: zoneCourante.code,
    destination: destinationValide || null,
    maintenant: maintenantInstant,
    jourDeService,
    limite: 20,
  });

  const selecteurs = h('div.grille-champs',
    champSelect('Zone de départ', zonesOrigine, zoneCourante.code, (valeur) => {
      definir({ zoneOrigine: valeur, zoneDestination: '' });
      rafraichir();
    }),
    champSelect('Zone d’arrivée', choixDestination, destinationValide, (valeur) => {
      definir({ zoneDestination: valeur });
      rafraichir();
    }));

  const liste = departs.length
    ? h('ul.passages', departs.map((depart) =>
        h('li', ligneDepart(depart, maintenantInstant, donnees))))
    : messageVide('Aucun départ correspondant dans les prochains jours.');

  return h('div.pile',
    carte('Planifier un déplacement en taxibus', h('div.pile.pile--serre',
      selecteurs,
      h('p.note', zoneCourante.arrets
        ? `Codes d’arrêts de la zone : ${zoneCourante.arrets}.` : null),
      h('a.bouton.bouton--principal.bouton--pleine', {
        href: donnees.liens.reservation, target: '_blank', rel: 'noopener',
      }, 'Réserver sur le portail de la STC'))),

    carte(`Départs (${departs.length})`, liste, { plat: departs.length > 0 }),

    carte('Règles de réservation', reglesReservation(donnees)));
}

/**
 * Un depart, avec son etat de reservation. La jauge represente le temps qu'il
 * reste avant la fermeture de la reservation, sur une fenetre de deux heures.
 */
export function ligneDepart(depart, maintenantInstant, donnees) {
  const { etat, motif } = depart;
  const couleur = { ouvert: 'ok', bientot: 'alerte', ferme: 'arret' }[etat.code];
  const heureLimite = enHeure(depart.limite);
  // La jauge n'apporte quelque chose que dans la derniere fenetre utile :
  // au-dela de deux heures, elle serait pleine pour tous les departs.
  const FENETRE = 120;
  const montrerJauge = etat.code !== 'ferme' && etat.restant <= FENETRE;
  const part = Math.max(0, Math.min(1, etat.restant / FENETRE));

  const explication = motif === 'fermeture_terminus'
    ? `avant la fermeture du terminus (${heureLimite})`
    : `jusqu’à ${heureLimite}`;

  return h(`div.depart${etat.code === 'ferme' ? '.depart--ferme' : ''}`,
    h('span.passage__heure', depart.heure),
    h('span.passage__detail',
      h('span.passage__titre',
        h(`span.pastille.pastille--${couleur}`, etat.libelle),
        depart.dansMinutes > 0 ? `départ dans ${delai(depart.dansMinutes)}`
          : 'départ imminent'),
      h('span.depart__limite', 'Réservation ', explication,
        estAutreJour(depart, maintenantInstant)
          ? ` · ${dateLongue(depart.jour)}` : '')),
    h('span.depart__compte',
      etat.code === 'ferme' ? '—' : delai(etat.restant),
      h('small', etat.code === 'ferme' ? 'trop tard' : 'pour réserver')),
    montrerJauge
      ? h('span.jauge', {
          role: 'img',
          'aria-label': `Il reste ${delai(etat.restant)} pour réserver`,
        }, h('span', {
          style: `width:${(part * 100).toFixed(1)}%;background:var(--${couleur})`,
        }))
      : null);
}

function estAutreJour(depart, maintenantInstant) {
  return depart.instantDepart - maintenantInstant > 16 * 60;
}

function reglesReservation(donnees) {
  const r = donnees.regles;
  return h('div.pile.pile--serre',
    h('dl.liste-definitions',
      definition('Réservation au plus tard',
        `${r.reservation_minutes_avant} min avant le départ`),
      definition('Annulation sans frais',
        `${r.annulation_minutes_avant} min avant le départ`),
      definition('Réservation à l’avance',
        `${r.reservation_max_en_ligne_jours} jours en ligne, `
        + `${r.reservation_max_telephone_jours} jours par téléphone`),
      definition('Présence à l’arrêt',
        `${r.presence_minutes_avant} min avant l’heure du départ`),
      definition('Fenêtre d’embarquement',
        `jusqu’à ${r.fenetre_embarquement_minutes} min après l’heure du départ`)),
    h('p.note', r.note_soiree),
    h('p.note', 'Une absence à un départ réservé entraîne une pénalité selon la '
      + 'zone. La carte d’accès est obligatoire à l’embarquement.'));
}

function definition(terme, valeur) {
  return h('div', h('dt', terme), h('dd', valeur));
}

export { segments };
