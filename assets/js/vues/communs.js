/** Fragments d'interface partages entre les vues. */

import { h } from '../dom.js';
import { LIGNES, delai, position } from '../reseau.js';
import { dateLongue, enHeure } from '../calendrier.js';

export function pastilleLigne(ligne, circuit) {
  const info = LIGNES[ligne];
  const texte = circuit ? `Express ${circuit}` : info.nom;
  return h(`span.pastille.pastille--${info.couleur}`, texte);
}

export function pastilleTaxibus(texte = 'Taxibus') {
  return h('span.pastille.pastille--taxibus', texte);
}

export function carte(titre, corps, options = {}) {
  const entete = titre
    ? h('div.carte__entete',
        h('h2.carte__titre', titre),
        options.aDroite || null)
    : null;
  return h('section.carte', entete,
    h(`div.carte__corps${options.plat ? '.carte__corps--plat' : ''}`, corps));
}

export function messageVide(texte) {
  return h('p.vide', texte);
}

/** Ligne « prochain passage » cliquable, qui deplie le parcours du vehicule. */
export function elementPassage(entree, instantCourant, auClic) {
  const { voyage, passage, dansMinutes, profil } = entree;
  const direction = LIGNES[voyage.ligne].directions[voyage.direction];
  const meta = [direction];
  if (profil && profil.ferie) meta.push(profil.ferie.nom);

  return h('li',
    h('button.passage', { type: 'button', onclick: () => auClic && auClic(entree) },
      h('span.passage__heure', passage.heure),
      h('span.passage__detail',
        h('span.passage__titre', direction),
        h('span.passage__meta',
          pastilleLigne(voyage.ligne, voyage.circuit),
          ' ',
          voyage.arrivee.arret !== passage.arret
            ? `vers ${voyage.arrivee.arret}` : 'terminus')),
      h('span.passage__delai', delai(dansMinutes),
        h('small', jourRelatif(entree)))));
}

function jourRelatif(entree) {
  const heures = entree.dansMinutes / 60;
  if (heures < 6) return '';
  return dateLongue(entree.profil.date);
}

/**
 * Parcours d'un voyage avec la position estimee du vehicule intercalee entre
 * les deux arrets concernes.
 */
export function parcoursDuVoyage(voyage, instantCourant) {
  const etat = position(voyage, instantCourant);
  const elements = [];

  voyage.passages.forEach((passage, index) => {
    const passe = instantCourant >= passage.instant;
    elements.push(h('li', { dataset: { passe: passe ? 'oui' : 'non' } },
      h('span.parcours__heure', passage.heure),
      h('span.parcours__rail', h('span.parcours__point')),
      h('span.parcours__nom', passage.arret)));

    if (etat.entre && etat.entre[0] === index) {
      elements.push(h('li',
        h('span.parcours__vehicule',
          `Véhicule estimé ici · arrivée à ${etat.vers.arret} vers ${etat.vers.heure}`)));
    }
  });

  return h('ol.parcours', elements);
}

/**
 * Resume de la position d'un vehicule, en deux niveaux : une accroche courte
 * qui tient sur une ligne, et le detail du trajet en cours.
 */
export function resumePosition(voyage, instantCourant) {
  const etat = position(voyage, instantCourant);
  switch (etat.etat) {
    case 'a_venir':
      return {
        titre: `Départ dans ${delai(etat.dansMinutes)}`,
        detail: `de ${voyage.depart.arret}`,
      };
    case 'a_l_arret':
      return { titre: 'À l’arrêt', detail: etat.depuis.arret };
    case 'en_route':
      return {
        titre: `Prochain arrêt ${etat.vers.heure}`,
        detail: `${etat.vers.arret}, en provenance de ${etat.depuis.arret}`,
      };
    default:
      return {
        titre: 'Trajet terminé',
        detail: `${voyage.arrivee.arret} à ${voyage.arrivee.heure}`,
      };
  }
}

export { enHeure };
