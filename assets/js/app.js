/**
 * Point d'entree : chargement des donnees, routage entre les vues et horloge.
 *
 * L'application est entierement statique. Elle ne connait ni serveur ni compte
 * utilisateur : toute l'intelligence vient des horaires officiels embarques et
 * de l'heure courante a Sorel-Tracy.
 */

import { h, vider } from './dom.js';
import {
  dateLongue, depuisISO, enHeure, enISO, jourDeServiceActuel, maintenant,
  numeroDeJour, profilDuJour,
} from './calendrier.js';
import { DELAI_RAFRAICHISSEMENT, chargerTempsReel } from './tempsreel.js';
import { preferences, definir } from './preferences.js';
import { vueMaintenant } from './vues/maintenant.js';
import { vueRetour } from './vues/retour.js';
import { vueAutobus } from './vues/autobus.js';
import { vueTaxibus } from './vues/taxibus.js';
import { vueInfos } from './vues/infos.js';

const VUES = {
  maintenant: { titre: 'Maintenant', rendre: vueMaintenant },
  retour: { titre: 'Mon retour', rendre: vueRetour },
  autobus: { titre: 'Autobus', rendre: vueAutobus },
  taxibus: { titre: 'Taxibus', rendre: vueTaxibus },
  infos: { titre: 'Infos', rendre: vueInfos },
};

const conteneur = document.getElementById('vue');
const elementHorloge = document.getElementById('horloge');
const elementEtatDuJour = document.getElementById('etat-du-jour');

let donnees = null;
let reference = null;
let tempsReel = null;
let vueActive = 'maintenant';
let etatVue = {};

async function demarrer() {
  appliquerTheme(preferences().theme);
  brancherNavigation();
  brancherTheme();

  try {
    const [horaires, reseau] = await Promise.all([
      charger('data/horaires.json'),
      // La table GTFS ne sert qu'a nommer ce que dit le flux temps reel :
      // son absence degrade l'application, elle ne l'empeche pas de servir.
      charger('data/reseau-gtfs.json').catch(() => null),
    ]);
    donnees = horaires;
    reference = reseau;
  } catch (erreur) {
    vider(conteneur).append(h('div.bandeau.bandeau--arret',
      h('div', h('strong', 'Horaires indisponibles'),
        h('span', 'Impossible de charger les données. Vérifiez votre connexion '
          + 'puis rechargez la page.'))));
    return;
  }

  document.getElementById('version-donnees').textContent =
    `Horaires en vigueur depuis le ${donnees.version_horaire}.`;

  const ancre = lireAncre();
  vueActive = VUES[ancre.vue] ? ancre.vue : preferences().vue;
  if (!VUES[vueActive]) vueActive = 'maintenant';
  etatVue = ancre.etat;

  window.addEventListener('hashchange', () => {
    const cible = lireAncre();
    if (!VUES[cible.vue]) return;
    vueActive = cible.vue;
    etatVue = cible.etat;
    dessiner();
  });

  dessiner();
  rafraichirTempsReel();
  setInterval(dessiner, 30000);
  setInterval(rafraichirTempsReel, DELAI_RAFRAICHISSEMENT);
  setInterval(majHorloge, 1000);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    dessiner();
    rafraichirTempsReel();
  });
  enregistrerServiceWorker();
}

async function charger(chemin) {
  const reponse = await fetch(chemin);
  if (!reponse.ok) throw new Error(`HTTP ${reponse.status} sur ${chemin}`);
  return reponse.json();
}

/**
 * Rafraichit les positions reelles. Le flux ne decrit que la journee en cours :
 * inutile de l'interroger quand l'ecran est en arriere-plan.
 */
async function rafraichirTempsReel() {
  if (!reference || document.hidden) return;
  const etat = await chargerTempsReel(reference);
  const changement = resume(etat) !== resume(tempsReel);
  const avant = tempsReel;
  tempsReel = etat;
  if (!changement) return;
  annoncer(etat, avant);
  dessiner();
}

/**
 * Ce que le flux vient de changer, dit une fois, a voix basse.
 *
 * On n'annonce pas les comptes a rebours : les faire relire toutes les trente
 * secondes rendrait l'application inecoutable. On annonce l'apparition et la
 * perte du suivi en direct — le moment ou les heures affichees cessent d'etre
 * observees pour redevenir estimees — et les avis de service.
 */
function annoncer(etat, avant) {
  const region = document.getElementById('annonces');
  if (!region) return;

  if (!etat) {
    region.textContent = avant
      ? 'Suivi en direct interrompu : les heures affichées redeviennent '
        + 'estimées d’après l’horaire.' : '';
    return;
  }
  const nouveaux = etat.alertes.filter((alerte) => !(avant && avant.alertes
    .some((connue) => connue.titre === alerte.titre)));
  if (nouveaux.length) {
    region.textContent = `Avis de la STC : ${nouveaux[0].titre}`;
    return;
  }
  if (!avant) {
    region.textContent = `Suivi en direct actif : ${etat.vehicules.length} `
      + `véhicule${etat.vehicules.length > 1 ? 's' : ''} en circulation.`;
    return;
  }
  region.textContent = '';
}

function resume(etat) {
  if (!etat) return 'aucun';
  return `${etat.horodatage}:${etat.vehicules.length}:${etat.alertes.length}`;
}

