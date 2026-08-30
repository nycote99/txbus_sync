/**
 * Vue autobus : prochains passages a un arret, suivi estime d'un vehicule le
 * long de son parcours, et grille horaire complete de la direction choisie.
 */

import { h, champSelect, segments } from '../dom.js';
import { dateLongue, instant, profilDuJour } from '../calendrier.js';
import {
  LIGNES, arretsDeLigne, grille, prochainsPassages, voyages,
} from '../reseau.js';
import { preferences, definir } from '../preferences.js';
import {
  carte, elementPassage, messageVide, parcoursDuVoyage, pastilleLigne,
  resumePosition,
} from './communs.js';
import { carteCorrespondances } from './correspondances.js';

export function vueAutobus(contexte) {
  const { donnees, horloge, jourDeService, profil, etatVue, rafraichir } = contexte;
  const prefs = preferences();
  const maintenantInstant = instant(horloge.date, horloge.minutes);

  const ligne = LIGNES[etatVue.ligne || prefs.ligneFavorite] ? (etatVue.ligne
    || prefs.ligneFavorite) : 'ligne10';
  const arrets = arretsDeLigne(donnees, ligne);
  const arret = arrets.some((a) => a.nom === etatVue.arret) ? etatVue.arret
    : (arrets.some((a) => a.nom === prefs.arretFavori) ? prefs.arretFavori
      : arrets[0].nom);

  const directions = Object.keys(LIGNES[ligne].directions);
  const direction = directions.includes(etatVue.direction) ? etatVue.direction
    : directions[0];

  const passages = prochainsPassages(donnees, {
    ligne, arret, maintenant: maintenantInstant, jourDeService, limite: 8,
  });

  const voyageChoisi = trouverVoyage(donnees, ligne, direction, jourDeService,
    profil, etatVue.voyage);
  const tempsReel = contexte.tempsReel;

  return h('div.pile',
    carte('Choisir un arrêt', h('div.pile.pile--serre',
      segments(Object.values(LIGNES).map((l) => ({ valeur: l.id, texte: l.nom })),
        ligne, (valeur) => {
          const nouveauxArrets = arretsDeLigne(donnees, valeur);
          const conserve = nouveauxArrets.some((a) => a.nom === arret)
            ? arret : nouveauxArrets[0].nom;
          definir({ ligneFavorite: valeur, arretFavori: conserve });
          rafraichir({ ligne: valeur, arret: conserve, direction: null,
                       voyage: null });
        }, 'Ligne'),
      champSelect('Arrêt', arrets.map((a) => ({ valeur: a.nom, texte: a.nom })),
        arret, (valeur) => {
          definir({ arretFavori: valeur });
          rafraichir({ arret: valeur });
        }),
      h('p.note', `${LIGNES[ligne].sousTitre} · horaire en vigueur depuis le `
        + `${donnees.version_horaire}.`))),

    carte(`Prochains passages · ${arret}`,
      passages.length
        ? h('ul.passages', passages.map((entree) => elementPassage(entree,
            maintenantInstant, () => rafraichir({
              ligne: entree.voyage.ligne,
              direction: entree.voyage.direction,
              voyage: entree.voyage.colonne,
              arret,
            }), tempsReel)))
        : messageVide('Aucun passage à venir à cet arrêt aujourd’hui.'),
      { plat: passages.length > 0 }),

    voyageChoisi
      ? carteSuivi(voyageChoisi, maintenantInstant, donnees, tempsReel) : null,

    voyageChoisi
      ? carteCorrespondances(contexte, voyageChoisi, maintenantInstant) : null,

    carteHoraire(donnees, ligne, direction, jourDeService, profil,
      maintenantInstant, arret, rafraichir));
}

function trouverVoyage(donnees, ligne, direction, jourDeService, profil, colonne) {
  if (colonne === null || colonne === undefined) return null;
  return voyages(donnees, ligne, direction, jourDeService, profil)
    .find((v) => v.colonne === colonne) || null;
}

function carteSuivi(voyage, maintenantInstant, donnees, tempsReel) {
  const resume = resumePosition(voyage, maintenantInstant, tempsReel);
  return carte('Suivi du véhicule',
    h('div.pile.pile--serre',
      h('p.note', h('strong', resume.titre), ' — ', resume.detail),
      parcoursDuVoyage(voyage, maintenantInstant, tempsReel),
      h('a.bouton.bouton--pleine', {
        href: donnees.liens.suivi, target: '_blank', rel: 'noopener',
      }, 'Ouvrir le suivi officiel de la STC')),
    {
      aDroite: resume.direct
        ? h('span.pastille.pastille--ok', 'Position GPS en direct')
        : h('span.pastille.pastille--neutre', 'Position estimée'),
    });
}

function carteHoraire(donnees, ligne, direction, jourDeService, profil,
                      maintenantInstant, arret, rafraichir) {
  const bloc = grille(donnees, ligne, direction, profil);
  if (!bloc) return carte('Horaire complet', messageVide('Aucun service ce jour.'));

  const listeVoyages = voyages(donnees, ligne, direction, jourDeService, profil);
  const prochaineColonne = listeVoyages
    .find((v) => v.depart.instant >= maintenantInstant);

  const entetes = h('tr', h('th', { scope: 'col' }, 'Arrêt'),
    bloc.arrets[0].heures.map((_, colonne) => h('th', { scope: 'col' },
      bloc.circuits ? bloc.circuits[colonne] : colonne + 1)));

  const corps = bloc.arrets.map((ligneArret) => h('tr', {
    dataset: ligneArret.nom === arret ? { choisi: 'oui' } : {},
  },
    h('th', { scope: 'row' }, ligneArret.nom),
    ligneArret.heures.map((heure, colonne) => h(heure ? 'td' : 'td.vide', {
      dataset: prochaineColonne && prochaineColonne.colonne === colonne
        ? { actuel: 'oui' } : {},
    }, heure || '·'))));

  return carte(`Horaire complet · ${LIGNES[ligne].directions[direction]}`,
    h('div.pile.pile--serre',
      segments(Object.entries(LIGNES[ligne].directions)
        .map(([valeur, texte]) => ({ valeur, texte })),
        direction, (valeur) => rafraichir({ direction: valeur, voyage: null }),
        'Direction'),
      h('div.defilant.defilant--grille',
        h('table.horaire',
          h('caption.note', `${dateLongue(jourDeService)} — `
            + (profil.service === 'semaine' ? 'lundi au vendredi'
              : 'fin de semaine et jours fériés')),
          h('thead', entetes), h('tbody', corps)))));
}
