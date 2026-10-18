/**
 * Le moteur de règles de réservation, testé isolément.
 *
 * Les cas STC complets vivent dans reseau.test.js, qui importe les mêmes
 * fonctions par le réexport de reseau.js. Ici : l'import direct du module
 * pur, et la forme générique en `Date` — `evaluateBookingStatus` — dont les
 * cas limites (fermeture du terminus, seuil d'urgence, échéance exacte)
 * doivent tenir sans les horaires embarqués.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { enHeure } from '../assets/js/calendrier.js';
import {
  etatReservation,
  evaluateBookingStatus,
  limiteReservation,
} from '../assets/js/booking-rules.js';

import { MARDI, lireHoraires } from './aide.js';

const donnees = lireHoraires();

describe('moteur de règles, importé directement', () => {
  it('applique le délai de trente minutes terminus ouvert', () => {
    const { limite, motif } = limiteReservation(donnees, MARDI, '19:45');
    assert.equal(enHeure(((limite % 1440) + 1440) % 1440), '19:15');
    assert.equal(motif, 'delai');
  });

  it('rabat sur la fermeture du terminus en soirée', () => {
    const { limite, motif } = limiteReservation(donnees, MARDI, '21:45');
    assert.equal(enHeure(((limite % 1440) + 1440) % 1440), '20:30');
    assert.equal(motif, 'fermeture_terminus');
  });

  it('expose les trois états de réservation', () => {
    const limite = { limite: 1000 };
    assert.equal(etatReservation(limite, 800).code, 'ouvert');
    assert.equal(etatReservation(limite, 950).code, 'bientot');
    assert.equal(etatReservation(limite, 1000).code, 'ferme');
  });
});

describe('evaluateBookingStatus', () => {
  const depart = new Date('2026-09-01T21:45:00');
  const fermeture = new Date('2026-09-01T20:30:00');

  it('laisse le délai décider quand le terminus est ouvert au départ', () => {
    const statut = evaluateBookingStatus({
      departureTime: new Date('2026-09-01T19:45:00'),
      currentTime: new Date('2026-09-01T18:00:00'),
      terminusClosingTime: fermeture,
    });
    assert.equal(statut.isBookable, true);
    assert.equal(statut.isUrgent, false);
    assert.equal(statut.cutoffDate.getTime(), new Date('2026-09-01T19:15:00').getTime());
    assert.equal(statut.remainingSeconds, 75 * 60);
  });

  it('rabat sur la fermeture quand le départ a lieu terminus fermé', () => {
    const statut = evaluateBookingStatus({
      departureTime: depart,
      currentTime: new Date('2026-09-01T19:00:00'),
      terminusClosingTime: fermeture,
    });
    assert.equal(statut.cutoffDate.getTime(), fermeture.getTime());
    assert.equal(statut.isBookable, true);
  });

  it('garde le délai s’il est plus contraignant que la fermeture', () => {
    const statut = evaluateBookingStatus({
      departureTime: depart,
      currentTime: new Date('2026-09-01T19:00:00'),
      terminusClosingTime: new Date('2026-09-01T21:30:00'),
    });
    assert.equal(statut.cutoffDate.getTime(), new Date('2026-09-01T21:15:00').getTime());
  });

  it('fonctionne sans fermeture : le délai seul', () => {
    const statut = evaluateBookingStatus({
      departureTime: depart,
      currentTime: new Date('2026-09-01T21:00:00'),
    });
    assert.equal(statut.isBookable, true);
    assert.equal(statut.remainingSeconds, 15 * 60);
    assert.equal(statut.isUrgent, true);
  });

  it('est urgent à quinze minutes pile, pas avant', () => {
    const a15 = evaluateBookingStatus({
      departureTime: depart,
      currentTime: new Date('2026-09-01T21:00:00'),
    });
    assert.equal(a15.isUrgent, true);
    const a16 = evaluateBookingStatus({
      departureTime: depart,
      currentTime: new Date('2026-09-01T20:59:00'),
    });
    assert.equal(a16.isUrgent, false);
  });

  it('est fermé à l’échéance exacte et après', () => {
    const pile = evaluateBookingStatus({
      departureTime: depart,
      currentTime: new Date('2026-09-01T21:15:00'),
    });
    assert.equal(pile.isBookable, false);
    assert.equal(pile.remainingSeconds, 0);

    const apres = evaluateBookingStatus({
      departureTime: depart,
      currentTime: new Date('2026-09-01T22:00:00'),
    });
    assert.equal(apres.isBookable, false);
    assert.equal(apres.isUrgent, false);
    assert.equal(apres.remainingSeconds, 0);
  });

  it('respecte un délai personnalisé', () => {
    const statut = evaluateBookingStatus({
      departureTime: depart,
      currentTime: new Date('2026-09-01T20:00:00'),
      leadTimeMinutes: 60,
    });
    assert.equal(statut.cutoffDate.getTime(), new Date('2026-09-01T20:45:00').getTime());
  });

  it('renvoie un résultat gelé', () => {
    const statut = evaluateBookingStatus({
      departureTime: depart,
      currentTime: new Date('2026-09-01T19:00:00'),
    });
    assert.equal(Object.isFrozen(statut), true);
  });
});
