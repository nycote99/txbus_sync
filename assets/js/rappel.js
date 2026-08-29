/**
 * Rappel d'une heure limite de réservation, sous forme de fichier calendrier.
 *
 * Savoir qu'il reste quarante-cinq minutes pour réserver ne sert que si l'on y
 * pense encore dans quarante. Un fichier .ics avec une alarme règle cela sans
 * serveur, sans compte et sans permission de notification : le calendrier de
 * l'appareil s'en charge.
 */

import { h } from './dom.js';
import { dateDepuisNumero, enHeure, versEpoch } from './calendrier.js';

/** Minutes d'avance de l'alarme sur l'heure limite. */
const AVANCE_ALARME = 20;

/** Horodatage UTC au format iCalendar : 20260901T003000Z. */
function enHorodatageIcs(millisecondes) {
  return new Date(millisecondes).toISOString()
    .replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/**
 * Replie les lignes à 75 octets, comme l'exige la RFC 5545. Sans cela, un
 * long libellé casse le fichier chez certains calendriers.
 */
function plier(ligne) {
  const octets = new TextEncoder().encode(ligne);
  if (octets.length <= 75) return ligne;
  const morceaux = [];
  let courant = '';
  for (const caractere of ligne) {
    const essai = courant + caractere;
    const limite = morceaux.length === 0 ? 75 : 74;
    if (new TextEncoder().encode(essai).length > limite) {
      morceaux.push(courant);
      courant = caractere;
    } else {
      courant = essai;
    }
  }
  morceaux.push(courant);
  return morceaux.join('\r\n ');
}

/** Échappe les caractères que le format réserve. */
function echapper(texte) {
  return String(texte)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

/**
 * Construit l'évènement de rappel. L'heure limite est une heure murale de
 * Sorel-Tracy ; le fichier la transporte en UTC, ce que tous les calendriers
 * savent relire quel que soit le fuseau de l'appareil.
 */
export function construireRappel({ limiteInstant, titre, description, url,
                                   identifiant, avance = AVANCE_ALARME }) {
  const jour = dateDepuisNumero(Math.floor(limiteInstant / 1440));
  const minutes = limiteInstant - Math.floor(limiteInstant / 1440) * 1440;
  const debut = versEpoch(jour, minutes);

  const lignes = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Sorel Transit//Rappel de reservation//FR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${identifiant}`,
    `DTSTAMP:${enHorodatageIcs(Date.now())}`,
    `DTSTART:${enHorodatageIcs(debut)}`,
    `DTEND:${enHorodatageIcs(debut)}`,
    plier(`SUMMARY:${echapper(titre)}`),
    plier(`DESCRIPTION:${echapper(description)}`),
    url ? plier(`URL:${echapper(url)}`) : null,
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `TRIGGER:-PT${avance}M`,
    plier(`DESCRIPTION:${echapper(titre)}`),
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean);

  return `${lignes.join('\r\n')}\r\n`;
}

/** Décrit le rappel d'un retour prolongé par un taxibus. */
export function rappelDuRetour(retour, donnees) {
  const { taxibus, arriveeReelle, departReel, verdict } = retour;
  const zone = donnees.zones.find((z) => z.code === retour.zoneDestination)
    || null;

  const quand = {
    avant_embarquement: `avant de monter dans l’express de ${departReel.heure}`,
    avant_arrivee: `pendant le trajet, avant votre arrivée de ${arriveeReelle.heure}`,
    apres_arrivee: `après votre arrivée de ${arriveeReelle.heure}`,
  }[verdict.code] || '';

  return {
    limiteInstant: taxibus.limite,
    identifiant: `taxibus-${taxibus.heure.replace(':', '')}`
      + `-${taxibus.limite}@sorel-transit`,
    titre: `Réserver le taxibus de ${taxibus.heure}`,
    description: [
      `Heure limite de réservation : ${enHeure(taxibus.limite)}`
        + (taxibus.motif === 'fermeture_terminus'
          ? ' (fermeture du Terminus des Promenades).' : '.'),
      `Express de ${departReel.heure}, arrivée à ${arriveeReelle.heure}.`,
      quand ? `À faire ${quand}.` : '',
      // Le nom de la municipalité parle, « Zone 4-A » ne dit rien dans un
      // calendrier rouvert trois jours plus tard.
      zone ? `Destination : ${zone.municipalites.join(', ')}.` : '',
      `Réservation : ${donnees.liens.reservation}`,
    ].filter(Boolean).join('\n'),
    url: donnees.liens.reservation,
  };
}

/** Bouton qui déclenche le téléchargement du rappel. */
export function boutonRappel(retour, donnees) {
  return h('button.bouton', {
    type: 'button',
    onclick: (evenement) => {
      const description = rappelDuRetour(retour, donnees);
      telecharger(construireRappel(description),
        `rappel-taxibus-${retour.taxibus.heure.replace(':', 'h')}.ics`);
      const bouton = evenement.currentTarget;
      bouton.textContent = 'Rappel téléchargé';
      setTimeout(() => { bouton.textContent = 'Me le rappeler'; }, 4000);
    },
  }, 'Me le rappeler');
}

function telecharger(contenu, nomDeFichier) {
  const objet = new Blob([contenu], { type: 'text/calendar;charset=utf-8' });
  const adresse = URL.createObjectURL(objet);
  const lien = document.createElement('a');
  lien.href = adresse;
  lien.download = nomDeFichier;
  document.body.append(lien);
  lien.click();
  lien.remove();
  // Le navigateur a besoin d'un instant avant qu'on libère l'objet.
  setTimeout(() => URL.revokeObjectURL(adresse), 1000);
}
