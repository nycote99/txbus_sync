/** Chargement des données embarquées, partagé par les tests. */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const racine = new URL('..', import.meta.url);

function lire(chemin) {
  return JSON.parse(readFileSync(fileURLToPath(new URL(chemin, racine)), 'utf8'));
}

export function lireHoraires() {
  return lire('data/horaires.json');
}

export function lireReseauGtfs() {
  return lire('data/reseau-gtfs.json');
}

/** Un mardi ordinaire de septembre : ni fin de semaine, ni jour férié. */
export const MARDI = { annee: 2026, mois: 9, jour: 1 };
