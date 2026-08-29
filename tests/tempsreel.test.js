/**
 * La couche temps réel est facultative par construction : elle doit enrichir
 * l'affichage quand le flux répond, et s'effacer sans bruit sinon. Ces tests
 * couvrent les deux cas, à partir d'un flux réel figé le 29 août 2026.
 */

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  chargerTempsReel, enTexteSimple, memeArret, previsionA, vehiculeDuVoyage,
} from '../assets/js/tempsreel.js';
import { instantDepuisEpoch } from '../assets/js/calendrier.js';

import { lireReseauGtfs } from './aide.js';

const reference = lireReseauGtfs();
const echantillon = readFileSync(
  fileURLToPath(new URL('flux-exemple.pb', import.meta.url)));

/** Remplace fetch le temps d'un appel, pour éprouver le chargement du flux. */
async function avecFlux(reponse, action) {
  const original = globalThis.fetch;
  globalThis.fetch = async () => reponse();
  try {
    return await action();
  } finally {
    globalThis.fetch = original;
  }
}

const fluxValide = () => ({
  ok: true,
  arrayBuffer: async () => echantillon.buffer.slice(
    echantillon.byteOffset, echantillon.byteOffset + echantillon.byteLength),
});

describe('chargement du flux', () => {
  it('décode un flux réel et nomme ce qu’il contient', async () => {
    const etat = await avecFlux(fluxValide,
      () => chargerTempsReel(reference));

    assert.ok(etat, 'le flux aurait dû être décodé');
    assert.ok(etat.horodatage > 1_700_000_000);
    assert.ok(etat.vehicules.length > 0);

    for (const vehicule of etat.vehicules) {
      assert.ok(['ligne10', 'express'].includes(vehicule.ligne));
      assert.ok(['cegep', 'terminus', 'longueuil', 'sorel']
        .includes(vehicule.direction));
      assert.match(vehicule.depart, /^\d{2}:\d{2}$/);
      assert.ok(vehicule.latitude > 45 && vehicule.latitude < 47);
      assert.ok(vehicule.longitude > -74 && vehicule.longitude < -72);
      assert.ok(['approche', 'a_l_arret', 'en_route'].includes(vehicule.statut));
    }
  });

  it('associe des heures de passage prévues à chaque voyage suivi', async () => {
    const etat = await avecFlux(fluxValide, () => chargerTempsReel(reference));
    for (const vehicule of etat.vehicules) {
      const previsions = etat.previsions.get(vehicule.voyageId);
      if (!previsions) continue;
      assert.ok(previsions.length > 0);
      for (const prevision of previsions) {
        assert.ok(prevision.heure > 1_700_000_000);
      }
      // Les prévisions se suivent dans le temps.
      for (let i = 1; i < previsions.length; i += 1) {
        assert.ok(previsions[i].heure >= previsions[i - 1].heure);
      }
    }
  });

  it('ramène le texte des avis à l’alphabet latin', async () => {
    const etat = await avecFlux(fluxValide, () => chargerTempsReel(reference));
    assert.ok(etat.alertes.length > 0);
    for (const alerte of etat.alertes) {
      // Aucun caractère du bloc mathématique ne doit subsister.
      const texte = `${alerte.titre || ''} ${alerte.texte || ''}`;
      for (const caractere of texte) {
        const point = caractere.codePointAt(0);
        assert.ok(point < 0x1d400 || point > 0x1d7ff,
          `caractère mathématique resté dans un avis : ${caractere}`);
      }
    }
  });
});

describe('effacement silencieux quand le flux manque', () => {
  it('rend null sur une erreur réseau', async () => {
    const etat = await avecFlux(
      () => { throw new Error('hors ligne'); },
      () => chargerTempsReel(reference));
    assert.equal(etat, null);
  });

  it('rend null sur une réponse en erreur', async () => {
    const etat = await avecFlux(
      () => ({ ok: false, status: 503 }),
      () => chargerTempsReel(reference));
    assert.equal(etat, null);
  });

  it('rend null sur un flux illisible plutôt que de propager', async () => {
    const etat = await avecFlux(
      () => ({ ok: true, arrayBuffer: async () => new Uint8Array([0x0c, 0x00]).buffer }),
      () => chargerTempsReel(reference));
    assert.equal(etat, null);
  });
});