function contexte() {
  const horloge = maintenant();
  const jourDeService = jourDeServiceActuel(horloge);
  const jourChoisi = depuisISO(etatVue.jour);
  const jourAffiche = jourChoisi || jourDeService;
  const estAujourdHui = numeroDeJour(jourAffiche) === numeroDeJour(jourDeService);

  return {
    donnees,
    reference,
    estAujourdHui,
    // Le flux ne decrit que les vehicules du moment : on ne le presente pas
    // comme la verite d'une journee qu'on ne vit pas.
    tempsReel: estAujourdHui ? tempsReel : null,
    horloge,
    jourDeService: jourAffiche,
    profil: profilDuJour(jourAffiche, donnees),
    etatVue,
    aller,
    rafraichir: (modifications) => {
      if (modifications) etatVue = { ...etatVue, ...modifications };
      dessiner();
    },
    partager: () => `${window.location.origin}${window.location.pathname}`
      + `${window.location.hash}`,
  };
}

function dessiner() {
  if (!donnees) return;
  const ctx = contexte();
  majHorloge(ctx.horloge);
  majEtatDuJour(ctx);

  // La vue est reconstruite entiere a chaque rendu — toutes les trente
  // secondes, et a chaque arrivee du flux temps reel. Sans ce report, le focus
  // retombe sur le document : au clavier ou au lecteur d'ecran, on se retrouve
  // renvoye en haut de page toutes les trente secondes.
  const focusAvant = conteneur.contains(document.activeElement)
    ? document.activeElement.dataset.focus : null;

  const positionDefilement = window.scrollY;
  vider(conteneur).append(VUES[vueActive].rendre(ctx));
  window.scrollTo({ top: positionDefilement });

  if (focusAvant) {
    const cible = conteneur
      .querySelector(`[data-focus="${CSS.escape(focusAvant)}"]`);
    if (cible) cible.focus({ preventScroll: true });
  }
  ecrireAncre(vueActive, etatVue);

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
  dessiner();
  document.getElementById('contenu').focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/**
 * L'adresse porte la vue et l'etat qui la definit, pour qu'un ecran soit
 * citable : « mon retour de jeudi » s'envoie par message.
 */
const CLES_PARTAGEABLES = ['jour', 'embarquement', 'descente', 'zoneDestination',
                           'ligne', 'arret', 'direction', 'voyage'];

function lireAncre() {
  const brut = window.location.hash.replace(/^#/, '');
  const separation = brut.indexOf('?');
  if (separation === -1) return { vue: brut, etat: {} };

  const parametres = new URLSearchParams(brut.slice(separation + 1));
  const etat = {};
  CLES_PARTAGEABLES.forEach((cle) => {
    if (!parametres.has(cle)) return;
    const valeur = parametres.get(cle);
    etat[cle] = cle === 'voyage' ? Number(valeur) : valeur;
  });
  return { vue: brut.slice(0, separation), etat };
}

function ecrireAncre(vue, etat) {
  const parametres = new URLSearchParams();
  CLES_PARTAGEABLES.forEach((cle) => {
    const valeur = etat[cle];
    if (valeur !== undefined && valeur !== null && valeur !== '') {
      parametres.set(cle, String(valeur));
    }
  });
  const suite = parametres.toString();
  const ancre = `#${vue}${suite ? `?${suite}` : ''}`;
  if (window.location.hash !== ancre) {
    window.history.replaceState(null, '', ancre);
  }
}

function brancherNavigation() {
  document.querySelectorAll('.nav__lien').forEach((bouton) => {
    bouton.addEventListener('click', () => aller(bouton.dataset.vue));
  });
}

function majHorloge(horloge = maintenant()) {
  elementHorloge.textContent = enHeure(horloge.minutes);
}

function majEtatDuJour({ jourDeService, profil, estAujourdHui }) {
  const service = profil.service === 'semaine' ? 'horaire de semaine'
    : 'horaire de fin de semaine';
  elementEtatDuJour.textContent = `${dateLongue(jourDeService)}`
    + `${estAujourdHui ? '' : ' (autre jour)'} · `
    + `${profil.ferie ? profil.ferie.nom : service}`;
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

  // Une seule recharge, meme si l'evenement se repete : sans ce garde-fou,
  // deux onglets ouverts peuvent se relancer l'un l'autre sans fin.
  let recharge = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (recharge) return;
    recharge = true;
    window.location.reload();
  });

  navigator.serviceWorker.register('service-worker.js').then((inscription) => {
    if (inscription.waiting && navigator.serviceWorker.controller) {
      annoncerVersion(inscription.waiting);
    }
    inscription.addEventListener('updatefound', () => {
      const arrivant = inscription.installing;
      if (!arrivant) return;
      arrivant.addEventListener('statechange', () => {
        // `controller` distingue la mise a jour de la toute premiere
        // installation, qui n'a rien a annoncer.
        if (arrivant.state === 'installed' && navigator.serviceWorker.controller) {
          annoncerVersion(arrivant);
        }
      });
    });
  }).catch(() => {
    /* le hors-ligne est un bonus : son echec ne doit pas gener l'application */
  });
}

/**
 * Bandeau de nouvelle version.
 *
 * L'application se recharge en une fraction de seconde, mais pas n'importe
 * quand : on peut etre en train de lire l'heure limite d'une reservation. Le
 * bandeau attend donc un geste, et se referme si on prefere finir d'abord.
 */
function annoncerVersion(travailleur) {
  if (document.getElementById('bandeau-version')) return;
  const bandeau = h('div.bandeau.bandeau--info.bandeau--flottant',
    { id: 'bandeau-version', role: 'status', 'aria-live': 'polite' },
    h('div',
      h('strong', 'Nouvelle version disponible'),
      h('span', 'Les horaires embarqués ont peut-être changé.')),
    h('div.bandeau__actions',
      h('button.bouton.bouton--principal', {
        type: 'button',
        onclick: () => travailleur.postMessage({ type: 'ACTIVER' }),
      }, 'Actualiser'),
      h('button.bouton-icone', {
        type: 'button',
        'aria-label': 'Plus tard',
        onclick: () => bandeau.remove(),
      }, '✕')));
  document.body.append(bandeau);
}

demarrer();
