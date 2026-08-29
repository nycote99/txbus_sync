/**
 * Un fichier .ics mal formé n'affiche pas d'erreur : le calendrier l'ignore,
 * et l'usager croit avoir posé un rappel qui n'existe pas. D'où ces
 * vérifications sur la structure, le repliement des lignes et l'heure.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { construireRappel, rappelDuRetour } from '../assets/js/rappel.js';
import { enMinutes, instant, profilDuJour } from '../assets/js/calendrier.js';
import { retoursAvecTaxibus } from '../assets/js/reseau.js';

import { MARDI, lireHoraires } from './aide.js';

const donnees = lireHoraires();

/** Découpe un .ics en lignes logiques, en défaisant le repliement. */
function lignesLogiques(ics) {
  return ics.split('\r\n').reduce((lignes, ligne) => {
    if (ligne.startsWith(' ')) lignes[lignes.length - 1] += ligne.slice(1);
    else if (ligne !== '') lignes.push(ligne);
    return lignes;
  }, []);
}

const rappelSimple = () => construireRappel({
  limiteInstant: instant(MARDI, enMinutes('20:30')),
  titre: 'Réserver le taxibus de 22:15',
  description: 'Heure limite : 20:30.',
  url: 'https://stc.accestaxi.com/',
  identifiant: 'essai@sorel-transit',
});

describe('structure du fichier calendrier', () => {
  it('ouvre et referme chaque bloc', () => {
    const lignes = lignesLogiques(rappelSimple());
    assert.equal(lignes[0], 'BEGIN:VCALENDAR');
    assert.equal(lignes[lignes.length - 1], 'END:VCALENDAR');
    for (const bloc of ['VEVENT', 'VALARM']) {
      assert.equal(lignes.filter((l) => l === `BEGIN:${bloc}`).length, 1);
      assert.equal(lignes.filter((l) => l === `END:${bloc}`).length, 1);
      assert.ok(lignes.indexOf(`BEGIN:${bloc}`) < lignes.indexOf(`END:${bloc}`));
    }
  });

  it('sépare les lignes par un retour chariot, comme l’exige le format', () => {
    const ics = rappelSimple();
    assert.ok(ics.endsWith('\r\n'));
    assert.equal(ics.split('\n').length - 1, ics.split('\r\n').length - 1);
  });

  it('porte les champs obligatoires', () => {
    const lignes = lignesLogiques(rappelSimple());
    for (const cle of ['VERSION:2.0', 'PRODID:', 'UID:', 'DTSTAMP:', 'DTSTART:']) {
      assert.ok(lignes.some((l) => l.startsWith(cle)), `${cle} manquant`);
    }
  });

  it('déclenche l’alarme avant l’heure limite, jamais après', () => {
    const lignes = lignesLogiques(rappelSimple());
    const declencheur = lignes.find((l) => l.startsWith('TRIGGER:'));
    assert.match(declencheur, /^TRIGGER:-PT\d+M$/);
  });
});

describe('heure du rappel', () => {
  it('place le début à l’heure limite, convertie en UTC', () => {
    const lignes = lignesLogiques(rappelSimple());
    const debut = lignes.find((l) => l.startsWith('DTSTART:'));
    // Le 1er septembre 2026 à 20:30 heure de l’Est vaut 00:30 UTC le 2.
    assert.equal(debut, 'DTSTART:20260902T003000Z');
  });

  it('suit le changement d’heure', () => {
    const hiver = construireRappel({
      limiteInstant: instant({ annee: 2026, mois: 12, jour: 15 }, enMinutes('16:45')),
      titre: 'x', description: 'y', identifiant: 'z@essai',
    });
    const debut = lignesLogiques(hiver).find((l) => l.startsWith('DTSTART:'));
    assert.equal(debut, 'DTSTART:20261215T214500Z');
  });

  it('gère une limite qui tombe après minuit', () => {
    const apresMinuit = construireRappel({
      limiteInstant: instant({ annee: 2026, mois: 9, jour: 2 }, enMinutes('00:45')),
      titre: 'x', description: 'y', identifiant: 'z@essai',
    });
    const debut = lignesLogiques(apresMinuit).find((l) => l.startsWith('DTSTART:'));
    assert.equal(debut, 'DTSTART:20260902T044500Z');
  });
});

