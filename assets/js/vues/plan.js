/**
 * Plan du parcours : ou se trouve le vehicule, sur le trajet reel.
 *
 * La liste des passages dit deja quel arret vient ensuite. Ce qu'elle ne dit
 * pas, c'est *ou* on en est — quarante-trois arrets defilent sans qu'on sache
 * si l'autobus a passe la riviere. Le plan repond a cela, et a rien d'autre :
 * pas de zoom, pas de deplacement, pas de tuiles a telecharger.
 */

import { h, s } from '../dom.js';
import {
  cadre, chemin, couper, projeter, surLeTrace, traceDeDirection,
} from '../plan.js';
import { LIGNES, position } from '../reseau.js';
import { vehiculeDuVoyage } from '../tempsreel.js';

/** Cote du dessin, en unites de viewBox. */
const COTE = 100;

/**
 * Plan d'un voyage, ou null si la geometrie manque.
 *
 * Les traces viennent de la table GTFS, facultative : sans elle l'ecran perd
 * son plan et garde tout le reste.
 */
export function planDuVoyage(voyage, instantCourant, reference, etatTempsReel,
                             arretChoisi = null) {
  const trace = traceDeDirection(reference, voyage.ligne, voyage.direction);
  if (!trace || trace.length < 2) return null;

  const arrets = arretsSitues(voyage, reference, arretChoisi);
  const boite = cadre(trace, COTE, COTE);
  const situation = situer(voyage, instantCourant, etatTempsReel, trace,
    reference);
  const decoupe = situation
    ? couper(trace, situation.avancement) : { parcouru: [], reste: trace };

  const couleur = LIGNES[voyage.ligne].couleur;

  return h('figure.plan',
    s('svg.plan__dessin', {
      viewBox: `0 0 ${COTE} ${COTE}`,
      role: 'img',
      'aria-label': etiquette(voyage, situation),
    },
    s('path.plan__reste', { d: chemin(boite, decoupe.reste) }),
    s(`path.plan__fait.plan__fait--${couleur}`,
      { d: chemin(boite, decoupe.parcouru) }),
    arrets.map((arret) => {
      const [x, y] = projeter(boite, [arret.lat, arret.lon]);
      return s(`circle.plan__arret${arret.choisi ? '.plan__arret--choisi' : ''}`,
        { cx: x, cy: y, r: arret.choisi ? 1.8 : 0.9 });
    }),
    situation ? marqueur(boite, situation, couleur) : null),
    h('figcaption.note', legende(situation)));
}

/** Le vehicule, en direct s'il l'est, estime sinon. */
function marqueur(boite, situation, couleur) {
  const [x, y] = projeter(boite, situation.point);
  return [
    situation.direct
      ? s('circle.plan__halo', { cx: x, cy: y, r: 4.5 }) : null,
    s(`circle.plan__vehicule.plan__vehicule--${couleur}`
      + (situation.direct ? '' : '.plan__vehicule--estime'),
    { cx: x, cy: y, r: 2.4 }),
  ];
}

/**
 * Position du vehicule : celle du flux quand il la donne, celle de l'horaire
 * sinon — ramenee sur le trace, puisqu'un horaire ne connait pas la geometrie.
 *
 * Quand le GPS place le vehicule loin du trace, on le laisse ou il est : c'est
 * peut-etre une deviation, et le corriger reviendrait a affirmer plus que ce
 * qu'on sait.
 */
function situer(voyage, instantCourant, etatTempsReel, trace, reference) {
  const vehicule = etatTempsReel
    ? vehiculeDuVoyage(etatTempsReel, voyage) : null;

  if (vehicule && Number.isFinite(vehicule.latitude)
      && Number.isFinite(vehicule.longitude)) {
    const point = [vehicule.latitude, vehicule.longitude];
    const proche = surLeTrace(trace, point);
    return { point, avancement: proche ? proche.avancement : 0, direct: true,
             ecart: proche ? proche.ecart : null };
  }

  const etat = position(voyage, instantCourant);
  if (etat.etat === 'a_venir' || etat.etat === 'termine') return null;

  const situe = pointDuPassage(etat, reference);
  if (!situe) return null;
  const proche = surLeTrace(trace, situe);
  return { point: proche ? proche.point : situe,
           avancement: proche ? proche.avancement : 0, direct: false };
}

/** Position estimee entre deux arrets, interpolee sur le segment. */
function pointDuPassage(etat, reference) {
  const depuis = reference.arrets[etat.depuis && etat.depuis.id];
  const vers = reference.arrets[etat.vers && etat.vers.id];
  if (!depuis || !vers) return null;
  const part = etat.partSegment || 0;
  return [depuis.lat + (vers.lat - depuis.lat) * part,
    depuis.lon + (vers.lon - depuis.lon) * part];
}

/**
 * Arrets du voyage qui ont une position connue.
 *
 * Celui qu'on a choisi dans la liste est marque : c'est lui qu'on cherche des
 * yeux, et sans cela le plan ne dit pas ou il tombe sur le parcours.
 */
function arretsSitues(voyage, reference, arretChoisi) {
  return voyage.passages
    .map((passage) => {
      const situe = passage.id ? reference.arrets[passage.id] : null;
      return situe ? { ...situe, choisi: passage.arret === arretChoisi } : null;
    })
    .filter(Boolean);
}

function etiquette(voyage, situation) {
  const nom = LIGNES[voyage.ligne].nom;
  const sens = LIGNES[voyage.ligne].directions[voyage.direction];
  if (!situation) return `Parcours de la ${nom}, ${sens}`;
  return `Parcours de la ${nom}, ${sens} — véhicule situé à `
    + `${Math.round(situation.avancement * 100)} % du trajet`;
}

function legende(situation) {
  if (!situation) return 'Parcours complet. Le véhicule n’est pas en route.';
  if (!situation.direct) {
    return 'Position estimée d’après l’horaire, ramenée sur le parcours.';
  }
  // Un ecart franc du trace n'est pas une erreur a masquer : detour, deviation,
  // ou GPS imprecis. On l'affiche.
  if (situation.ecart !== null && situation.ecart > 150) {
    return `Position GPS en direct, à ${Math.round(situation.ecart)} m du `
      + 'parcours habituel.';
  }
  return 'Position GPS en direct.';
}
