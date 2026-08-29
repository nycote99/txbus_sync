/**
 * Calendrier de service de la STC Pierre-De Saurel.
 *
 * Deux notions distinctes se croisent ici :
 *   - le *jour civil*, celui du calendrier ;
 *   - le *jour de service*, qui commence a 03:00 et se termine le lendemain
 *     vers 01:45, parce que les derniers departs debordent apres minuit.
 *
 * Tous les calculs se font en heure murale d'America/Toronto, quelle que soit
 * la position de l'appareil, et sans objet Date intermediaire : un instant est
 * un nombre de minutes depuis une epoque arbitraire, ce qui evite les pieges
 * du changement d'heure.
 */

export const FUSEAU = 'America/Toronto';
export const DEBUT_JOUR_SERVICE = 3 * 60; // 03:00

const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi',
               'samedi'];
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet',
              'août', 'septembre', 'octobre', 'novembre', 'décembre'];

/** Date civile {annee, mois, jour} et heure {minutes} a Sorel-Tracy. */
export function maintenant(horlogeFactice) {
  if (horlogeFactice) return horlogeFactice;
  const parties = new Intl.DateTimeFormat('en-CA', {
    timeZone: FUSEAU, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const p = Object.fromEntries(parties.map((x) => [x.type, x.value]));
  return {
    date: { annee: +p.year, mois: +p.month, jour: +p.day },
    minutes: (+p.hour % 24) * 60 + +p.minute + +p.second / 60,
  };
}

/**
 * Convertit un horodatage epoch (secondes) en heure murale a Sorel-Tracy.
 * Le flux temps reel publie des instants absolus ; l'horaire publie, des
 * heures murales. C'est ici qu'on les ramene sur la meme echelle.
 */
export function depuisEpoch(secondes) {
  const parties = new Intl.DateTimeFormat('en-CA', {
    timeZone: FUSEAU, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(new Date(secondes * 1000));
  const p = Object.fromEntries(parties.map((x) => [x.type, x.value]));
  return {
    date: { annee: +p.year, mois: +p.month, jour: +p.day },
    minutes: (+p.hour % 24) * 60 + +p.minute + +p.second / 60,
  };
}

/** Instant absolu, en minutes, d'un horodatage epoch. */
export function instantDepuisEpoch(secondes) {
  const { date, minutes } = depuisEpoch(secondes);
  return instant(date, minutes);
}

/** Numero de jour continu, pour comparer et decaler des dates sans Date(). */
export function numeroDeJour({ annee, mois, jour }) {
  const a = Math.floor((14 - mois) / 12);
  const y = annee + 4800 - a;
  const m = mois + 12 * a - 3;
  return jour + Math.floor((153 * m + 2) / 5) + 365 * y + Math.floor(y / 4)
    - Math.floor(y / 100) + Math.floor(y / 400) - 32045;
}

export function dateDepuisNumero(numero) {
  const a = numero + 32044;
  const b = Math.floor((4 * a + 3) / 146097);
  const c = a - Math.floor((146097 * b) / 4);
  const d = Math.floor((4 * c + 3) / 1461);
  const e = c - Math.floor((1461 * d) / 4);
  const m = Math.floor((5 * e + 2) / 153);
  return {
    jour: e - Math.floor((153 * m + 2) / 5) + 1,
    mois: m + 3 - 12 * Math.floor(m / 10),
    annee: 100 * b + d - 4800 + Math.floor(m / 10),
  };
}

export function decalerDate(date, jours) {
  return dateDepuisNumero(numeroDeJour(date) + jours);
}

/** 0 = dimanche. */
export function jourDeSemaine(date) {
  return (numeroDeJour(date) + 1) % 7;
}

/** Instant absolu en minutes : sert a comparer des heures d'un jour a l'autre. */
export function instant(date, minutes) {
  return numeroDeJour(date) * 1440 + minutes;
}

/** 'HH:MM' -> minutes depuis minuit. */
export function enMinutes(texte) {
  return +texte.slice(0, 2) * 60 + +texte.slice(3, 5);
}

export function enHeure(minutes) {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return String(Math.floor(m / 60)).padStart(2, '0') + ':'
    + String(m % 60).padStart(2, '0');
}

/**
 * Instant d'un depart exprime dans la grille du jour de service : une heure
 * inferieure a 03:00 appartient au lendemain civil.
 */
export function instantDeDepart(jourDeService, heure) {
  const minutes = enMinutes(heure);
  const report = minutes < DEBUT_JOUR_SERVICE ? 1 : 0;
  return instant(decalerDate(jourDeService, report), minutes);
}

/** Jour de service actif : avant 03:00, on est encore sur la veille. */
export function jourDeServiceActuel(horloge) {
  const { date, minutes } = horloge;
  return minutes < DEBUT_JOUR_SERVICE ? decalerDate(date, -1) : date;
}

// --- Jours feries retenus par la STC -----------------------------------------

/** Dimanche de Paques (algorithme gregorien anonyme). */
function paques(annee) {
  const a = annee % 19;
  const b = Math.floor(annee / 100);
  const c = annee % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mois = Math.floor((h + l - 7 * m + 114) / 31);
  return { annee, mois, jour: ((h + l - 7 * m + 114) % 31) + 1 };
}

/** n-ieme lundi du mois (n commence a 1). */
function lundiDuMois(annee, mois, n) {
  const premier = { annee, mois, jour: 1 };
  const decalage = (8 - jourDeSemaine(premier)) % 7;
  return { annee, mois, jour: 1 + decalage + (n - 1) * 7 };
}

/** Lundi precedant le 25 mai (fete des Patriotes). */
function fetePatriotes(annee) {
  const reference = { annee, mois: 5, jour: 25 };
  const recul = (jourDeSemaine(reference) + 6) % 7 || 7;
  return decalerDate(reference, -recul);
}

/** Table {numeroDeJour: cleFerie} pour une annee donnee, mise en cache. */
const cacheFeries = new Map();

export function feriesDeLAnnee(annee) {
  if (cacheFeries.has(annee)) return cacheFeries.get(annee);
  const dimanchePaques = paques(annee);
  const table = new Map([
    [numeroDeJour({ annee, mois: 1, jour: 1 }), 'jour_de_lan'],
    [numeroDeJour({ annee, mois: 1, jour: 2 }), 'lendemain_jour_de_lan'],
    [numeroDeJour(decalerDate(dimanchePaques, -2)), 'vendredi_saint'],
    [numeroDeJour(dimanchePaques), 'paques'],
    [numeroDeJour(decalerDate(dimanchePaques, 1)), 'lundi_paques'],
    [numeroDeJour(fetePatriotes(annee)), 'patriotes'],
    [numeroDeJour({ annee, mois: 6, jour: 24 }), 'fete_nationale'],
    [numeroDeJour({ annee, mois: 7, jour: 1 }), 'fete_canada'],
    [numeroDeJour(lundiDuMois(annee, 9, 1)), 'fete_travail'],
    [numeroDeJour(lundiDuMois(annee, 10, 2)), 'action_de_grace'],
    [numeroDeJour({ annee, mois: 12, jour: 24 }), 'veille_noel'],
    [numeroDeJour({ annee, mois: 12, jour: 25 }), 'noel'],
    [numeroDeJour({ annee, mois: 12, jour: 26 }), 'lendemain_noel'],
    [numeroDeJour({ annee, mois: 12, jour: 31 }), 'veille_jour_de_lan'],
  ]);
  cacheFeries.set(annee, table);
  return table;
}

export function ferieDuJour(date, feries) {
  const cle = feriesDeLAnnee(date.annee).get(numeroDeJour(date));
  return cle ? feries.find((f) => f.cle === cle) || null : null;
}

/**
 * Profil de service d'un jour : quel horaire s'applique, et si le comptoir du
 * terminus est ouvert (ce qui conditionne les reservations de taxibus).
 */
export function profilDuJour(date, donnees) {
  const ferie = ferieDuJour(date, donnees.feries);
  const jour = jourDeSemaine(date);
  const finDeSemaine = jour === 0 || jour === 6 || Boolean(ferie);
  const service = finDeSemaine ? 'fin_de_semaine' : 'semaine';
  const heures = donnees.terminus.heures[service];
  return {
    date,
    service,
    ferie,
    terminusOuvert: ferie ? ferie.terminus_ouvert : true,
    ouverture: enMinutes(heures.ouverture),
    fermeture: enMinutes(heures.fermeture),
  };
}

export function nomDeJour(date) {
  return JOURS[jourDeSemaine(date)];
}

export function dateLongue(date) {
  return `${nomDeJour(date)} ${date.jour} ${MOIS[date.mois - 1]}`;
}
