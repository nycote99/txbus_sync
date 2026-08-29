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

Quand le flux ne répond pas — hors ligne, panne, ou consultation d’une autre
journée — l’application retombe sur une position estimée à partir de l’horaire
publié, et le dit : la pastille passe de « en direct » à « estimé selon
l’horaire ».

**Mon retour.** L’écran bâti autour du déplacement qui expose le mieux le
problème : rentrer en express, puis prendre un taxibus. On choisit d’où l’on
part, où l’on descend, vers quelle zone on poursuit et quel jour ; l’écran rend
chaque express de la journée avec le taxibus qui le prolonge, le temps
d’attente, et un verdict qui dit *quand* réserver.

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
assets/js/rappel.js         fichier calendrier de rappel d'une heure limite
assets/js/vues/             une vue par onglet
data/horaires.json          horaires extraits des PDF officiels
data/reseau-gtfs.json       table qui nomme les identifiants du flux temps réel
tools/parse_horaires.py     extraction PDF → JSON
tools/parse_gtfs.py         extraction GTFS statique → table de référence
tests/                      tests unitaires (node --test, sans dépendance)
tools/verifier_donnees.py   contrôles de cohérence des horaires
tools/verifier_gtfs.py      contrôles sur la table de référence
tools/verifier_service_worker.py  contrôle de la coquille hors ligne
```

Aucune dépendance, aucune étape de compilation : les fichiers publiés sont les
fichiers servis. Le flux temps réel est un protobuf binaire ; plutôt que
d'embarquer une bibliothèque de plusieurs centaines de kilo-octets pour lire
une dizaine de champs, `protobuf.js` décode directement le format de fil, qui
n'a que quatre types.

## Sources de données

| Source | Contenu | Rafraîchissement |
|---|---|---|
| Fiches PDF de la STC | horaires ligne 10, express, taxibus par zone | à la main, ~2 fois l'an |
| GTFS statique Zenbus | noms des lignes, arrêts et directions | à la main, avec les PDF |
| GTFS-RT Zenbus | positions GPS, heures prévues, avis de service | toutes les 30 s dans le navigateur |

Le taxibus n'est pas dans le GTFS : il reste entièrement décrit par les fiches
PDF, et ses heures limites de réservation sont calculées par l'application.

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
règles, coordonnées, et la zone de taxibus de chaque arrêt d'autobus — sont
tenues à la main en fin de `parse_horaires.py`. Un arrêt ajouté par la STC sans
zone correspondante fait échouer `verifier_donnees.py`, ce qui évite qu'une
correspondance disparaisse en silence.

Un piège à connaître dans le GTFS : `direction_id` n'est pas cohérent d'un
circuit à l'autre — il vaut 0 pour Longueuil sur les 750 et 752, mais 0 pour
Sorel-Tracy sur les 751 et 753. Seule la destination affichée est fiable, et
c'est elle que `parse_gtfs.py` utilise.

## Vérifications

`.github/workflows/verifier.yml` exécute les deux contrôles sur chaque *pull
request* et sur `main` :

```sh
node --test tests/*.test.js               # logique du calendrier et des limites
python3 tools/verifier_donnees.py         # cohérence des horaires extraits
python3 tools/verifier_gtfs.py            # cohérence de la table de référence
python3 tools/verifier_service_worker.py  # complétude de la coquille hors ligne
```

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