describe('appariement avec l’horaire publié', () => {
  it('ne rattache rien quand le flux est absent', () => {
    const voyage = { ligne: 'ligne10', direction: 'cegep', depart: { heure: '09:05' } };
    assert.equal(vehiculeDuVoyage(null, voyage), null);
    assert.equal(previsionA(null, null, 'Terminus des Promenades - STC'), null);
  });

  it('rattache un véhicule par ligne, direction et heure de départ', async () => {
    const etat = await avecFlux(fluxValide, () => chargerTempsReel(reference));
    const reel = etat.vehicules[0];
    const voyage = {
      ligne: reel.ligne, direction: reel.direction,
      depart: { heure: reel.depart },
    };
    assert.equal(vehiculeDuVoyage(etat, voyage).voyageId, reel.voyageId);

    // Une heure de départ voisine ne doit pas être confondue.
    const autre = { ...voyage, depart: { heure: '02:02' } };
    assert.equal(vehiculeDuVoyage(etat, autre), null);
  });

  it('place la prévision sur la même échelle que l’horaire', async () => {
    const etat = await avecFlux(fluxValide, () => chargerTempsReel(reference));
    for (const vehicule of etat.vehicules) {
      const previsions = etat.previsions.get(vehicule.voyageId) || [];
      const nommee = previsions.find((p) => p.arret);
      if (!nommee) continue;
      const prevision = previsionA(etat, vehicule, nommee.arret);
      assert.ok(prevision);
      assert.equal(Number.isFinite(instantDepuisEpoch(prevision.heure)), true);
      return;
    }
  });
});

describe('rapprochement des noms d’arrêts', () => {
  it('réconcilie les écarts de graphie entre les deux sources', () => {
    assert.ok(memeArret('Hôtel-Dieu (Hôpital)', 'Hôtel-Dieu (hôpital)'));
    assert.ok(memeArret('Stationnement incitatif de la Plaza Tracy',
      'Stationnement incitatif Plaza Tracy'));
    assert.ok(memeArret('Cégep de Sorel-Tracy', 'CÉGEP de Sorel-Tracy'));
    assert.ok(memeArret('Terminus Longueuil (porte A7)',
      'Terminus Longueuil (porte A7)'));
  });

  it('distingue deux arrêts opposés qui portent les mêmes mots', () => {
    assert.ok(!memeArret('Charlotte / Du Roi', 'Du Roi / Charlotte'));
  });

  it('ne confond pas des arrêts voisins d’une même rue', () => {
    assert.ok(!memeArret('Hôtel-Dieu / Guévremont', 'Hôtel-Dieu / Fiset'));
    assert.ok(!memeArret('Marie-Victorin / Filiatrault', 'Marie-Victorin / Garneau'));
  });
});

describe('mise en texte simple des avis', () => {
  it('convertit les majuscules et minuscules grasses', () => {
    assert.equal(enTexteSimple('𝗧𝗿𝗮𝘃𝗮𝘂𝘅 𝗺𝗮𝗷𝗲𝘂𝗿𝘀'), 'Travaux majeurs');
  });

  it('convertit les chiffres gras', () => {
    assert.equal(enTexteSimple('𝗧𝗮𝗿𝗶𝗳𝘀 𝟮𝟬𝟮𝟲'), 'Tarifs 2026');
  });

  it('laisse intacts les accents et la ponctuation française', () => {
    assert.equal(enTexteSimple('Réfection déjà à côté — l’arrêt n° 5'),
      'Réfection déjà à côté — l’arrêt n° 5');
  });

  it('laisse passer les valeurs vides', () => {
    assert.equal(enTexteSimple(null), null);
    assert.equal(enTexteSimple(''), '');
  });
});
