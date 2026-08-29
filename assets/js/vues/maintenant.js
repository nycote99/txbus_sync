/**
 * Vue d'accueil : ce qui se passe sur le reseau a cet instant precis, autobus
 * et taxibus reunis, avec l'echeance de reservation la plus proche.
 */

import { h } from '../dom.js';
import {
  dateLongue, enHeure, instant, profilDuJour,
} from '../calendrier.js';
import {
  arretsDeLigne, delai, departsTaxibus, prochainsPassages,
  vehiculesEnCirculation,
} from '../reseau.js';
import { preferences, definir } from '../preferences.js';
import { carte, elementPassage, messageVide, pastilleTaxibus, resumePosition,
         pastilleLigne } from './communs.js';
import { ligneDepart } from './taxibus.js';

export function vueMaintenant(contexte) {
  const { donnees, horloge, jourDeService, aller } = contexte;
  const prefs = preferences();
  const maintenantInstant = instant(horloge.date, horloge.minutes);
  const profil = profilDuJour(jourDeService, donnees);

  return h('div.pile',
    bandeauDuJour(donnees, profil, jourDeService),
    alerteReservation(contexte, prefs, maintenantInstant),
    h('div.grille-cartes',
      carteAutobus(contexte, prefs, maintenantInstant, aller),
      carteTaxibus(contexte, prefs, maintenantInstant, aller)),
    carteCirculation(donnees, jourDeService, maintenantInstant, aller));
}

function bandeauDuJour(donnees, profil, jourDeService) {
  const heures = donnees.terminus.heures[profil.service];
  const service = profil.service === 'semaine'
    ? 'Horaire du lundi au vendredi'
    : 'Horaire de fin de semaine et jours fériés';

  const details = profil.terminusOuvert
    ? `Terminus des Promenades ouvert de ${heures.ouverture} à ${heures.fermeture}.`
    : 'Terminus des Promenades fermé toute la journée.';

  const genre = profil.terminusOuvert ? 'info' : 'alerte';
  return h(`div.bandeau.bandeau--${genre}`,
    h('div',
      h('strong', `${dateLongue(jourDeService)} · ${service}`),
      h('span', profil.ferie ? `${profil.ferie.nom} — ${details}` : details)));
}

/**
 * Met en avant le prochain depart de taxibus dont la reservation se ferme,
 * puisque c'est l'information la plus perissable de l'application.
 */
function alerteReservation({ donnees, jourDeService }, prefs, maintenantInstant) {
  const departs = departsTaxibus(donnees, {
    origine: prefs.zoneOrigine,
    destination: prefs.zoneDestination || null,
    maintenant: maintenantInstant,
    jourDeService,
    limite: 12,
  });

  const urgent = departs.find((d) => d.etat.code === 'bientot');
  if (!urgent) return null;

  const zone = donnees.zones.find((z) => z.code === prefs.zoneOrigine);
  return h('div.bandeau.bandeau--alerte',
    h('div',
      h('strong', `Réservation à faire d’ici ${delai(urgent.etat.restant)}`),
      h('span', `Départ de ${zone.nom} à ${urgent.heure} — limite de réservation `
        + `à ${enHeure(urgent.limite)}`
        + (urgent.motif === 'fermeture_terminus'
          ? ', soit la fermeture du terminus.' : '.'))));
}

function carteAutobus(contexte, prefs, maintenantInstant, aller) {
  const { donnees, jourDeService } = contexte;
  const passages = [];

  ['ligne10', 'express'].forEach((ligne) => {
    const existe = arretsDeLigne(donnees, ligne)
      .some((a) => a.nom === prefs.arretFavori);
    if (!existe) return;
    passages.push(...prochainsPassages(donnees, {
      ligne,
      arret: prefs.arretFavori,
      maintenant: maintenantInstant,
      jourDeService,
      limite: 5,
    }));
  });

  passages.sort((a, b) => a.passage.instant - b.passage.instant);

  const corps = passages.length
    ? h('ul.passages', passages.slice(0, 5).map((entree) =>
        elementPassage(entree, maintenantInstant,
          () => aller('autobus', { ligne: entree.voyage.ligne,
                                    arret: entree.passage.arret,
                                    voyage: entree.voyage.colonne,
                                    direction: entree.voyage.direction }))))
    : messageVide('Aucun passage à venir à cet arrêt.');

  return carte(prefs.arretFavori, corps, {
    plat: passages.length > 0,
    aDroite: h('button.bouton', {
      type: 'button', onclick: () => aller('autobus'),
    }, 'Changer'),
  });
}

function carteTaxibus(contexte, prefs, maintenantInstant, aller) {
  const { donnees, jourDeService } = contexte;
  const zone = donnees.zones.find((z) => z.code === prefs.zoneOrigine);
  const departs = departsTaxibus(donnees, {
    origine: prefs.zoneOrigine,
    destination: prefs.zoneDestination || null,
    maintenant: maintenantInstant,
    jourDeService,
    limite: 4,
  });

  const corps = departs.length
    ? h('ul.passages', departs.map((depart) =>
        h('li', ligneDepart(depart, maintenantInstant, donnees))))
    : messageVide('Aucun départ à venir depuis cette zone.');

  return carte(`Taxibus depuis ${zone ? zone.nom : '—'}`, corps, {
    plat: departs.length > 0,
    aDroite: h('button.bouton', {
      type: 'button', onclick: () => aller('taxibus'),
    }, 'Changer'),
  });
}

function carteCirculation(donnees, jourDeService, maintenantInstant, aller) {
  const enRoute = vehiculesEnCirculation(donnees, jourDeService, maintenantInstant);

  const corps = enRoute.length
    ? h('ul.passages', enRoute.map(({ voyage }) => {
        const resume = resumePosition(voyage, maintenantInstant);
        return h('li', h('button.passage', {
          type: 'button',
          onclick: () => aller('autobus', { ligne: voyage.ligne,
                                             direction: voyage.direction,
                                             voyage: voyage.colonne,
                                             arret: voyage.depart.arret }),
        },
          h('span.passage__heure', voyage.depart.heure),
          h('span.passage__detail',
            h('span.passage__titre',
              pastilleLigne(voyage.ligne, voyage.circuit), resume.titre),
            h('span.passage__meta', resume.detail)),
          h('span.passage__delai', '→',
            h('small', `arrivée ${voyage.arrivee.heure}`))));
      }))
    : messageVide('Aucun véhicule en circulation en ce moment.');

  return carte(`En circulation (${enRoute.length})`, corps, {
    plat: enRoute.length > 0,
    aDroite: h('span.pastille.pastille--neutre', 'Estimé selon l’horaire'),
  });
}

export { pastilleTaxibus };
