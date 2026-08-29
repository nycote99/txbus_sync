/**
 * Le calendrier décide quel horaire s'applique et quand le terminus est
 * ouvert — donc, indirectement, jusqu'à quand une réservation reste possible.
 * Une erreur ici ne se voit pas à l'écran : elle donne simplement une mauvaise
 * heure, avec assurance.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  DEBUT_JOUR_SERVICE, dateDepuisNumero, dateLongue, decalerDate, depuisEpoch,
  enHeure, enMinutes, feriesDeLAnnee, ferieDuJour, instant, instantDeDepart,
  instantDepuisEpoch, jourDeSemaine, jourDeServiceActuel, nomDeJour,
  numeroDeJour, profilDuJour,
} from '../assets/js/calendrier.js';

import { lireHoraires } from './aide.js';

const donnees = lireHoraires();

describe('conversion des heures', () => {
  it('lit une heure du tableau en minutes depuis minuit', () => {
    assert.equal(enMinutes('00:00'), 0);
    assert.equal(enMinutes('06:00'), 360);
    assert.equal(enMinutes('20:30'), 1230);
    assert.equal(enMinutes('23:59'), 1439);
  });

  it('réécrit des minutes en heure, en repliant au-delà de la journée', () => {
    assert.equal(enHeure(0), '00:00');
    assert.equal(enHeure(1230), '20:30');
    assert.equal(enHeure(1440), '00:00');
    assert.equal(enHeure(1455), '00:15');
    assert.equal(enHeure(-15), '23:45');
  });

  it('fait l’aller-retour sur toutes les minutes d’une journée', () => {
    for (let minute = 0; minute < 1440; minute += 1) {
      assert.equal(enMinutes(enHeure(minute)), minute);
    }
  });
});

describe('numérotation des jours', () => {
  it('fait l’aller-retour sur quatre ans, changements d’année compris', () => {
    let date = { annee: 2024, mois: 1, jour: 1 };
    for (let pas = 0; pas < 1461; pas += 1) {
      assert.deepEqual(dateDepuisNumero(numeroDeJour(date)), date);
      date = decalerDate(date, 1);
    }
  });

  it('nomme correctement le jour de la semaine', () => {
    assert.equal(nomDeJour({ annee: 2026, mois: 8, jour: 29 }), 'samedi');
    assert.equal(nomDeJour({ annee: 2026, mois: 9, jour: 1 }), 'mardi');
    assert.equal(jourDeSemaine({ annee: 2026, mois: 8, jour: 30 }), 0);
  });

  it('traverse le 29 février d’une année bissextile', () => {
    const veille = { annee: 2028, mois: 2, jour: 28 };
    assert.deepEqual(decalerDate(veille, 1), { annee: 2028, mois: 2, jour: 29 });
    assert.deepEqual(decalerDate(veille, 2), { annee: 2028, mois: 3, jour: 1 });
  });

  it('écrit une date longue en français', () => {
    assert.equal(dateLongue({ annee: 2026, mois: 9, jour: 1 }), 'mardi 1 septembre');
  });
});

describe('jours fériés retenus par la STC', () => {
  const cle = (annee, mois, jour) =>
    feriesDeLAnnee(annee).get(numeroDeJour({ annee, mois, jour }));

  it('place Pâques sur quatre années de référence', () => {
    assert.equal(cle(2024, 3, 31), 'paques');
    assert.equal(cle(2025, 4, 20), 'paques');
    assert.equal(cle(2026, 4, 5), 'paques');
    assert.equal(cle(2027, 3, 28), 'paques');
  });

  it('accroche le Vendredi saint et le lundi de Pâques à la bonne Pâques', () => {
    assert.equal(cle(2026, 4, 3), 'vendredi_saint');
    assert.equal(cle(2026, 4, 6), 'lundi_paques');
  });

  it('place les fêtes mobiles', () => {
    assert.equal(cle(2026, 5, 18), 'patriotes');       // lundi avant le 25 mai
    assert.equal(cle(2026, 9, 7), 'fete_travail');     // 1er lundi de septembre
    assert.equal(cle(2026, 10, 12), 'action_de_grace'); // 2e lundi d’octobre
  });

  it('place la fête des Patriotes même quand le 25 mai est un lundi', () => {
    // Le 25 mai 2026 est un lundi : la fête tombe le lundi précédent, pas ce jour-là.
    assert.equal(jourDeSemaine({ annee: 2026, mois: 5, jour: 25 }), 1);
    assert.equal(cle(2026, 5, 25), undefined);
  });

  it('place les dates fixes', () => {
    assert.equal(cle(2026, 1, 1), 'jour_de_lan');
    assert.equal(cle(2026, 1, 2), 'lendemain_jour_de_lan');
    assert.equal(cle(2026, 6, 24), 'fete_nationale');
    assert.equal(cle(2026, 7, 1), 'fete_canada');
    assert.equal(cle(2026, 12, 24), 'veille_noel');
    assert.equal(cle(2026, 12, 25), 'noel');
    assert.equal(cle(2026, 12, 26), 'lendemain_noel');
    assert.equal(cle(2026, 12, 31), 'veille_jour_de_lan');
  });

  it('en compte exactement quatorze par année, sans doublon de date', () => {
    for (const annee of [2025, 2026, 2027, 2028]) {
      const table = feriesDeLAnnee(annee);
      assert.equal(table.size, 14, `année ${annee}`);
      assert.equal(new Set(table.values()).size, 14, `année ${annee}`);
    }
  });

  it('rattache chaque clé calculée à une fiche du référentiel', () => {
    const connues = new Set(donnees.feries.map((f) => f.cle));
    for (const valeur of feriesDeLAnnee(2026).values()) {
      assert.ok(connues.has(valeur), `férié inconnu du référentiel : ${valeur}`);
    }
  });
});

describe('profil de service d’une journée', () => {
  it('applique l’horaire de semaine du lundi au vendredi', () => {
    const profil = profilDuJour({ annee: 2026, mois: 9, jour: 1 }, donnees);
    assert.equal(profil.service, 'semaine');
    assert.equal(profil.ferie, null);
    assert.equal(profil.terminusOuvert, true);
    assert.equal(enHeure(profil.ouverture), '06:00');
    assert.equal(enHeure(profil.fermeture), '20:30');
  });

  it('applique l’horaire de fin de semaine le samedi et le dimanche', () => {
    for (const jour of [29, 30]) {
      const profil = profilDuJour({ annee: 2026, mois: 8, jour }, donnees);
      assert.equal(profil.service, 'fin_de_semaine');
      assert.equal(enHeure(profil.ouverture), '08:15');
      assert.equal(enHeure(profil.fermeture), '16:45');
    }
  });

  it('bascule un jour férié de semaine sur l’horaire de fin de semaine', () => {
    // La fête du Travail 2026 tombe un lundi.
    const profil = profilDuJour({ annee: 2026, mois: 9, jour: 7 }, donnees);
    assert.equal(jourDeSemaine({ annee: 2026, mois: 9, jour: 7 }), 1);
    assert.equal(profil.service, 'fin_de_semaine');
    assert.equal(profil.ferie.cle, 'fete_travail');
    assert.equal(profil.terminusOuvert, true);
  });

  it('ferme le terminus les quatre jours prévus', () => {
    const fermes = [[1, 1], [4, 5], [6, 24], [12, 25]];
    for (const [mois, jour] of fermes) {
      const profil = profilDuJour({ annee: 2026, mois, jour }, donnees);
      assert.equal(profil.terminusOuvert, false,
        `le terminus devrait être fermé le ${jour}/${mois}`);
    }
    assert.equal(
      donnees.feries.filter((f) => !f.terminus_ouvert).length, 4);
  });

  it('garde le terminus ouvert les autres jours fériés', () => {
    const profil = profilDuJour({ annee: 2026, mois: 12, jour: 24 }, donnees);
    assert.equal(profil.ferie.cle, 'veille_noel');
    assert.equal(profil.terminusOuvert, true);
  });

  it('retrouve la fiche du férié depuis le référentiel', () => {
    const ferie = ferieDuJour({ annee: 2026, mois: 6, jour: 24 }, donnees.feries);
    assert.equal(ferie.nom, 'Fête nationale');
    assert.equal(ferie.terminus_ouvert, false);
    assert.equal(ferieDuJour({ annee: 2026, mois: 6, jour: 25 }, donnees.feries), null);
  });
});

describe('journée de service', () => {
  const mardi = { annee: 2026, mois: 9, jour: 1 };

  it('commence à 3 h du matin', () => {
    assert.equal(DEBUT_JOUR_SERVICE, 180);
  });

  it('rattache une heure d’avant 3 h à la veille', () => {
    assert.deepEqual(
      jourDeServiceActuel({ date: mardi, minutes: enMinutes('01:45') }),
      { annee: 2026, mois: 8, jour: 31 });
  });

  it('rattache une heure d’après 3 h au jour même', () => {
    assert.deepEqual(
      jourDeServiceActuel({ date: mardi, minutes: enMinutes('03:00') }), mardi);
    assert.deepEqual(
      jourDeServiceActuel({ date: mardi, minutes: enMinutes('23:59') }), mardi);
  });

  it('reporte au lendemain civil un départ d’après minuit', () => {
    const minuitQuarante = instantDeDepart(mardi, '00:45');
    assert.equal(minuitQuarante,
      instant({ annee: 2026, mois: 9, jour: 2 }, enMinutes('00:45')));
  });

  it('ordonne correctement le premier et le dernier départ d’une journée', () => {
    const premier = instantDeDepart(mardi, '03:55');
    const dernier = instantDeDepart(mardi, '01:45');
    assert.ok(premier < dernier);
    assert.equal(dernier - premier, 21 * 60 + 50);
  });
});

describe('lecture du temps absolu du flux', () => {
  it('ramène un horodatage epoch à l’heure murale de Sorel-Tracy', () => {
    // Fin août, l’Est est à UTC−4 : 12:34 UTC vaut 08:34 à Sorel-Tracy.
    const { date, minutes } = depuisEpoch(Date.UTC(2026, 7, 29, 12, 34) / 1000);
    assert.deepEqual(date, { annee: 2026, mois: 8, jour: 29 });
    assert.equal(enHeure(minutes), '08:34');
  });

  it('recule d’un jour civil quand l’heure UTC a déjà basculé', () => {
    // 2026-09-02T02:15Z est encore le 1er septembre, 22:15, à Sorel-Tracy.
    const { date, minutes } = depuisEpoch(Date.UTC(2026, 8, 2, 2, 15) / 1000);
    assert.deepEqual(date, { annee: 2026, mois: 9, jour: 1 });
    assert.equal(enHeure(minutes), '22:15');
  });

  it('tient compte du passage à l’heure normale', () => {
    // 2026-12-15T12:38:00Z : l’heure normale de l’Est est UTC−5.
    const hiver = depuisEpoch(Date.UTC(2026, 11, 15, 12, 38) / 1000);
    assert.equal(enHeure(hiver.minutes), '07:38');
    // 2026-07-15T12:38:00Z : l’heure avancée est UTC−4.
    const ete = depuisEpoch(Date.UTC(2026, 6, 15, 12, 38) / 1000);
    assert.equal(enHeure(ete.minutes), '08:38');
  });

  it('place l’horodatage sur la même échelle que l’horaire publié', () => {
    const secondes = Date.UTC(2026, 8, 1, 23, 3) / 1000; // 19:03 heure locale
    assert.equal(instantDepuisEpoch(secondes),
      instant({ annee: 2026, mois: 9, jour: 1 }, enMinutes('19:03')));
  });
});
