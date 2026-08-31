/**
 * « Arrêts près de moi » repose sur deux choses que l'usager ne peut pas
 * vérifier : une distance calculée à la main, et le rapprochement entre la
 * grille horaire et les coordonnées de la table GTFS. Ces tests figent les
 * deux, plus le comportement en cas de refus de géolocalisation — le cas le
 * plus fréquent, et celui qu'on ne voit jamais en développant.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  MEME_ENDROIT, arretsProches, arretsSitues, distanceLisible, distanceMetres,
  localiser, motifDeRefus,
} from '../assets/js/proximite.js';

import { lireHoraires, lireReseauGtfs } from './aide.js';

const donnees = lireHoraires();
const reference = lireReseauGtfs();

// Terminus des Promenades - STC, relevé dans data/reseau-gtfs.json.
const TERMINUS = { lat: 46.025188, lon: -73.106918 };

describe('distance', () => {
  it('rend zéro pour un point et lui-même', () => {
    assert.equal(Math.round(distanceMetres(TERMINUS, TERMINUS)), 0);
  });

  it('mesure un degré de latitude à une centaine de kilomètres', () => {
    const metres = distanceMetres({ lat: 46, lon: -73 }, { lat: 47, lon: -73 });
    // Un degré de méridien vaut 111,2 km ; on tolère la sphéricité du modèle.
    assert.ok(Math.abs(metres - 111_200) < 1000, `${metres} m`);
  });

  it('est symétrique', () => {
    const a = { lat: 46.02, lon: -73.11 };
    const b = { lat: 46.05, lon: -73.15 };
    assert.equal(Math.round(distanceMetres(a, b)),
      Math.round(distanceMetres(b, a)));
  });

  it('s’écrit en mètres puis en kilomètres', () => {
    assert.equal(distanceLisible(0), '0 m');
    assert.equal(distanceLisible(124), '120 m');
    assert.equal(distanceLisible(999), '1000 m');
    assert.equal(distanceLisible(1000), '1,0 km');
    assert.equal(distanceLisible(4321), '4,3 km');
  });
});

describe('arrêts situés', () => {
  it('rattache les arrêts des grilles à leurs coordonnées', () => {
    const situes = arretsSitues(donnees, reference);
    assert.ok(situes.length >= 80, `${situes.length} arrêts situés`);
    for (const arret of situes) {
      assert.ok(Number.isFinite(arret.lat) && Number.isFinite(arret.lon));
      assert.ok(arret.lignes.length > 0);
    }
  });

  it('rend une liste vide sans table GTFS', () => {
    // La table est facultative : son absence dégrade, elle ne casse pas.
    assert.deepEqual(arretsSitues(donnees, null), []);
  });
});

describe('arrêts proches', () => {
  it('met le terminus en tête quand on s’y trouve', () => {
    const proches = arretsProches(donnees, reference, TERMINUS, { limite: 3 });
    assert.equal(proches[0].nom, 'Terminus des Promenades - STC');
    assert.ok(proches[0].distance < 5);
    assert.equal(proches.length, 3);
  });

  it('classe par distance croissante', () => {
    const proches = arretsProches(donnees, reference, TERMINUS, { limite: 6 });
    for (let i = 1; i < proches.length; i += 1) {
      assert.ok(proches[i].distance >= proches[i - 1].distance);
    }
  });

  it('ne propose qu’une fois une intersection desservie dans les deux sens', () => {
    const proches = arretsProches(donnees, reference, TERMINUS, { limite: 60 });
    const noms = proches.map((arret) => arret.nom);
    assert.equal(new Set(noms).size, noms.length);
    // Et l'entrée conservée connaît bien les deux sens.
    const intersection = proches
      .find((arret) => arret.nom === 'Marie-Victorin / Rivard');
    assert.ok(intersection);
    assert.deepEqual([...intersection.directions].sort(),
      ['cegep', 'terminus']);
  });

  it('fond en une seule entrée les deux trottoirs d’un même coin de rue', () => {
    // « Du Roi / Charlotte » et « Charlotte / Du Roi » : dix mètres d'écart,
    // deux noms, un seul endroit. Position relevée devant l'Hôtel-Dieu.
    const proches = arretsProches(donnees, reference,
      { lat: 46.0416, lon: -73.1155 }, { limite: 3 });
    const COIN = ['Du Roi / Charlotte', 'Charlotte / Du Roi'];
    const noms = proches.map((arret) => arret.nom);
    assert.equal(noms.filter((nom) => COIN.includes(nom)).length, 1,
      `deux fois le même coin de rue : ${noms.join(', ')}`);
    const coin = proches.find((arret) => COIN.includes(arret.nom));
    assert.deepEqual(coin.autresNoms,
      COIN.filter((nom) => nom !== coin.nom));
  });

  it('ne fond pas deux arrêts réellement distincts', () => {
    // Le seuil se pose entre la plus lointaine paire face-à-face du réseau
    // (54 m) et le premier arrêt réellement distinct (78 m).
    assert.ok(MEME_ENDROIT > 54 && MEME_ENDROIT < 78);
    const proches = arretsProches(donnees, reference, TERMINUS, { limite: 60 });
    for (let i = 0; i < proches.length; i += 1) {
      for (let j = i + 1; j < proches.length; j += 1) {
        assert.ok(distanceMetres(proches[i], proches[j]) > MEME_ENDROIT,
          `${proches[i].nom} et ${proches[j].nom} sont le même endroit`);
      }
    }
  });

  it('sait se limiter à une ligne', () => {
    const proches = arretsProches(donnees, reference, TERMINUS,
      { limite: 40, ligne: 'express' });
    assert.ok(proches.length > 0);
    for (const arret of proches) assert.ok(arret.lignes.includes('express'));
  });

  it('ne rend rien hors du rayon demandé', () => {
    // Montréal : à plus de soixante kilomètres du réseau.
    const ailleurs = { lat: 45.5017, lon: -73.5673 };
    assert.deepEqual(
      arretsProches(donnees, reference, ailleurs, { rayon: 2000 }), []);
    assert.ok(arretsProches(donnees, reference, ailleurs, { limite: 1 })
      .length === 1);
  });
});

describe('géolocalisation', () => {
  it('rend la position quand le navigateur l’accorde', async () => {
    const resultat = await localiser({
      geolocalisation: {
        getCurrentPosition: (succes) => succes({
          coords: { latitude: 46.02, longitude: -73.11, accuracy: 18 },
        }),
      },
    });
    assert.equal(resultat.erreur, undefined);
    assert.equal(resultat.position.lat, 46.02);
    assert.equal(resultat.position.precision, 18);
  });

  it('rend un motif lisible sur refus, sans lever', async () => {
    const resultat = await localiser({
      geolocalisation: {
        getCurrentPosition: (_, echec) => echec({ code: 1 }),
      },
    });
    assert.equal(resultat.position, undefined);
    assert.match(resultat.erreur, /refusée/);
  });

  it('se passe d’un navigateur qui ne sait pas localiser', async () => {
    const resultat = await localiser({ geolocalisation: null });
    assert.match(resultat.erreur, /ne sait pas/);
  });

  it('nomme chaque motif de refus', () => {
    assert.match(motifDeRefus({ code: 2 }), /indisponible/);
    assert.match(motifDeRefus({ code: 3 }), /trop de temps/);
    assert.match(motifDeRefus(undefined), /introuvable/);
  });
});
