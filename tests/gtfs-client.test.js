/**
 * Le client GTFS-RT à états, éprouvé avec un décodeur factice : ce qui est
 * testé ici n'est pas le flux de la STC, mais la machine à états — mode
 * initial, bascules, délai maximal, et ce que les évènements racontent.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { TransitFeedService } from '../assets/js/gtfs-client.js';

const REFERENCE = { flux_temps_reel: 'factice' };
const ETAT = { horodatage: 1, vehicules: [], alertes: [] };

/** Service branché sur un décodeur dont on choisit les réponses. */
function service(reponses, options = {}) {
  let appel = 0;
  return new TransitFeedService(REFERENCE, {
    charger: async () => reponses[Math.min(appel++, reponses.length - 1)],
    ...options,
  });
}

/** Écoute les évènements `update` d'un service, dans l'ordre. */
function ecouter(svc) {
  const recus = [];
  svc.addEventListener('update', (e) => recus.push(e.detail));
  return recus;
}

describe('TransitFeedService', () => {
  it('commence hors ligne, sans état', () => {
    const svc = service([ETAT]);
    assert.equal(svc.mode, 'HORS_LIGNE');
    assert.equal(svc.etat, null);
  });

  it('passe en DIRECT dès que le flux répond, et le dit', async () => {
    const svc = service([ETAT]);
    const recus = ecouter(svc);
    const transitions = [];
    svc.addEventListener('modechange', (e) => transitions.push(e.detail));

    const mode = await svc.rafraichir();
    assert.equal(mode, 'DIRECT');
    assert.equal(svc.etat, ETAT);
    assert.equal(recus.length, 1);
    assert.equal(recus[0].mode, 'DIRECT');
    assert.equal(recus[0].etat, ETAT);
    assert.equal(recus[0].raison, null);
    assert.deepEqual(transitions, [{ mode: 'DIRECT', precedent: 'HORS_LIGNE' }]);
  });

  it('reste HORS_LIGNE quand le flux n’a jamais répondu', async () => {
    const svc = service([null]);
    const recus = ecouter(svc);
    await svc.rafraichir();
    assert.equal(svc.mode, 'HORS_LIGNE');
    assert.equal(svc.etat, null);
    assert.equal(recus[0].raison, 'flux-injoignable');
  });

  it('bascule en DEGRADE_HORAIRE en gardant le dernier état connu', async () => {
    const svc = service([ETAT, null]);
    await svc.rafraichir();
    const recus = ecouter(svc);
    await svc.rafraichir();
    assert.equal(svc.mode, 'DEGRADE_HORAIRE');
    assert.equal(svc.etat, ETAT);
    assert.equal(recus[0].etat, ETAT);
    assert.equal(recus[0].raison, 'flux-injoignable');
  });

  it('revient en DIRECT quand le flux revient', async () => {
    const svc = service([ETAT, null, ETAT]);
    await svc.rafraichir();
    await svc.rafraichir();
    assert.equal(svc.mode, 'DEGRADE_HORAIRE');
    await svc.rafraichir();
    assert.equal(svc.mode, 'DIRECT');
  });

  it('ne joint même pas le flux quand l’appareil est hors ligne', async () => {
    let appels = 0;
    const svc = new TransitFeedService(REFERENCE, {
      charger: async () => {
        appels += 1;
        return ETAT;
      },
      enLigne: () => false,
    });
    const recus = ecouter(svc);
    await svc.rafraichir();
    assert.equal(appels, 0);
    assert.equal(svc.mode, 'HORS_LIGNE');
    assert.equal(recus[0].raison, 'hors-ligne');
  });

  it('abandonne une interrogation qui dépasse le délai strict', async () => {
    const svc = new TransitFeedService(REFERENCE, {
      timeoutMs: 20,
      charger: async (reference, signal) =>
        new Promise((resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('abandon')));
        }),
    });
    const recus = ecouter(svc);
    await svc.rafraichir();
    assert.equal(svc.mode, 'HORS_LIGNE');
    assert.equal(recus[0].raison, 'delai-depasse');
  });

  it('n’interroge pas le flux pour un écran caché', async () => {
    let appels = 0;
    const svc = new TransitFeedService(REFERENCE, {
      charger: async () => {
        appels += 1;
        return ETAT;
      },
      visible: () => false,
    });
    const recus = ecouter(svc);
    await svc.rafraichir();
    assert.equal(appels, 0);
    assert.equal(recus.length, 0);
    assert.equal(svc.mode, 'HORS_LIGNE');
  });

  it('démarre par une interrogation immédiate et s’arrête proprement', async () => {
    const svc = service([ETAT], { delaiRafraichissement: 60000 });
    const recus = ecouter(svc);
    svc.demarrer();
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(recus.length, 1);
    svc.arreter();
    assert.equal(svc.minuteur, null);
  });
});
