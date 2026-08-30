#!/usr/bin/env python3
"""
Verifications sur data/reseau-gtfs.json, la table qui donne un sens aux
identifiants du flux temps reel.

Une table incoherente ne fait pas planter l'application — la couche temps reel
est facultative — mais elle la rend muette : des vehicules sans ligne, sans
direction, ou situes a des arrets sans nom.
"""

import json
import os
import sys

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FICHIER = os.path.join(RACINE, "data", "reseau-gtfs.json")
HORAIRES = os.path.join(RACINE, "data", "horaires.json")

FAMILLES = {"ligne10", "express"}
DIRECTIONS = {"ligne10": {"cegep", "terminus"},
              "express": {"longueuil", "sorel"}}


def verifier():
    erreurs = []
    with open(FICHIER, encoding="utf-8") as fichier:
        donnees = json.load(fichier)

    for cle in ("flux_temps_reel", "routes", "arrets", "voyages"):
        if cle not in donnees:
            erreurs.append("section manquante : %s" % cle)
    if erreurs:
        return erreurs

    if not donnees["flux_temps_reel"].startswith("https://"):
        erreurs.append("le flux temps réel doit être servi en HTTPS")

    routes = donnees["routes"]
    if len(routes) < 5:
        erreurs.append("seulement %d lignes" % len(routes))
    for identifiant, route in routes.items():
        if route["famille"] not in FAMILLES:
            erreurs.append("ligne %s : famille inconnue %r"
                           % (route.get("numero"), route["famille"]))

    for identifiant, arret in donnees["arrets"].items():
        if not arret.get("nom"):
            erreurs.append("arrêt %s sans nom" % identifiant)
        if not (-90 <= arret["lat"] <= 90 and -180 <= arret["lon"] <= 180):
            erreurs.append("arrêt %s : coordonnées hors bornes" % identifiant)

    if len(donnees["voyages"]) < 50:
        erreurs.append("seulement %d voyages" % len(donnees["voyages"]))

    for identifiant, voyage in donnees["voyages"].items():
        route = routes.get(voyage["route"])
        if route is None:
            erreurs.append("voyage %s : ligne inconnue" % identifiant)
            continue
        attendues = DIRECTIONS.get(route["famille"], set())
        if voyage["direction"] not in attendues:
            erreurs.append("voyage %s (%s) : direction %r inattendue"
                           % (identifiant, route["numero"], voyage["direction"]))

    # Chaque direction doit etre representee, sinon la moitie des vehicules
    # temps reel resterait sans appariement.
    vues = {(routes[v["route"]]["famille"], v["direction"])
            for v in donnees["voyages"].values() if v["route"] in routes}
    for famille, directions in DIRECTIONS.items():
        for direction in directions:
            if (famille, direction) not in vues:
                erreurs.append("aucun voyage pour %s/%s" % (famille, direction))

    # Les grilles horaires designent leurs arrets par identifiant GTFS depuis la
    # greffe du parcours. Un identifiant absent d'ici rendrait le passage
    # inappariable au flux temps reel — et donc muet sur les retards.
    with open(HORAIRES, encoding="utf-8") as fichier:
        horaires = json.load(fichier)
    for famille in ("ligne10", "express"):
        for service, blocs in horaires[famille].items():
            for direction, bloc in blocs.items():
                for arret in bloc["arrets"]:
                    if arret.get("id") and arret["id"] not in donnees["arrets"]:
                        erreurs.append("%s/%s/%s : l'arrêt %r est inconnu de la "
                                       "table GTFS"
                                       % (famille, service, direction,
                                          arret["nom"]))

    return erreurs


def main():
    erreurs = verifier()
    if erreurs:
        print("Table GTFS incohérente :", file=sys.stderr)
        for erreur in erreurs:
            print("  -", erreur, file=sys.stderr)
        sys.exit(1)
    print("data/reseau-gtfs.json : cohérent.")


if __name__ == "__main__":
    main()
