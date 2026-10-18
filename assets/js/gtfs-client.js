/**
 * Client GTFS-RT à états explicites.
 *
 * Le décodage du flux vit dans tempsreel.js ; ce module-ci possède la
 * télémétrie : interroger le flux à intervalle régulier, avec un délai
 * maximal strict, et dire à tout moment dans quel état se trouve le suivi.
 *
 * Trois modes, un seul évènement `update` :
 *   - DIRECT : le flux vient de répondre, les positions sont observées ;
 *   - DEGRADE_HORAIRE : le flux ne répond plus, mais il a déjà répondu —
 *     le dernier état connu accompagne l'évènement, à charge pour
 *     l'interface de retomber sur l'estimation horaire en le sachant ;
 *   - HORS_LIGNE : le flux n'a jamais répondu, ou l'appareil est hors
 *     ligne — il n'y a rien d'observé à montrer.
 *
 * Un évènement `modechange` signale chaque transition entre ces modes.
 * Le service ne touche jamais au DOM : l'affichage reste l'affaire des vues.
 */

import { DELAI_RAFRAICHISSEMENT, chargerTempsReel } from './tempsreel.js';

/** @typedef {'DIRECT'|'DEGRADE_HORAIRE'|'HORS_LIGNE'} ModeFlux */

/**
 * @typedef {object} DetailUpdate
 * @property {ModeFlux} mode Mode courant du suivi.
 * @property {object|null} etat Dernier état décodé du flux, ou null si le
 *   flux n'a jamais répondu.
 * @property {string|null} raison 'hors-ligne', 'flux-injoignable' ou
 *   'delai-depasse' quand le mode n'est pas DIRECT ; null sinon.
 */

export class TransitFeedService extends EventTarget {
  /**
   * @param {object} reference Table de correspondance GTFS
   *   (`data/reseau-gtfs.json`), transmise telle quelle au décodeur.
   * @param {object} [options]
   * @param {number} [options.delaiRafraichissement] Intervalle entre deux
   *   interrogations du flux, en millisecondes.
   * @param {number} [options.timeoutMs] Délai maximal d'une interrogation :
   *   passé ce délai, la requête est abandonnée et le mode bascule.
   * @param {Function} [options.charger] Décodeur du flux, injectable pour
   *   les tests. Défaut : `chargerTempsReel` de tempsreel.js.
   * @param {Function} [options.enLigne] Dit si l'appareil se croit en
   *   ligne. Défaut : `navigator.onLine`, lu à chaque interrogation.
   * @param {Function} [options.visible] Dit si l'écran est au premier plan :
   *   inutile d'interroger le flux pour un onglet caché.
   */
  constructor(reference, options = {}) {
    super();
    this.reference = reference;
    this.delaiRafraichissement = options.delaiRafraichissement ?? DELAI_RAFRAICHISSEMENT;
    this.timeoutMs = options.timeoutMs ?? 10000;
    this.charger = options.charger ?? chargerTempsReel;
    this.enLigne =
      options.enLigne ?? (() => typeof navigator === 'undefined' || navigator.onLine !== false);
    this.visible = options.visible ?? (() => true);
    /** @type {object|null} Dernier état valide du flux. */
    this.etat = null;
    /** @type {ModeFlux} */
    this.mode = 'HORS_LIGNE';
    this.minuteur = null;
    this.controleur = null;
  }

  /** Démarre le suivi : une interrogation immédiate, puis à intervalle. */
  demarrer() {
    if (this.minuteur !== null) return;
    this.rafraichir();
    this.minuteur = setInterval(() => this.rafraichir(), this.delaiRafraichissement);
  }

  /** Arrête le suivi et abandonne l'interrogation en cours, s'il y en a. */
  arreter() {
    if (this.minuteur !== null) clearInterval(this.minuteur);
    this.minuteur = null;
    if (this.controleur) this.controleur.abort();
  }

  /**
   * Interroge le flux une fois et émet l'évènement `update` correspondant.
   *
   * @returns {Promise<ModeFlux>} Le mode après cette interrogation.
   */
  async rafraichir() {
    if (!this.visible()) return this.mode;
    if (!this.enLigne()) {
      this.basculer('HORS_LIGNE', 'hors-ligne');
      return this.mode;
    }

    const controleur = new AbortController();
    this.controleur = controleur;
    let delaiDepasse = false;
    const minuteur = setTimeout(() => {
      delaiDepasse = true;
      controleur.abort();
    }, this.timeoutMs);

    let recu;
    try {
      recu = await this.charger(this.reference, controleur.signal);
    } catch {
      recu = null;
    } finally {
      clearTimeout(minuteur);
      if (this.controleur === controleur) this.controleur = null;
    }

    if (recu) {
      this.etat = recu;
      this.basculer('DIRECT', null);
    } else if (delaiDepasse) {
      this.basculer(this.etat ? 'DEGRADE_HORAIRE' : 'HORS_LIGNE', 'delai-depasse');
    } else {
      this.basculer(this.etat ? 'DEGRADE_HORAIRE' : 'HORS_LIGNE', 'flux-injoignable');
    }
    return this.mode;
  }

  /**
   * Fait passer le service dans un mode et prévient les abonnés.
   *
   * @param {ModeFlux} mode
   * @param {string|null} raison
   */
  basculer(mode, raison) {
    const precedent = this.mode;
    this.mode = mode;
    if (precedent !== mode) {
      this.dispatchEvent(
        new CustomEvent('modechange', {
          detail: { mode, precedent },
        }),
      );
    }
    this.dispatchEvent(
      new CustomEvent('update', {
        detail: { mode, etat: this.etat, raison },
      }),
    );
  }
}