describe('échappement et repliement', () => {
  it('replie les lignes trop longues et les rend relisibles', () => {
    const long = 'Réserver le taxibus vers Saint-Gérard-Majella depuis le '
      + 'Terminus des Promenades - STC, avant la fermeture du comptoir';
    const ics = construireRappel({
      limiteInstant: instant(MARDI, enMinutes('20:30')),
      titre: long, description: 'court', identifiant: 'x@essai',
    });
    for (const ligne of ics.split('\r\n')) {
      assert.ok(new TextEncoder().encode(ligne).length <= 75,
        `ligne trop longue : ${ligne.length} caractères`);
    }
    // Le format échappe la virgule : c'est cette forme qu'on doit retrouver.
    assert.ok(lignesLogiques(ics).includes(`SUMMARY:${long.replace(',', '\\,')}`));
  });

  it('échappe les caractères réservés du format', () => {
    const ics = construireRappel({
      limiteInstant: instant(MARDI, enMinutes('20:30')),
      titre: 'a,b;c',
      description: 'ligne un\nligne deux',
      identifiant: 'x@essai',
    });
    const lignes = lignesLogiques(ics);
    assert.ok(lignes.includes('SUMMARY:a\\,b\;c'));
    assert.ok(lignes.some((l) => l === 'DESCRIPTION:ligne un\\nligne deux'));
  });

  it('ne coupe pas un caractère accentué en deux', () => {
    const ics = construireRappel({
      limiteInstant: instant(MARDI, enMinutes('20:30')),
      titre: 'é'.repeat(80), description: 'x', identifiant: 'y@essai',
    });
    assert.ok(lignesLogiques(ics).includes(`SUMMARY:${'é'.repeat(80)}`));
  });
});

describe('rappel bâti depuis un retour', () => {
  const [retourTardif] = retoursAvecTaxibus(donnees, {
    embarquement: 'Terminus Longueuil (porte A7)',
    descente: 'Terminus des Promenades - STC',
    zoneDestination: '4-A',
    jourDeService: MARDI,
    maintenant: instant(MARDI, enMinutes('04:00')),
    aPartirDe: instant(MARDI, enMinutes('22:00')),
    limite: 1,
  });

  it('vise l’heure limite du taxibus, pas l’heure du départ', () => {
    const description = rappelDuRetour(retourTardif, donnees);
    assert.equal(description.limiteInstant, retourTardif.taxibus.limite);
  });

  it('nomme le taxibus concerné dans le titre', () => {
    const description = rappelDuRetour(retourTardif, donnees);
    assert.equal(description.titre, `Réserver le taxibus de ${retourTardif.taxibus.heure}`);
  });

  it('explique dans quel moment du trajet il faut agir', () => {
    const description = rappelDuRetour(retourTardif, donnees);
    assert.equal(retourTardif.verdict.code, 'avant_embarquement');
    assert.match(description.description, /avant de monter dans l’express/);
    assert.match(description.description, /fermeture du Terminus/);
    assert.match(description.description, /Destination : Contrecœur/);
  });

  it('produit un identifiant stable pour le même départ', () => {
    assert.equal(rappelDuRetour(retourTardif, donnees).identifiant,
      rappelDuRetour(retourTardif, donnees).identifiant);
  });

  it('se laisse transformer en fichier valide', () => {
    const ics = construireRappel(rappelDuRetour(retourTardif, donnees));
    const lignes = lignesLogiques(ics);
    assert.equal(lignes[0], 'BEGIN:VCALENDAR');
    assert.ok(lignes.some((l) => l.startsWith('DTSTART:')));
    assert.ok(lignes.some((l) => l.includes('accestaxi')));
  });
});
