/** Fabrique d'elements : h('div.carte', {id: 'x'}, enfants...). */
export function h(selecteur, attributs, ...enfants) {
  const [balise, ...classes] = selecteur.split('.');
  const element = document.createElement(balise || 'div');
  if (classes.length) element.className = classes.join(' ');

  if (attributs && (Array.isArray(attributs) || attributs instanceof Node
      || typeof attributs !== 'object')) {
    enfants.unshift(attributs);
  } else if (attributs) {
    Object.entries(attributs).forEach(([cle, valeur]) => {
      if (valeur === null || valeur === undefined || valeur === false) return;
      if (cle === 'dataset') Object.assign(element.dataset, valeur);
      else if (cle.startsWith('on')) element.addEventListener(cle.slice(2), valeur);
      else if (cle === 'html') element.innerHTML = valeur;
      else element.setAttribute(cle, valeur === true ? '' : String(valeur));
    });
  }

  enfants.flat(Infinity).forEach((enfant) => {
    if (enfant === null || enfant === undefined || enfant === false) return;
    element.append(enfant instanceof Node ? enfant : document.createTextNode(String(enfant)));
  });
  return element;
}

export function vider(element) {
  while (element.firstChild) element.firstChild.remove();
  return element;
}

export function champSelect(etiquette, valeurs, valeurActive, auChangement) {
  const select = h('select', {
    onchange: (e) => auChangement(e.target.value),
    // Repere stable d'un rendu a l'autre : la vue est reconstruite toutes les
    // trente secondes, et le focus doit revenir au meme controle.
    dataset: { focus: `champ:${etiquette}` },
  },
    valeurs.map(({ valeur, texte, desactive }) => h('option', {
      value: valeur,
      selected: valeur === valeurActive,
      disabled: desactive,
    }, texte)));
  return h('label.champ', h('span', etiquette), select);
}

export function segments(options, valeurActive, auChangement, etiquette) {
  return h('div.segments', { role: 'group', 'aria-label': etiquette },
    options.map(({ valeur, texte }) => h('button', {
      type: 'button',
      'aria-pressed': String(valeur === valeurActive),
      dataset: { focus: `segment:${etiquette}:${valeur}` },
      onclick: () => auChangement(valeur),
    }, texte)));
}

/**
 * Meme fabrique, pour le SVG.
 *
 * `document.createElement` produirait des elements HTML nommes « svg » ou
 * « path », que le navigateur affiche comme du vide : le SVG a son propre
 * espace de noms, et il faut le dire.
 */
const SVG = 'http://www.w3.org/2000/svg';

export function s(selecteur, attributs, ...enfants) {
  const [balise, ...classes] = selecteur.split('.');
  const element = document.createElementNS(SVG, balise);
  if (classes.length) element.setAttribute('class', classes.join(' '));

  if (attributs && (Array.isArray(attributs) || attributs instanceof Node
      || typeof attributs !== 'object')) {
    enfants.unshift(attributs);
  } else if (attributs) {
    Object.entries(attributs).forEach(([cle, valeur]) => {
      if (valeur === null || valeur === undefined || valeur === false) return;
      element.setAttribute(cle, valeur === true ? '' : String(valeur));
    });
  }

  enfants.flat(Infinity).forEach((enfant) => {
    if (enfant === null || enfant === undefined || enfant === false) return;
    element.append(enfant instanceof Node ? enfant
      : document.createTextNode(String(enfant)));
  });
  return element;
}
