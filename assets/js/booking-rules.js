/**
 * Moteur de règles d'admissibilité du taxibus : l'heure limite de réservation.
 *
 * Module pur, sans accès au DOM ni au réseau : chaque fonction ne dépend que
 * de ses arguments, ce qui la rend testable isolément et réutilisable par un
 * autre réseau de transport qui appliquerait la même forme de règle — un
 * délai minimal avant le départ, combiné à une heure de fermeture du point
 * de vente.
 *
 * Deux règles officielles de la STC se cumulent :
 *   1. la réservation est possible jusqu'à 30 minutes avant le départ ;
 *   2. pour les départs qui ont lieu alors que le Terminus des Promenades est
 *      fermé — soirée tardive, nuit, et début de matinée du lendemain — la
 *      réservation doit être faite avant sa fermeture.
 * La plus contraignante des deux l'emporte.
 */

import { decalerDate, instant, instantDeDepart, profilDuJour } from './calendrier.js';

/**
 * @typedef {object} LimiteReservation
 * @property {number} instantDepart Instant du départ, en minutes depuis
 *   l'époque interne du calendrier (voir calendrier.js).
 * @property {number} limite Instant où la réservation se ferme, même unité.
 * @property {'delai'|'fermeture_terminus'} motif La règle qui a fixé la limite.
 */

/**
 * Les horaires embarqués, vus par ce module : seule la règle du délai est
 * lue ici, le reste passe par `profilDuJour` de calendrier.js.
 *
 * @typedef {object} DonneesHoraires
 * @property {{ reservation_minutes_avant: number }} regles
 */

/**
 * Heure limite pour réserver un départ de taxibus.
 *
 * @param {DonneesHoraires} donnees Les horaires embarqués
 *   (`data/horaires.json`).
 * @param {{annee: number, mois: number, jour: number}} jourDeService
 * @param {string} heure Heure de départ, format « HH:MM ».
 * @returns {LimiteReservation}
 */
export function limiteReservation(donnees, jourDeService, heure) {
  const instantDepart = instantDeDepart(jourDeService, heure);
  const delai = donnees.regles.reservation_minutes_avant;
  let limite = instantDepart - delai;
  /** @type {'delai'|'fermeture_terminus'} */
  let motif = 'delai';

  const profil = profilDuJour(jourDeService, donnees);
  const ouvertPendantLeDepart =
    profil.terminusOuvert &&
    instantDepart >= instant(jourDeService, profil.ouverture) &&
    instantDepart <= instant(jourDeService, profil.fermeture);

  if (!ouvertPendantLeDepart) {
    const fermeture = derniereFermeture(donnees, jourDeService, instantDepart);
    if (fermeture !== null && fermeture < limite) {
      limite = fermeture;
      motif = 'fermeture_terminus';
    }
  }
  return { instantDepart, limite, motif };
}

/** Dernière fermeture du terminus qui précède l'instant visé. */
function derniereFermeture(donnees, jourDeService, instantVise) {
  for (let recul = 0; recul < 14; recul += 1) {
    const jour = decalerDate(jourDeService, -recul);
    const profil = profilDuJour(jour, donnees);
    if (!profil.terminusOuvert) continue;
    const fermeture = instant(jour, profil.fermeture);
    if (fermeture <= instantVise) return fermeture;
  }
  return null;
}

/**
 * @typedef {object} EtatReservation
 * @property {'ouvert'|'bientot'|'ferme'} code
 * @property {number} restant Minutes avant la fermeture de la réservation
 *   (négatif ou nul quand elle est fermée).
 * @property {string} libelle Libellé affichable.
 */

/**
 * État d'un départ taxibus par rapport à son heure limite de réservation.
 * Ne lit que la limite elle-même : un `LimiteReservation` complet convient,
 * un simple porteur de limite aussi.
 *
 * @param {{ limite: number }} limite
 * @param {number} instantCourant Même unité que `limite.limite`.
 * @param {number} [seuilAlerte] Minutes sous lesquelles l'état devient
 *   « dernière chance ».
 * @returns {EtatReservation}
 */
export function etatReservation(limite, instantCourant, seuilAlerte = 60) {
  const restant = limite.limite - instantCourant;
  if (restant <= 0) {
    return { code: 'ferme', restant, libelle: 'Réservation fermée' };
  }
  if (restant <= seuilAlerte) {
    return { code: 'bientot', restant, libelle: 'Dernière chance' };
  }
  return { code: 'ouvert', restant, libelle: 'Réservable' };
}

/**
 * @typedef {object} StatutReservation
 * @property {boolean} isBookable La réservation est encore ouverte.
 * @property {boolean} isUrgent Il reste au plus 15 minutes pour réserver.
 * @property {Date} cutoffDate L'instant exact où la réservation se ferme.
 * @property {number} remainingSeconds Secondes restantes, jamais négatif.
 */

/**
 * Forme générique de la même règle, exprimée en `Date` plutôt qu'en minutes
 * internes : c'est le point d'entrée réutilisable par un autre réseau, qui
 * n'a qu'à fournir l'heure de fermeture de son point de vente.
 *
 * @param {object} parametres
 * @param {Date} parametres.departureTime Heure du départ visé.
 * @param {Date} parametres.currentTime Heure courante.
 * @param {Date|null} [parametres.terminusClosingTime] Dernière fermeture du
 *   terminus applicable, ou null si le départ a lieu pendant l'ouverture.
 * @param {number} [parametres.leadTimeMinutes] Délai minimal avant départ.
 * @returns {StatutReservation} Structure gelée : le résultat ne se modifie pas.
 */
export function evaluateBookingStatus({
  departureTime,
  currentTime,
  terminusClosingTime = null,
  leadTimeMinutes = 30,
}) {
  const leadLimit = departureTime.getTime() - leadTimeMinutes * 60000;
  let effectiveCutoff = leadLimit;
  if (terminusClosingTime && departureTime.getTime() > terminusClosingTime.getTime()) {
    effectiveCutoff = Math.min(leadLimit, terminusClosingTime.getTime());
  }
  const remainingMs = effectiveCutoff - currentTime.getTime();
  return Object.freeze({
    isBookable: remainingMs > 0,
    isUrgent: remainingMs > 0 && remainingMs <= 15 * 60000,
    cutoffDate: new Date(effectiveCutoff),
    remainingSeconds: Math.max(0, Math.floor(remainingMs / 1000)),
  });
}
