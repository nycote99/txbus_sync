/**
 * Lecteur minimal du format de fil protobuf.
 *
 * Le flux GTFS-RT de la STC est un protobuf binaire. Plutot que d'embarquer
 * une bibliotheque de plusieurs centaines de kilo-octets pour lire une dizaine
 * de champs, on decode directement le format de fil : il n'a que quatre types
 * et tient en quelques dizaines de lignes.
 *
 * Le decodage ignore les champs inconnus, ce qui est exactement la garantie de
 * compatibilite ascendante de protobuf : un champ ajoute plus tard par Zenbus
 * ne cassera rien.
 */

const VARINT = 0;
const FIXE64 = 1;
const OCTETS = 2;
const FIXE32 = 5;

/**
 * Decoupe un message en { numeroDeChamp: [valeurs] }.
 * Les valeurs sont brutes : entiers pour les varints, Uint8Array pour les
 * champs delimites. Les accesseurs ci-dessous leur donnent un type.
 */
export function lireMessage(octets) {
  const vue = new DataView(octets.buffer, octets.byteOffset, octets.byteLength);
  const champs = new Map();
  let position = 0;

  const ajouter = (numero, valeur) => {
    const existant = champs.get(numero);
    if (existant) existant.push(valeur);
    else champs.set(numero, [valeur]);
  };

  while (position < octets.length) {
    const [etiquette, apresEtiquette] = lireVarint(octets, position);
    position = apresEtiquette;
    const numero = Math.floor(etiquette / 8);
    const type = etiquette % 8;

    if (type === VARINT) {
      const [valeur, suite] = lireVarint(octets, position);
      position = suite;
      ajouter(numero, valeur);
    } else if (type === OCTETS) {
      const [longueur, suite] = lireVarint(octets, position);
      position = suite;
      ajouter(numero, octets.subarray(position, position + longueur));
      position += longueur;
    } else if (type === FIXE32) {
      ajouter(numero, vue.getFloat32(position, true));
      position += 4;
    } else if (type === FIXE64) {
      ajouter(numero, vue.getFloat64(position, true));
      position += 8;
    } else {
      // Type de fil inconnu : impossible de savoir ou finit le champ.
      throw new Error(`protobuf : type de fil ${type} inattendu`);
    }
  }
  return champs;
}

function lireVarint(octets, position) {
  let resultat = 0;
  let decalage = 1;
  for (let i = 0; i < 10; i += 1) {
    const octet = octets[position + i];
    if (octet === undefined) throw new Error('protobuf : varint tronqué');
    resultat += (octet & 0x7f) * decalage;
    if ((octet & 0x80) === 0) {
      // Au-dela de 2^53 un nombre flottant ne represente plus chaque entier :
      // 2^64 - 5, l'encodage d'un retard de -5 secondes, s'arrondirait a 2^64
      // et donnerait 0. On relit alors la valeur en entier long.
      if (resultat > Number.MAX_SAFE_INTEGER) {
        return [lireVarintLong(octets, position, i + 1), position + i + 1];
      }
      return [resultat, position + i + 1];
    }
    decalage *= 128;
  }
  throw new Error('protobuf : varint trop long');
}

/** Relecture exacte d'un varint long, du dernier groupe de sept bits au premier. */
function lireVarintLong(octets, position, longueur) {
  let resultat = 0n;
  for (let i = longueur - 1; i >= 0; i -= 1) {
    resultat = (resultat << 7n) | BigInt(octets[position + i] & 0x7f);
  }
  return resultat;
}

const decodeurTexte = new TextDecoder('utf-8');

/** Premiere valeur d'un champ, ou undefined. */
export function champ(message, numero) {
  const valeurs = message.get(numero);
  return valeurs ? valeurs[0] : undefined;
}

export function toutesLesValeurs(message, numero) {
  return message.get(numero) || [];
}

export function texte(message, numero) {
  const valeur = champ(message, numero);
  return valeur === undefined ? undefined : decodeurTexte.decode(valeur);
}

export function sousMessage(message, numero) {
  const valeur = champ(message, numero);
  return valeur === undefined ? undefined : lireMessage(valeur);
}

export function sousMessages(message, numero) {
  return toutesLesValeurs(message, numero).map(lireMessage);
}

export function entier(message, numero) {
  const valeur = champ(message, numero);
  if (typeof valeur === 'bigint') return Number(valeur);
  return typeof valeur === 'number' ? valeur : undefined;
}

/**
 * Entier signe encode en varint. Protobuf represente les negatifs sur 64 bits
 * en complement a deux ; c'est le cas du champ `delay` de TripUpdate, qui vaut
 * par exemple 2^64 - 5 pour une avance de cinq secondes.
 */
export function entierSigne(message, numero) {
  const valeur = champ(message, numero);
  if (valeur === undefined) return undefined;
  if (typeof valeur === 'bigint') {
    return Number(valeur >= 2n ** 63n ? valeur - 2n ** 64n : valeur);
  }
  return typeof valeur === 'number' ? valeur : undefined;
}

/** Champ flottant (fixe32). */
export function flottant(message, numero) {
  const valeur = champ(message, numero);
  return typeof valeur === 'number' ? valeur : undefined;
}
