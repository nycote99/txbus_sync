/**
 * Point d'entree : chargement des donnees, routage entre les vues et horloge.
 *
 * L'application est entierement statique. Elle ne connait ni serveur ni compte
 * utilisateur : toute l'intelligence vient des horaires officiels embarques et
 * de l'heure courante a Sorel-Tracy.
 */

import { h, vider } from './dom.js';
import {
  dateLongue, enHeure, jourDeServiceActuel, maintenant, profilDuJour,
} from './calendrier.js';
import { preferences, definir } from './preferences.js';
import { vueMaintenant } from './vues/maintenant.js';
import { vueAutobus } from './vues/autobus.js';
import { vueTaxibus } from './vues/taxibus.js';
import { vueInfos } from './vues/infos.js';

const VUES = {
  maintenant: { titre: 'Maintenant', rendre: vueMaintenant },
  autobus: { titre: 'Autobus', rendre: vueAutobus },
  taxibus: { titre: 'Taxibus', rendre: vueTaxibus },
  infos: { titre: 'Infos', rendre: vueInfos },
};

const conteneur = document.getElementById('vue');
const elementHorloge = document.getElementById('horloge');
const elementEtatDuJour = document.getElementById('etat-du-jour');

let donnees = null;
let vueActive = 'maintenant';
let etatVue = {};

async function demarrer() {
  appliquerTheme(preferences().theme);
  brancherNavigation();
  brancherTheme();

  try {
    const reponse = await fetch(`data/horaires.json?v=${document.documentElement.dataset.version || ''}`);
    if (!reponse.ok) throw new Error(`HTTP ${reponse.status}`);
    donnees = await reponse.json();
  } catch (erreur) {
    vider(conteneur).append(h('div.bandeau.bandeau--arret',
      h('div', h('strong', 'Horaires indisponibles'),
        h('span', 'Impossible de charger les données. Vérifiez votre connexion '
          + 'puis rechargez la page.'))));
    return;
  }

  document.getElementById('version-donnees').textContent =
    `Horaires en vigueur depuis le ${donnees.version_horaire}.`;

  vueActive = VUES[lireAncre()] ? lireAncre() : preferences().vue;
  if (!VUES[vueActive]) vueActive = 'maintenant';

  window.addEventListener('hashchange', () => {
    const cible = lireAncre();
    if (VUES[cible] && cible !== vueActive) aller(cible);
  });

  dessiner();
  setInterval(dessiner, 30000);
  setInterval(majHorloge, 1000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) dessiner();
  });
  enregistrerServiceWorker();
}

function contexte() {
  const horloge = maintenant();
  const jourDeService = jourDeServiceActuel(horloge);
  return {
    donnees,
    horloge,
    jourDeService,
    profil: profilDuJour(jourDeService, donnees),
    etatVue,
    aller,
    rafraichir: (modifications) => {
      if (modifications) etatVue = { ...etatVue, ...modifications };
      dessiner();
    },
  };
}

function dessiner() {
  if (!donnees) return;
  const ctx = contexte();
  majHorloge(ctx.horloge);
  majEtatDuJour(ctx);

  const positionDefilement = window.scrollY;
  vider(conteneur).append(VUES[vueActive].rendre(ctx));
  window.scrollTo({ top: positionDefilement });

  document.querySelectorAll('.nav__lien').forEach((bouton) => {
    const actif = bouton.dataset.vue === vueActive;
    if (actif) bouton.setAttribute('aria-current', 'page');
    else bouton.removeAttribute('aria-current');
  });
  document.title = `${VUES[vueActive].titre} — Sorel Transit`;
}

function aller(vue, modifications) {
  if (!VUES[vue]) return;
  vueActive = vue;
  etatVue = modifications ? { ...etatVue, ...modifications } : {};
  definir({ vue });
  if (lireAncre() !== vue) window.location.hash = vue;
  dessiner();
  document.getElementById('contenu').focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function lireAncre() {
  return window.location.hash.replace('#', '');
}

function brancherNavigation() {
  document.querySelectorAll('.nav__lien').forEach((bouton) => {
    bouton.addEventListener('click', () => aller(bouton.dataset.vue));
  });
}

function majHorloge(horloge = maintenant()) {
  elementHorloge.textContent = enHeure(horloge.minutes);
}

function majEtatDuJour({ jourDeService, profil }) {
  const service = profil.service === 'semaine' ? 'horaire de semaine'
    : 'horaire de fin de semaine';
  elementEtatDuJour.textContent =
    `${dateLongue(jourDeService)} · ${profil.ferie ? profil.ferie.nom : service}`;
}

// --- Theme -------------------------------------------------------------------

const CYCLE_THEME = { auto: 'clair', clair: 'sombre', sombre: 'auto' };

function brancherTheme() {
  document.getElementById('bascule-theme').addEventListener('click', () => {
    const suivant = CYCLE_THEME[preferences().theme] || 'auto';
    definir({ theme: suivant });
    appliquerTheme(suivant);
  });
}

function appliquerTheme(theme) {
  const racine = document.documentElement;
  if (theme === 'auto') racine.removeAttribute('data-theme');
  else racine.dataset.theme = theme;
  const bouton = document.getElementById('bascule-theme');
  const libelles = { auto: 'Thème automatique', clair: 'Thème clair',
                     sombre: 'Thème sombre' };
  bouton.textContent = { auto: '◐', clair: '☀', sombre: '☾' }[theme] || '◐';
  bouton.setAttribute('aria-label', libelles[theme]);
  bouton.title = libelles[theme];
}

function enregistrerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol !== 'https:' && location.hostname !== 'localhost') return;
  navigator.serviceWorker.register('service-worker.js').catch(() => {
    /* le hors-ligne est un bonus : son echec ne doit pas gener l'application */
  });
}

demarrer();
