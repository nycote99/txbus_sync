/**
 * Le plan se juge à l'œil, mais sa géométrie non : une projection qui
 * étirerait le réseau, un cadre qui déformerait les proportions ou un véhicule
 * placé du mauvais côté du trace se voient mal et se mesurent bien.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  cadre, chemin, couper, distanceMetres, projeter, surLeTrace, traceDeDirection,
} from '../assets/js/plan.js';

import { lireReseauGtfs } from './aide.js';

const reference = lireReseauGtfs();
const TERMINUS = [46.025188, -73.106918];
const CEGEP = [46.03, -73.09];

describe('distance', () => {
  it('compte un degré de latitude pour cent onze kilomètres', () => {
    const metres = distanceMetres([46, -73], [47, -73]);
    assert.ok(Math.abs(metres - 111_132) < 10, `${metres} m`);
  });

  it('comprime la longitude par le cosinus de la latitude', () => {
    // À 46° N, un degré de longitude vaut environ 77 km, pas 111.
    const metres = distanceMetres([46.03, -73], [46.03, -72]);
    assert.ok(Math.abs(metres - 77_340) < 500, `${metres} m`);
  });
});

describe('cadre', () => {
  const trace = traceDeDirection(reference, 'ligne10', 'cegep');

  it('rend null pour un ensemble vide', () => {
    assert.equal(cadre([]), null);
  });

  it('garde les proportions du terrain', () => {
    // Un corridor deux fois plus long que large doit occuper deux fois plus de
    // place en largeur qu'en hauteur — et non remplir le cadre.
    const points = [[46.0, -73.1], [46.0, -73.0], [46.01, -73.0]];
    const boite = cadre(points, 100, 100);
    const [gauche] = projeter(boite, [46.0, -73.1]);
    const [droite] = projeter(boite, [46.0, -73.0]);
    const [, haut] = projeter(boite, [46.01, -73.0]);
    const [, bas] = projeter(boite, [46.0, -73.0]);
    const rapportDessin = (droite - gauche) / (bas - haut);
    const rapportTerrain = distanceMetres([46.0, -73.1], [46.0, -73.0])
      / distanceMetres([46.01, -73.0], [46.0, -73.0]);
    assert.ok(Math.abs(rapportDessin - rapportTerrain) / rapportTerrain < 0.01,
      `dessin ${rapportDessin.toFixed(2)} contre terrain ${rapportTerrain.toFixed(2)}`);
  });

  it('tient tout le tracé dans le cadre, marge comprise', () => {
    const boite = cadre(trace, 100, 100);
    for (const point of trace) {
      const [x, y] = projeter(boite, point);
      assert.ok(x >= 0 && x <= 100, `x = ${x}`);
      assert.ok(y >= 0 && y <= 100, `y = ${y}`);
    }
  });

  it('centre ce qu’il dessine', () => {
    const boite = cadre([[46, -73.1], [46.02, -73.0]], 100, 100);
    const [x, y] = projeter(boite, [46.01, -73.05]);
    assert.ok(Math.abs(x - 50) < 0.5 && Math.abs(y - 50) < 0.5, `${x},${y}`);
  });

  it('met le nord en haut', () => {
    const boite = cadre([[46, -73.1], [46.02, -73.0]], 100, 100);
    const [, nord] = projeter(boite, [46.02, -73.05]);
    const [, sud] = projeter(boite, [46.0, -73.05]);
    assert.ok(nord < sud, 'la latitude croissante devrait monter');
  });
});

describe('chemin SVG', () => {
  it('commence par un déplacement et enchaîne des lignes', () => {
    const boite = cadre([[46, -73], [46.01, -73.01]], 100, 100);
    const trait = chemin(boite, [[46, -73], [46.01, -73.01]]);
    assert.match(trait, /^M[\d.-]+ [\d.-]+ L[\d.-]+ [\d.-]+$/);
  });

  it('rend une chaîne vide sans point', () => {
    assert.equal(chemin(cadre([[46, -73]], 100, 100), []), '');
  });
});

describe('tracés embarqués', () => {
  it('couvre les quatre directions', () => {
    for (const [ligne, direction] of [['ligne10', 'cegep'],
      ['ligne10', 'terminus'], ['express', 'longueuil'], ['express', 'sorel']]) {
      const trace = traceDeDirection(reference, ligne, direction);
      assert.ok(trace && trace.length > 20,
        `${ligne}/${direction} : ${trace ? trace.length : 'absent'} points`);
    }
  });

  it('se passe de la table GTFS quand elle manque', () => {
    assert.equal(traceDeDirection(null, 'ligne10', 'cegep'), null);
    assert.equal(traceDeDirection({}, 'ligne10', 'cegep'), null);
  });

  it('passe à moins de trente mètres de chaque arrêt desservi', () => {
    // La simplification est réglée à dix mètres ; un arrêt qui s'en écarterait
    // beaucoup signalerait un tracé qui n'est pas celui de la ligne.
    const trace = traceDeDirection(reference, 'ligne10', 'cegep');
    const arrets = Object.values(reference.arrets)
      .map((arret) => [arret.lat, arret.lon]);
    const desservis = arrets
      .map((arret) => ({ arret, proche: surLeTrace(trace, arret) }))
      .filter(({ proche }) => proche.ecart < 30);
    assert.ok(desservis.length >= 40,
      `${desservis.length} arrêts à moins de 30 m du tracé`);
  });
});

describe('placement sur le tracé', () => {
  const trace = traceDeDirection(reference, 'ligne10', 'cegep');

  it('ramène un point voisin sur le tracé', () => {
    const proche = surLeTrace(trace, TERMINUS);
    assert.ok(proche.ecart < 30, `${proche.ecart} m du tracé`);
    assert.ok(proche.avancement >= 0 && proche.avancement <= 1);
  });

  it('mesure l’avancement du départ vers l’arrivée', () => {
    const depart = surLeTrace(trace, trace[0]);
    const arrivee = surLeTrace(trace, trace[trace.length - 1]);
    assert.ok(depart.avancement < 0.02, `départ à ${depart.avancement}`);
    assert.ok(arrivee.avancement > 0.98, `arrivée à ${arrivee.avancement}`);
  });

  it('progresse le long du tracé', () => {
    const tiers = surLeTrace(trace, trace[Math.floor(trace.length / 3)]);
    const deuxTiers = surLeTrace(trace,
      trace[Math.floor((2 * trace.length) / 3)]);
    assert.ok(tiers.avancement < deuxTiers.avancement);
  });

  it('dit son écart pour un point hors du parcours', () => {
    // Montréal, à soixante kilomètres.
    const loin = surLeTrace(trace, [45.5017, -73.5673]);
    assert.ok(loin.ecart > 40_000, `${loin.ecart} m`);
  });

  it('rend null pour un tracé sans segment', () => {
    assert.equal(surLeTrace([], CEGEP), null);
    assert.equal(surLeTrace([TERMINUS], CEGEP), null);
  });
});

describe('coupe du tracé', () => {
  const trace = traceDeDirection(reference, 'ligne10', 'cegep');

  it('sépare le parcouru du reste sans perdre de longueur', () => {
    const { parcouru, reste } = couper(trace, 0.4);
    const longueur = (points) => points.slice(1)
      .reduce((somme, point, i) => somme + distanceMetres(points[i], point), 0);
    const entier = longueur(trace);
    assert.ok(Math.abs(longueur(parcouru) + longueur(reste) - entier) < 1,
      'les deux morceaux devraient totaliser le tracé');
    assert.ok(Math.abs(longueur(parcouru) / entier - 0.4) < 0.001);
  });

  it('joint les deux morceaux au même point', () => {
    const { parcouru, reste } = couper(trace, 0.4);
    assert.deepEqual(parcouru[parcouru.length - 1], reste[0]);
  });

  it('rend tout au reste au départ, tout au parcouru à l’arrivée', () => {
    // Sans traitement des extrêmes, on obtiendrait un segment de longueur
    // nulle — invisible au dessin, mais faux à la lecture.
    assert.deepEqual(couper(trace, 0), { parcouru: [], reste: trace });
    assert.deepEqual(couper(trace, 1), { parcouru: trace, reste: [] });
  });

  it('borne un avancement aberrant', () => {
    assert.deepEqual(couper(trace, -3), { parcouru: [], reste: trace });
    assert.deepEqual(couper(trace, 7), { parcouru: trace, reste: [] });
    assert.deepEqual(couper(trace, NaN), { parcouru: [], reste: trace });
  });

  it('ne casse pas sur un tracé trop court pour être coupé', () => {
    assert.deepEqual(couper([], 0.5), { parcouru: [], reste: [] });
    assert.deepEqual(couper([TERMINUS], 0.5),
      { parcouru: [], reste: [TERMINUS] });
  });
});
