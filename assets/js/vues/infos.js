/** Vue informations : tarifs, contacts, calendrier des jours feries, sources. */

import { h } from '../dom.js';
import { dateLongue, dateDepuisNumero, feriesDeLAnnee, numeroDeJour } from '../calendrier.js';
import { carte } from './communs.js';

export function vueInfos(contexte) {
  const { donnees, jourDeService } = contexte;

  return h('div.pile',
    carte('Nous joindre', h('dl.liste-definitions',
      definition('Terminus', donnees.terminus.adresse),
      definition('Téléphone', lien(`tel:${donnees.terminus.telephone.replace(/\s/g, '')}`,
        donnees.terminus.telephone)),
      definition('Sans frais', lien(`tel:${donnees.terminus.sans_frais.replace(/\s/g, '')}`,
        donnees.terminus.sans_frais)),
      definition('Courriel', lien(`mailto:${donnees.terminus.courriel}`,
        donnees.terminus.courriel)),
      definition('Heures — semaine',
        `${donnees.terminus.heures.semaine.ouverture} à `
        + `${donnees.terminus.heures.semaine.fermeture}`),
      definition('Heures — fin de semaine',
        `${donnees.terminus.heures.fin_de_semaine.ouverture} à `
        + `${donnees.terminus.heures.fin_de_semaine.fermeture}`))),

    carte('Services en ligne', h('div.pile.pile--serre',
      boutonLien(donnees.liens.reservation, 'Réserver un taxibus', true),
      boutonLien(donnees.liens.inscription, 'Obtenir une carte d’accès'),
      boutonLien(donnees.liens.suivi, 'Suivi des véhicules en direct'),
      boutonLien(donnees.liens.boutique, 'Boutique en ligne'),
      boutonLien(donnees.liens.transport_adapte, 'Transport adapté'),
      boutonLien(donnees.liens.reglements, 'Règlements en vigueur'))),

    carte('Tarifs 2026', h('div.pile.pile--serre',
      h('p.note', donnees.tarifs.ligne10_gratuite),
      h('div.defilant', h('table.horaire',
        h('thead', h('tr',
          h('th', { scope: 'col' }, 'Titre'),
          h('th', { scope: 'col' }, 'Régulier'),
          h('th', { scope: 'col' }, 'Réduit'))),
        h('tbody', donnees.tarifs.titres.map((titre) => h('tr',
          h('th', { scope: 'row' }, titre.nom),
          h('td', prix(titre.regulier)),
          h('td', prix(titre.reduit))))))),
      h('p.note', donnees.tarifs.note))),

    carte('Pénalité pour absence', h('div.pile.pile--serre',
      h('p.note', 'Une réservation de taxibus non annulée au moins '
        + `${donnees.regles.annulation_minutes_avant} minutes avant le départ `
        + 'est facturée selon la zone d’origine.'),
      h('dl.liste-definitions', donnees.tarifs.penalites_absence.map((p) =>
        definition(p.zones, `${prix(p.regulier)} · réduit ${prix(p.reduit)}`))))),

    carte('Zones du taxibus', h('dl.liste-definitions',
      donnees.zones.map((zone) => definition(zone.nom,
        zone.municipalites.join(', '))))),

    carte('Jours fériés à horaire de fin de semaine',
      h('div.pile.pile--serre',
        h('dl.liste-definitions', prochainsFeries(donnees, jourDeService)
          .map(({ date, ferie }) => definition(dateLongue(date),
            `${ferie.nom} · terminus `
            + (ferie.terminus_ouvert ? 'ouvert' : 'fermé')))),
        h('p.note', 'Ces journées suivent l’horaire de fin de semaine sur tous '
          + 'les circuits.'))),

    carte('Provenance des données', h('div.pile.pile--serre',
      h('p.note', `Horaires en vigueur depuis le ${donnees.version_horaire}, `
        + 'extraits automatiquement des fiches PDF publiées par la STC.'),
      h('dl.liste-definitions', Object.entries(donnees.sources).map(([nom, url]) =>
        definition(nom, lien(url, 'fiche PDF')))))));
}

function prochainsFeries(donnees, depuis, nombre = 6) {
  const resultat = [];
  const debut = numeroDeJour(depuis);
  for (let annee = depuis.annee; annee <= depuis.annee + 1; annee += 1) {
    feriesDeLAnnee(annee).forEach((cle, numero) => {
      if (numero < debut) return;
      const ferie = donnees.feries.find((f) => f.cle === cle);
      if (ferie) resultat.push({ numero, date: dateDepuisNumero(numero), ferie });
    });
  }
  return resultat.sort((a, b) => a.numero - b.numero).slice(0, nombre);
}

function definition(terme, valeur) {
  return h('div', h('dt', terme), h('dd', valeur));
}

function lien(url, texte) {
  return h('a', { href: url, target: '_blank', rel: 'noopener' }, texte);
}

function boutonLien(url, texte, principal) {
  return h(`a.bouton.bouton--pleine${principal ? '.bouton--principal' : ''}`,
    { href: url, target: '_blank', rel: 'noopener' }, texte);
}

function prix(valeur) {
  return `${valeur.toFixed(2).replace('.', ',')} $`;
}
