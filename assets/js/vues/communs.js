/** Fragments d'interface partages entre les vues. */

import { h } from '../dom.js';
import { LIGNES, delai, passageReel, position } from '../reseau.js';
import { dateLongue, enHeure } from '../calendrier.js';
import { memeArret, vehiculeDuVoyage, voyageAnnule } from '../tempsreel.js';

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

/**
 * Ligne « prochain passage ». Quand le flux temps reel couvre ce voyage, on
 * affiche l'heure reellement prevue et l'ecart avec l'horaire publie.
 */
export function elementPassage(entree, instantCourant, auClic, etat) {
  const { voyage, passage } = entree;
  const direction = LIGNES[voyage.ligne].directions[voyage.direction];
  const reel = passageReel(etat, voyage, passage);
  const dansMinutes = reel.instant - instantCourant;
  const annule = voyageAnnule(etat, voyage);

  return h('li',
    h(`button.passage${annule ? '.passage--annule' : ''}`, {
      type: 'button', onclick: () => auClic && auClic(entree),
    },
      h('span.passage__heure', reel.heure),
      h('span.passage__detail',
        h('span.passage__titre', direction,
          annule ? [' ', h('span.pastille.pastille--arret', 'Annulé')] : null),
        h('span.passage__meta',
          pastilleLigne(voyage.ligne, voyage.circuit),
          ' ',
          voyage.arrivee.arret !== passage.arret
            ? `vers ${voyage.arrivee.arret}` : 'terminus',
          !annule && reel.direct ? [' ', mentionEcart(reel, passage)] : null)),
      h('span.passage__delai', annule ? '—' : delai(dansMinutes),
        h('small', annule ? 'supprimé'
          : (reel.direct ? 'en direct' : jourRelatif(entree))))));
}

/** « à l’heure », « +4 min », « −2 min » par rapport a la fiche horaire. */
export function mentionEcart(reel, passage) {
  if (!reel.direct) return null;
  if (Math.abs(reel.ecart) < 2) {
    return h('span.pastille.pastille--ok', 'à l’heure');
  }
  const signe = reel.ecart > 0 ? '+' : '−';
  const genre = reel.ecart > 0 ? 'alerte' : 'neutre';
  return h(`span.pastille.pastille--${genre}`,
    `${signe}${Math.abs(reel.ecart)} min / ${passage.heure}`);
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
export function parcoursDuVoyage(voyage, instantCourant, etatTempsReel) {
  const vehicule = etatTempsReel
    ? vehiculeDuVoyage(etatTempsReel, voyage) : null;
  const estime = position(voyage, instantCourant);

  const etapes = voyage.passages.map((passage) => ({
    passage,
    reel: passageReel(etatTempsReel, voyage, passage),
  }));

  // Le GTFS compte bien plus d'arrets que la fiche horaire : le vehicule est
  // souvent a un arret intermediaire absent de ce parcours. On le situe donc
  // par les heures prevues, entre le dernier point passe et le suivant.
  const rangDuVehicule = vehicule
    ? etapes.findIndex(({ reel }) => reel.instant > instantCourant) - 1
    : -1;

  const elements = [];
  etapes.forEach(({ passage, reel }, index) => {
    const passe = instantCourant >= reel.instant;
    elements.push(h('li', { dataset: { passe: passe ? 'oui' : 'non' } },
      h('span.parcours__heure', reel.heure),
      h('span.parcours__rail', h('span.parcours__point')),
      h('span.parcours__nom', passage.arret,
        reel.direct && !passe ? [' ', mentionEcart(reel, passage)] : null)));

    const iciSelonGps = vehicule && index === Math.max(rangDuVehicule, 0);
    const iciSelonHoraire = !vehicule && estime.entre
      && estime.entre[0] === index;

    if (iciSelonGps || iciSelonHoraire) {
      elements.push(h('li',
        h('span.parcours__vehicule',
          vehicule
            ? libelleVehicule(vehicule)
            : `Véhicule estimé ici · arrivée à ${estime.vers.arret} `
              + `vers ${estime.vers.heure}`)));
    }
  });

  return h('ol.parcours', elements);
}

function libelleVehicule(vehicule) {
  const etats = {
    a_l_arret: 'Véhicule à l’arrêt',
    approche: 'Véhicule en approche de',
    en_route: 'Véhicule en route vers',
  };
  const etat = etats[vehicule.statut] || 'Véhicule vers';
  return vehicule.arret ? `${etat} ${vehicule.arret} · GPS`
    : 'Véhicule ici · GPS';
}

/**
 * Resume de la position d'un vehicule, en deux niveaux : une accroche courte
 * qui tient sur une ligne, et le detail du trajet en cours.
 */
export function resumePosition(voyage, instantCourant, etatTempsReel) {
  const vehicule = etatTempsReel
    ? vehiculeDuVoyage(etatTempsReel, voyage) : null;
  if (vehicule && vehicule.arret) {
    const prochain = voyage.passages.find((p) => !memeArret(vehicule.arret, p.arret)
      && p.instant >= instantCourant);
    const reel = prochain
      ? passageReel(etatTempsReel, voyage, prochain) : null;
    return {
      titre: vehicule.statut === 'a_l_arret'
        ? `À l’arrêt ${vehicule.arret}`
        : `Vers ${vehicule.arret}`,
      detail: reel
        ? `${prochain.arret} prévu à ${reel.heure}`
        : 'position GPS en direct',
      direct: true,
    };
  }

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
