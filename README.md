# Sorel Transit

Application web qui réunit en un seul endroit les services de la
[Société de transport Pierre-De Saurel](https://stcpierredesaurel.ca/) :
la ligne 10, les circuits express 750-753 et le taxibus régional.

Elle répond à trois questions que le site officiel oblige aujourd’hui à poser
à trois endroits différents : *quand passe mon autobus*, *où est-il en ce
moment*, et surtout *jusqu’à quand puis-je encore réserver mon taxibus*.

## Ce que l’application fait

**Heures limites de réservation du taxibus.** C’est la fonction centrale. Pour
chaque départ, l’application calcule le moment exact où la réservation se
ferme, en combinant les deux règles officielles :

1. la réservation est possible jusqu’à 30 minutes avant le départ ;
2. les départs qui ont lieu alors que le Terminus des Promenades est fermé —
   soirée, nuit, et début de matinée du lendemain — doivent être réservés
   **avant sa fermeture**.

La plus contraignante l’emporte. Un départ de 21 h 45 un mardi n’est donc pas
réservable jusqu’à 21 h 15, mais jusqu’à 20 h 30 ; et le premier départ du
lendemain matin doit être réservé la veille au soir. Chaque départ affiche un
compte à rebours et un état : réservable, dernière chance, ou fermé.

**Suivi des autobus en direct.** La STC publie un flux GTFS-RT ouvert, sans
authentification et avec les en-têtes CORS qui permettent de l’interroger
depuis le navigateur. L’application y lit la position GPS des véhicules, les
heures de passage réellement prévues à chaque arrêt — d’où l’écart affiché avec
la fiche horaire — et les avis de service.

Elle y lit aussi les **courses supprimées** : un express annulé s’affiche
barré, et ne compte plus comme correspondance. Annoncer un autobus qui ne
viendra pas est la pire chose que puisse faire un afficheur d’horaires.

Quand le flux ne répond pas — hors ligne, panne, ou consultation d’une autre
journée — l’application retombe sur une position estimée à partir de l’horaire
publié, et le dit : la pastille passe de « en direct » à « estimé selon
l’horaire ».

Deux précisions tirées du flux réel. Les avis de la STC ne portent aujourd’hui
qu’un identifiant d’agence dans `informed_entity` : ils concernent tous le
réseau entier, et l’étiquette le dit plutôt que de laisser croire à un tri. Le
champ est néanmoins lu, pour qu’un avis un jour rattaché à une ligne s’affiche
au bon endroit. Et les prévisions sont indexées par ligne, direction et heure
de départ autant que par véhicule : un flux qui publierait des mises à jour
sans position GPS resterait exploitable.

**Mon retour.** L’écran bâti autour du déplacement qui expose le mieux le
problème : rentrer en express, puis prendre un taxibus. On choisit d’où l’on
part, où l’on descend, vers quelle zone on poursuit et quel jour ; l’écran rend
chaque express de la journée avec le taxibus qui le prolonge, le temps
d’attente, et un verdict qui dit *quand* réserver.

Le temps réel s’y greffe : quand le retard dépasse le jeu de la
correspondance, l’écran annonce que le taxibus visé **n’est plus rattrapable**
et donne le suivant. Le jeu est l’attente moins le battement de descente —
six minutes d’attente n’en laissent qu’une d’utilisable.

Ce verdict est la raison d’être de l’écran. Un mardi ordinaire, sur les
34 retours depuis Longueuil, **27 exigent de réserver avant même de descendre
de l’autobus, et 6 avant d’y monter** — le terminus ayant fermé à 20 h 30, un
express qui quitte Longueuil à 22 h 20 arrive à 23 h 18 alors que le taxibus de
00 h 15 devait être réservé une heure cinquante plus tôt.

Chaque retour porte deux gestes : réserver sur le portail de la STC, ou
**poser un rappel dans son calendrier** — un fichier `.ics` avec une alarme
calée avant l’échéance, produit sans serveur ni compte.

La journée consultée se choisit librement, dans la fenêtre de quatorze jours
qu’ouvre la réservation en ligne, et l’adresse porte tout l’état de l’écran :
« mon retour de jeudi » s’envoie par message.

**Correspondance autobus vers taxibus.** La même mécanique, greffée sur le
suivi d’un voyage choisi dans l’onglet Autobus.

**Le reste.** Prochains passages à n’importe quel arrêt, grilles horaires
complètes, tarifs 2026, pénalités d’absence, zones du taxibus, et le calendrier
des jours fériés qui basculent le réseau sur l’horaire de fin de semaine.

L’interface est adaptative : navigation par onglets en bas sur téléphone,
barre latérale sur grand écran, thèmes clair et sombre, et fonctionnement
hors ligne une fois la page visitée.

## Structure

```
index.html                  coquille de l'application
assets/css/app.css          jetons de couleur, mise en page adaptative
assets/js/calendrier.js     jours de service, jours fériés, heures du terminus
assets/js/reseau.js         requêtes d'horaire, heures limites, position
assets/js/protobuf.js       lecteur minimal du format de fil protobuf
assets/js/tempsreel.js      flux GTFS-RT : positions, prévisions, avis
assets/js/proximite.js      arrêts les plus proches d'une position
assets/js/rappel.js         fichier calendrier de rappel d'une heure limite
assets/js/vues/             une vue par onglet
data/horaires.json          horaires extraits des PDF officiels
data/reseau-gtfs.json       table qui nomme les identifiants du flux temps réel
tools/parse_horaires.py     extraction PDF → JSON
tools/parse_gtfs.py         extraction GTFS statique → table de référence
tools/parcours_gtfs.py      parcours complet des lignes, greffé sur les fiches
tests/                      tests unitaires (node --test, sans dépendance)
tools/verifier_donnees.py   contrôles de cohérence des horaires
tools/verifier_gtfs.py      contrôles sur la table de référence
tools/verifier_service_worker.py  contrôle de la coquille hors ligne
tools/veiller_sources.py    veille hebdomadaire sur les horaires publiés
```

Aucune dépendance, aucune étape de compilation : les fichiers publiés sont les
fichiers servis. Le flux temps réel est un protobuf binaire ; plutôt que
d'embarquer une bibliothèque de plusieurs centaines de kilo-octets pour lire
une dizaine de champs, `protobuf.js` décode directement le format de fil, qui
n'a que quatre types.

## Sources de données

| Source | Contenu | Rafraîchissement |
|---|---|---|
| Fiches PDF de la STC | horaires ligne 10, express, taxibus par zone | à la main, ~2 fois l'an, sur alerte de la veille |
| GTFS statique Zenbus | noms des lignes, parcours complet des arrêts, directions | à la main, avec les PDF |
| GTFS-RT Zenbus | positions GPS, heures prévues, avis de service | toutes les 30 s dans le navigateur |

Le taxibus n'est pas dans le GTFS : il reste entièrement décrit par les fiches
PDF, et ses heures limites de réservation sont calculées par l'application.

### Ce que chaque source a le droit de dire

Les fiches ne publient qu'une dizaine de points de passage par ligne — des
repères, pas la liste des arrêts. Le GTFS, lui, connaît le parcours complet :
quarante-trois arrêts pour la ligne 10 en direction du Cégep, quarante et un au
retour.

On ne peut pas pour autant lui substituer les fiches. Le GTFS publié par Zenbus
porte `feed_version` du **28 janvier 2026**, alors que les fiches sont datées du
**17 août** : trois voyages de la ligne 10 et deux express y ont changé d'heure,
et deux express en ont disparu. Basculer les horaires sur le GTFS ferait
régresser l'application de sept mois.

D'où le partage : **les fiches donnent les heures, le GTFS donne la séquence des
arrêts et les temps de parcours entre eux.** Les deux sources s'accordent
exactement sur ces temps de parcours — vérifié sur les 126 voyages de la ligne
10 — ce qui rend la greffe sûre : `parcours_gtfs.py` recale le parcours GTFS sur
l'heure publiée, et une post-condition refuse de construire les données si une
heure publiée s'en trouvait modifiée. Les colonnes qu'aucun voyage GTFS
n'explique — les trois départs express revus depuis janvier — gardent leurs
seuls points de passage publiés.

**Le retour peut aussi se finir en ligne 10.** Chaque retour affiche, sous le
verdict du taxibus, le prochain départ de la ligne 10 à l'arrêt de descente —
l'autre prolongement, et le seul qui ne se réserve pas. Mesuré sur un mardi :
32 des 34 retours de Longueuil ont une ligne 10 au Terminus des Promenades,
attente médiane 18 minutes. Les deux qui n'en ont pas sont ceux de la nuit,
0 h 58 et 1 h 48 — précisément ceux dont le taxibus devait être réservé avant
la fermeture du terminus. L'écran le dit à ces deux lignes-là, parce que c'est
là que l'heure limite décide vraiment du trajet.

Au-delà de quatre-vingt-dix minutes d'attente, aucune correspondance n'est
proposée : après le dernier passage de la ligne 10, le suivant est à plus de
trois heures, et l'annoncer serait mentir sur ce qu'est une correspondance.

**Arrêts près de moi.** Quarante-trois arrêts dans une liste déroulante ne
disent pas lequel est au coin de la rue ; la position du navigateur, elle, le
dit. Elle ne quitte jamais l'appareil : les coordonnées des arrêts sont
embarquées et le calcul se fait dans la page. Un refus de géolocalisation
s'affiche en une phrase et laisse la liste faire son travail.

Deux arrêts à moins de soixante mètres sont fondus en une seule proposition :
les deux trottoirs d'un carrefour portent souvent deux noms — « Du Roi /
Charlotte » d'un côté, « Charlotte / Du Roi » de l'autre — et proposer les deux
n'aide personne à choisir. Le seuil vient d'une mesure : sur ce réseau, les
paires face-à-face vont de 2 à 54 m, et le premier arrêt réellement distinct est
à 78 m. C'est le nom du plus proche qui s'affiche, celui qu'on lit sur le
poteau ; l'autre reste en infobulle.

Chaque arrêt de grille porte désormais son identifiant GTFS. C'est lui qui
apparie un passage à sa prévision temps réel : les deux sens de la ligne 10
desservent la même intersection de part et d'autre de la rue, sous le même nom,
à des heures différentes — le nom seul les confondrait.

## Développement

```sh
python3 -m http.server 8000   # puis http://localhost:8000
```

Un serveur local est nécessaire : l’application charge `data/horaires.json` par
`fetch`, ce qui ne fonctionne pas depuis `file://`.

## Mettre à jour les horaires

La STC publie ses horaires en PDF, deux fois par année environ. Pour les
reprendre :

1. relever les nouvelles adresses des PDF sur les pages *Horaire et parcours*
   du site de la STC, et les inscrire dans le dictionnaire `SOURCES` de
   `tools/parse_horaires.py` ;
2. régénérer et vérifier :

   ```sh
   pip install pdfplumber
   python3 tools/parse_horaires.py --telecharger
   python3 tools/parse_gtfs.py --telecharger
   python3 tools/verifier_donnees.py && python3 tools/verifier_gtfs.py
   ```

3. relire le tableau d’un circuit dans l’application et le comparer au PDF
   avant de publier.

L’extraction s’aligne sur la position horizontale des colonnes plutôt que sur
l’ordre du texte, parce que plusieurs arrêts ne sont desservis que par une
poignée de départs. `verifier_donnees.py` refuse une grille non rectangulaire,
un voyage qui recule dans le temps, une heure impossible ou une zone inconnue —
autant de symptômes d’une mise en page qui aurait changé.

Les données de référence qui ne figurent pas dans les grilles — zones, tarifs,
règles et coordonnées — sont tenues à la main en fin de `parse_horaires.py`.

Les zones de taxibus des arrêts d'autobus suivent une règle plutôt qu'une
liste : la ligne 10 est le circuit urbain, ses quarante-trois arrêts sont tous
dans Sorel-Tracy, donc tous en zone 1. Seuls les arrêts express, qui sortent du
territoire, sont nommés un à un. Un arrêt express ajouté par la STC sans zone
correspondante fait échouer la construction, ce qui évite qu'une correspondance
disparaisse en silence.

Un piège à connaître dans le GTFS : `direction_id` n'est pas cohérent d'un
circuit à l'autre — il vaut 0 pour Longueuil sur les 750 et 752, mais 0 pour
Sorel-Tracy sur les 751 et 753. Seule la destination affichée est fiable, et
c'est elle que `parse_gtfs.py` utilise.

### Une nouvelle version s'annonce, elle ne s'impose pas

Le service worker n'appelait plus `skipWaiting()` en silence : une version qui
s'installe pendant qu'on lit un horaire remplacerait sous les yeux de l'usager
des heures qu'il est peut-être en train de noter. La nouvelle version attend
donc, un bandeau flottant l'annonce, et c'est l'usager qui choisit le moment.
« Plus tard » referme le bandeau sans rien activer ; la visite suivante le
propose de nouveau. « Actualiser » active la version en attente, purge l'ancien
cache et recharge la page une seule fois — un verrou empêche deux onglets
ouverts de se relancer l'un l'autre sans fin.

### Savoir que les horaires ont changé

Les données sont figées au moment de l'extraction, et rien n'avertit quand la
STC publie une nouvelle fiche : l'application continuerait à servir des heures
périmées, avec assurance — heures limites de réservation comprises.

Surveiller les adresses connues ne verrait rien venir : le nom du fichier porte
sa date, `20260817_Horaire_ligne10_VF.pdf`, et l'ancienne adresse reste servie
telle quelle. `veiller_sources.py` relit donc les trois pages horaires du site
et regarde quels PDF elles pointent *aujourd'hui*. Il signale trois choses :

- une page pointe une fiche que l'application ne connaît pas ;
- un PDF connu a changé de contenu sans changer d'adresse ;
- le GTFS de Zenbus a été republié (`feed_version`).

`.github/workflows/veille.yml` l'exécute chaque lundi matin — le jour où les
changements d'horaire de la STC prennent effet — et ouvre une issue au premier
écart, en la mettant à jour plutôt qu'en accumulant une issue par semaine.

## Accessibilité

Mesurée plutôt que déclarée : un script parcourt les cinq vues dans les deux
thèmes et calcule le ratio de contraste de chaque texte rendu contre son fond
réel, vérifie que tout élément focusable porte un nom accessible et que les
titres ne sautent pas de niveau. Trois défauts réels en sont sortis, tous
corrigés :

| Défaut | Ratio | Correction |
|---|---|---|
| « Réservable » sur sa pastille, thème clair | 4,30 | `--ok` assombri à `#147a3a` |
| « À réserver avant d'arriver » et le bandeau d'alerte, thème clair | 4,46 | `--alerte` assombri à `#b05109` |
| « Réserver », thème sombre | 2,21 | nouveau jeton `--sur-marque` : `--marque` est une teinte *claire* en thème sombre, le blanc n'y tenait pas |

Le script s'était d'abord trompé lui-même : `getComputedStyle` rend
`color(srgb 1 1 1 / 0.94)` pour un `color-mix`, avec des composantes de 0 à 1
et non de 0 à 255. Lues comme des octets, elles faisaient passer le blanc pour
du noir et inventaient cinq défauts de navigation qui n'existaient pas.

**Le focus survit aux redessins.** La vue est reconstruite entière toutes les
trente secondes et à chaque arrivée du flux temps réel ; le focus retombait
alors sur le document. Au clavier ou au lecteur d'écran, on était renvoyé en
haut de page toutes les trente secondes. Chaque contrôle porte maintenant un
repère stable et le focus lui revient — sans jamais être volé à qui se trouve
ailleurs que dans la vue.

**Ce qui s'annonce, et ce qui ne s'annonce pas.** Les comptes à rebours ne sont
pas des régions vivantes : les faire relire toutes les trente secondes rendrait
l'application inécoutable. Une région discrète annonce en revanche ce qu'on ne
peut pas voir venir — l'arrivée et la perte du suivi en direct, c'est-à-dire le
moment où les heures affichées cessent d'être observées pour redevenir
estimées, et les nouveaux avis de service. L'horloge d'en-tête porte
`aria-live="off"`.

## Vérifications

`.github/workflows/verifier.yml` exécute les deux contrôles sur chaque *pull
request* et sur `main` :

```sh
node --test tests/*.test.js               # logique du calendrier et des limites
python3 tools/verifier_donnees.py         # cohérence des horaires extraits
python3 tools/verifier_gtfs.py            # cohérence de la table de référence
python3 tools/verifier_service_worker.py  # complétude de la coquille hors ligne
```

`tools/veiller_sources.py` n'y figure pas : il interroge le site de la STC et
n'a donc rien à faire dans un contrôle de *pull request*, qui doit rester
déterministe. Il tourne à part, sur son propre calendrier.

Les tests couvrent ce que l'usager ne peut pas vérifier lui-même : le calcul
des jours fériés, la journée de service qui bascule à 3 h du matin, et surtout
l'heure limite de réservation du taxibus, dont la fiche horaire n'imprime
jamais le résultat. Les quinze arrivées du soir depuis Longueuil y sont figées
comme cas de référence, dont celle de 23:18 dont la réservation ferme à 20:30 —
une heure cinquante avant l'embarquement à Longueuil.

Leur pouvoir de détection a été mesuré en cassant volontairement la règle de
fermeture du terminus, le délai de trente minutes, l'heure de bascule du jour
de service, le calcul de la fête des Patriotes, la lecture des entiers longs et
le rapprochement des noms d'arrêts : chacune des six régressions fait échouer
la suite.

Le fichier `package.json` ne sert qu'à déclarer les fichiers `.js` comme
modules ES, pour que node les charge comme le fait le navigateur. Le projet n'a
toujours aucune dépendance.

Le contrôle de la coquille attrape le module oublié dans `service-worker.js` :
la page continue de fonctionner en développement, et casse chez l'usager qui la
rouvre sans réseau à un arrêt. Celui de la table GTFS attrape les changements
d'identifiants chez Zenbus, qui rendraient la couche temps réel muette sans
rien casser d'apparent.

## Déploiement

Le site est publié sur GitHub Pages :
<https://nycote99.github.io/txbus_sync/>

Deux façons de le servir, au choix.

**Depuis une branche** (configuration actuelle). GitHub publie le contenu de la
branche choisie dans *Settings → Pages → Source : Deploy from a branch*. Rien
d'autre à faire : le dépôt ne contient aucune étape de compilation, les
fichiers publiés sont les fichiers servis. Après la fusion, pointer la source
sur `main`, sinon le site cesse d'être mis à jour quand la branche de travail
disparaît.

**Par le workflow** (`.github/workflows/pages.yml`). Choisir *Settings → Pages
→ Source : GitHub Actions*. Chaque push sur `main` vérifie alors les données et
la coquille hors ligne **avant** de publier, ce qui empêche une extraction
ratée d'atteindre le site. Ce workflow reste inerte tant que la source est une
branche.

## Portée et limites

Projet indépendant, sans lien avec la Société de transport Pierre-De Saurel.
Les positions de véhicules sont estimées d’après l’horaire et non issues d’un
suivi GPS ; les horaires peuvent ne pas être respectés en cas de perturbation
du réseau. La réservation et le suivi en direct se font sur les plateformes
officielles, vers lesquelles l’application renvoie. **En cas de divergence,
l’information de la STC prévaut.**

Réservation et suivi : <https://stc.accestaxi.com/> ·
Terminus des Promenades — STC : 450 743-3336 / 1 833 703-3336
