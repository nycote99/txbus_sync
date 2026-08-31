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
import { arretsProches, distanceLisible, localiser } from '../proximite.js';
import {
  carte, elementPassage, messageVide, parcoursDuVoyage, pastilleLigne,
  resumePosition,
} from './communs.js';
import { carteCorrespondances } from './correspondances.js';
import { planDuVoyage } from './plan.js';

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
      blocProximite(contexte, ligne, arret),
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
      ? carteSuivi(voyageChoisi, maintenantInstant, donnees, tempsReel,
                   contexte.reference, arret) : null,

    voyageChoisi
      ? carteCorrespondances(contexte, voyageChoisi, maintenantInstant) : null,

    carteHoraire(donnees, ligne, direction, jourDeService, profil,
      maintenantInstant, arret, rafraichir));
}

/**
 * « Près de moi » : raccourci vers l'arret le plus proche.
 *
 * Quarante-trois arrets dans une liste deroulante ne disent pas lequel est au
 * coin de la rue. La position du navigateur, elle, le dit — et elle ne quitte
 * jamais l'appareil : le calcul se fait ici, sur les coordonnees embarquees.
 *
 * Le bouton n'est propose que si la table GTFS est chargee : c'est elle qui
 * porte les coordonnees. Sans elle, la liste deroulante suffit.
 */
function blocProximite(contexte, ligne, arret) {
  const { donnees, reference, etatVue, rafraichir } = contexte;
  if (!reference || !reference.arrets) return null;

  const etat = etatVue.proximite;
  const chercher = () => {
    rafraichir({ proximite: { enCours: true } });
    localiser().then((resultat) => {
      if (resultat.erreur) {
        rafraichir({ proximite: { erreur: resultat.erreur } });
        return;
      }
      rafraichir({ proximite: {
        precision: resultat.position.precision,
        arrets: arretsProches(donnees, reference, resultat.position,
          { ligne, limite: 3 }),
      } });
    });
  };

  return h('div.pile.pile--serre',
    h('button.bouton.bouton--discret', {
      type: 'button',
      disabled: Boolean(etat && etat.enCours),
      onclick: chercher,
    }, etat && etat.enCours ? 'Localisation…' : 'Arrêts près de moi'),
    h('div.proximite', { role: 'status', 'aria-live': 'polite' },
      resultatProximite(etat, arret, contexte)));
}

function resultatProximite(etat, arret, contexte) {
  if (!etat || etat.enCours) return null;
  if (etat.erreur) return h('p.note.note--alerte', etat.erreur);
  if (!etat.arrets || !etat.arrets.length) {
    return h('p.note', 'Aucun arrêt de cette ligne à proximité.');
  }
  return [
    h('div.puces', etat.arrets.map((proche) => h('button.puce', {
      type: 'button',
      'aria-pressed': String(proche.nom === arret),
      // Le trottoir d'en face porte parfois un autre nom — « Du Roi /
      // Charlotte » d'un côté, « Charlotte / Du Roi » de l'autre. On garde le
      // plus proche, sans escamoter le second.
      title: proche.autresNoms && proche.autresNoms.length
        ? `Aussi nommé ${proche.autresNoms.join(', ')} dans l’autre sens`
        : null,
      onclick: () => {
        definir({ arretFavori: proche.nom });
        contexte.rafraichir({ arret: proche.nom, voyage: null });
      },
    }, proche.nom, h('span.puce__mesure', distanceLisible(proche.distance))))),
    etat.precision > 200
      ? h('p.note', `Position approximative à ${distanceLisible(etat.precision)} `
        + 'près : vérifiez le nom avant de vous fier à l’ordre.')
      : null,
  ];
}

function trouverVoyage(donnees, ligne, direction, jourDeService, profil, colonne) {
  if (colonne === null || colonne === undefined) return null;
  return voyages(donnees, ligne, direction, jourDeService, profil)
    .find((v) => v.colonne === colonne) || null;
}

function carteSuivi(voyage, maintenantInstant, donnees, tempsReel, reference,
                    arretChoisi) {
  const resume = resumePosition(voyage, maintenantInstant, tempsReel);
  return carte('Suivi du véhicule',
    h('div.pile.pile--serre',
      h('p.note', h('strong', resume.titre), ' — ', resume.detail),
      planDuVoyage(voyage, maintenantInstant, reference, tempsReel, arretChoisi),
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
