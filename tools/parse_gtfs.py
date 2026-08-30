#!/usr/bin/env python3
"""
Extrait du GTFS statique de la STC le minimum necessaire pour interpreter le
flux temps reel : nom des lignes, nom et position des arrets, direction des
voyages.

Le flux GTFS-RT ne transporte que des identifiants. Sans cette table, une
position de vehicule est illisible. On embarque donc la table plutot que de
faire telecharger 500 ko de GTFS a chaque ouverture de l'application.

Usage:
    python3 tools/parse_gtfs.py --telecharger
"""

import argparse
import csv
import io
import json
import os
import subprocess
import sys
import zipfile

import parcours_gtfs

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(RACINE, "tools", ".pdf-cache")
ARCHIVE = os.path.join(CACHE, "gtfs.zip")

SOURCE = parcours_gtfs.SOURCE
FLUX_TEMPS_REEL = "https://zenbus.net/gtfs/rt/poll.proto?dataset=pierre-de-saurel"

# Rattache chaque ligne du GTFS a la famille utilisee dans l'application.
FAMILLES = {"10": "ligne10", "750": "express", "751": "express",
            "752": "express", "753": "express"}

# direction_id n'est pas coherent d'un circuit a l'autre : il vaut 0 pour
# Longueuil sur les 750 et 752, mais 0 pour Sorel-Tracy sur les 751 et 753.
# Seule la destination affichee est fiable.
DIRECTIONS = {
    "Direction Cégep": "cegep",
    "Direction Promenades de Sorel": "terminus",
    "Direction Longueuil": "longueuil",
    "Direction Sorel-Tracy": "sorel",
}


def telecharger():
    os.makedirs(CACHE, exist_ok=True)
    subprocess.run(["curl", "-sSL", "-o", ARCHIVE, SOURCE], check=True)
    print("téléchargé :", ARCHIVE)


def lire(archive, nom):
    with archive.open(nom) as brut:
        texte = io.TextIOWrapper(brut, encoding="utf-8-sig", newline="")
        return list(csv.DictReader(texte))


def construire():
    with zipfile.ZipFile(ARCHIVE) as archive:
        routes = lire(archive, "routes.txt")
        arrets = lire(archive, "stops.txt")
        voyages = lire(archive, "trips.txt")

    table_routes = {}
    for route in routes:
        numero = route["route_short_name"]
        table_routes[route["route_id"]] = {
            "numero": numero,
            "nom": route["route_long_name"] or numero,
            "famille": FAMILLES.get(numero),
            "couleur": "#" + route["route_color"] if route.get("route_color") else None,
        }

    table_arrets = {}
    for arret in arrets:
        table_arrets[arret["stop_id"]] = {
            "nom": arret["stop_name"],
            "code": arret.get("stop_code") or None,
            "lat": round(float(arret["stop_lat"]), 6),
            "lon": round(float(arret["stop_lon"]), 6),
        }

    table_voyages = {}
    inconnues = set()
    for voyage in voyages:
        destination = (voyage.get("trip_headsign") or "").strip()
        direction = DIRECTIONS.get(destination)
        if direction is None:
            inconnues.add(destination)
        table_voyages[voyage["trip_id"]] = {
            "route": voyage["route_id"],
            "direction": direction,
            "destination": destination or None,
        }
    if inconnues:
        print("destinations non reconnues : %s" % ", ".join(sorted(inconnues)),
              file=sys.stderr)
        sys.exit(1)

    return {
        "source": SOURCE,
        "flux_temps_reel": FLUX_TEMPS_REEL,
        "routes": table_routes,
        "arrets": table_arrets,
        "voyages": table_voyages,
    }


def main():
    analyseur = argparse.ArgumentParser(description=__doc__)
    analyseur.add_argument("--telecharger", action="store_true")
    analyseur.add_argument("--sortie",
                           default=os.path.join(RACINE, "data", "reseau-gtfs.json"))
    options = analyseur.parse_args()

    if options.telecharger:
        telecharger()
    if not os.path.exists(ARCHIVE):
        sys.exit("Archive GTFS absente : relancer avec --telecharger")

    donnees = construire()
    with open(options.sortie, "w", encoding="utf-8") as fichier:
        json.dump(donnees, fichier, ensure_ascii=False, separators=(",", ":"))
        fichier.write("\n")
    print("écrit : %s (%d lignes, %d arrêts, %d voyages)"
          % (options.sortie, len(donnees["routes"]), len(donnees["arrets"]),
             len(donnees["voyages"])))


if __name__ == "__main__":
    main()
