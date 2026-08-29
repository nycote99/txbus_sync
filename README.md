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

**Suivi des autobus.** Position estimée de chaque véhicule le long de son
parcours, calculée à partir de l’horaire officiel et de l’heure courante à
Sorel-Tracy. La STC ne publie pas de flux temps réel ouvert : l’application le
dit explicitement partout où une position est affichée, et renvoie vers le
suivi officiel en direct.

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
assets/js/reseau.js         requêtes d'horaire, position estimée, heures limites
assets/js/vues/             une vue par onglet
data/horaires.json          horaires extraits des PDF officiels
tools/parse_horaires.py     extraction PDF → JSON
tools/verifier_donnees.py   contrôles de cohérence (exécutés par la CI)
```

Aucune dépendance, aucune étape de compilation : les fichiers publiés sont les
fichiers servis.

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
   python3 tools/verifier_donnees.py
   ```

3. relire le tableau d’un circuit dans l’application et le comparer au PDF
   avant de publier.

L’extraction s’aligne sur la position horizontale des colonnes plutôt que sur
l’ordre du texte, parce que plusieurs arrêts ne sont desservis que par une
poignée de départs. `verifier_donnees.py` refuse une grille non rectangulaire,
un voyage qui recule dans le temps, une heure impossible ou une zone inconnue —
autant de symptômes d’une mise en page qui aurait changé.

Les données de référence qui ne figurent pas dans les grilles — zones, tarifs,
règles, coordonnées — sont tenues à la main en fin de `parse_horaires.py`.

## Déploiement

Un push sur `main` déclenche `.github/workflows/pages.yml`, qui vérifie les
données puis publie la racine du dépôt sur GitHub Pages. Activer *Settings →
Pages → Source : GitHub Actions* la première fois.

## Portée et limites

Projet indépendant, sans lien avec la Société de transport Pierre-De Saurel.
Les positions de véhicules sont estimées d’après l’horaire et non issues d’un
suivi GPS ; les horaires peuvent ne pas être respectés en cas de perturbation
du réseau. La réservation et le suivi en direct se font sur les plateformes
officielles, vers lesquelles l’application renvoie. **En cas de divergence,
l’information de la STC prévaut.**

Réservation et suivi : <https://stc.accestaxi.com/> ·
Terminus des Promenades — STC : 450 743-3336 / 1 833 703-3336
