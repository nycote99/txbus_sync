/**
 * Le lecteur protobuf décode le flux temps réel sans bibliothèque. Comme il
 * lit un format binaire, une erreur ne produit pas un message clair mais des
 * valeurs plausibles et fausses — d'où ces vérifications sur des messages
 * construits à la main.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  champ, entier, entierSigne, flottant, lireMessage, sousMessage, sousMessages,
  texte, toutesLesValeurs,
} from '../assets/js/protobuf.js';

/** Encode un entier en varint, pour bâtir des messages d'essai. */
function varint(valeur) {
  const octets = [];
  let reste = BigInt(valeur);
  do {
    let septBits = Number(reste & 0x7fn);
    reste >>= 7n;
    if (reste > 0n) septBits |= 0x80;
    octets.push(septBits);
  } while (reste > 0n);
  return octets;
}

const etiquette = (numero, type) => varint(numero * 8 + type);
const champVarint = (numero, valeur) => [...etiquette(numero, 0), ...varint(valeur)];

function champOctets(numero, contenu) {
  return [...etiquette(numero, 2), ...varint(contenu.length), ...contenu];
}

const champTexte = (numero, valeur) =>
  champOctets(numero, [...new TextEncoder().encode(valeur)]);

function champFixe32(numero, valeur) {
  const tampon = new DataView(new ArrayBuffer(4));
  tampon.setFloat32(0, valeur, true);
  return [...etiquette(numero, 5), ...new Uint8Array(tampon.buffer)];
}

const message = (...parties) => lireMessage(new Uint8Array(parties.flat()));

describe('lecture du format de fil', () => {
  it('lit un varint sur un et plusieurs octets', () => {
    assert.equal(entier(message(champVarint(1, 0)), 1), 0);
    assert.equal(entier(message(champVarint(1, 127)), 1), 127);
    assert.equal(entier(message(champVarint(1, 150)), 1), 150);
    assert.equal(entier(message(champVarint(1, 1788006858)), 1), 1788006858);
  });

  it('lit une chaîne en UTF-8, accents compris', () => {
    assert.equal(texte(message(champTexte(7, 'Hôtel-Dieu (hôpital)')), 7),
      'Hôtel-Dieu (hôpital)');
  });

  it('lit un flottant sur quatre octets', () => {
    const latitude = flottant(message(champFixe32(1, 46.0454483)), 1);
    assert.ok(Math.abs(latitude - 46.0454483) < 1e-5);
  });

  it('descend dans un message imbriqué', () => {
    const interne = [...champTexte(1, '4843683120676864:3'), ...champVarint(6, 1)];
    const externe = message(champOctets(4, interne));
    const vehicule = sousMessage(externe, 4);
    assert.equal(texte(vehicule, 1), '4843683120676864:3');
    assert.equal(entier(vehicule, 6), 1);
  });

  it('rassemble les occurrences répétées d’un même champ', () => {
    const flux = message(
      champOctets(2, champTexte(1, 'a')),
      champOctets(2, champTexte(1, 'b')),
      champOctets(2, champTexte(1, 'c')));
    assert.equal(sousMessages(flux, 2).length, 3);
    assert.deepEqual(sousMessages(flux, 2).map((m) => texte(m, 1)), ['a', 'b', 'c']);
    assert.equal(toutesLesValeurs(flux, 2).length, 3);
  });

  it('ignore un champ inconnu sans perdre les suivants', () => {
    // Un champ ajouté plus tard par le fournisseur ne doit rien casser.
    const flux = message(
      champVarint(1, 42),
      champVarint(99, 123456),
      champTexte(98, 'champ que nous ne lisons pas'),
      champFixe32(97, 1.5),
      champTexte(2, 'toujours lisible'));
    assert.equal(entier(flux, 1), 42);
    assert.equal(texte(flux, 2), 'toujours lisible');
  });

  it('rend undefined pour un champ absent', () => {
    const flux = message(champVarint(1, 1));
    assert.equal(champ(flux, 2), undefined);
    assert.equal(texte(flux, 2), undefined);
    assert.equal(entier(flux, 2), undefined);
    assert.equal(sousMessage(flux, 2), undefined);
    assert.deepEqual(toutesLesValeurs(flux, 2), []);
  });

  it('refuse un message tronqué plutôt que d’inventer une valeur', () => {
    assert.throws(() => lireMessage(new Uint8Array([0x08, 0x80])), /varint/);
  });

  it('refuse un type de fil inconnu', () => {
    assert.throws(() => lireMessage(new Uint8Array([0x0c, 0x00])), /type de fil/);
  });
});

describe('entiers signés', () => {
  it('lit un retard positif', () => {
    assert.equal(entierSigne(message(champVarint(1, 240)), 1), 240);
  });

  it('lit un retard négatif codé sur soixante-quatre bits', () => {
    // Protobuf étend le signe d’un int32 négatif sur dix octets.
    const moinsCinq = 2n ** 64n - 5n;
    assert.equal(entierSigne(message(champVarint(1, moinsCinq)), 1), -5);
    const moinsCent = 2n ** 64n - 100n;
    assert.equal(entierSigne(message(champVarint(1, moinsCent)), 1), -100);
  });

  it('garde exact un horodatage epoch, qui reste un entier sûr', () => {
    assert.equal(entier(message(champVarint(4, 1788006858)), 4), 1788006858);
  });
});
