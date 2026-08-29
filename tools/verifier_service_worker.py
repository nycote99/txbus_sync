#!/usr/bin/env python3
"""
Verifie que le service worker met bien en cache tout ce que la page charge.

Un module oublie dans la liste `COQUILLE` ne se voit pas en developpement : la
page fonctionne, jusqu'a ce qu'un usager la rouvre sans reseau a un arret.
"""

import os
import re
import sys

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def lire(*chemin):
    with open(os.path.join(RACINE, *chemin), encoding="utf-8") as fichier:
        return fichier.read()


def modules_javascript():
    """Tous les fichiers sous assets/js, chemins relatifs a la racine."""
    trouves = set()
    base = os.path.join(RACINE, "assets", "js")
    for dossier, _, fichiers in os.walk(base):
        for nom in fichiers:
            if nom.endswith(".js"):
                chemin = os.path.join(dossier, nom)
                trouves.add(os.path.relpath(chemin, RACINE).replace(os.sep, "/"))
    return trouves


def main():
    coquille = set(re.findall(r"^\s*'([^']+)',\s*$",
                              lire("service-worker.js").split("];")[0],
                              re.MULTILINE))
    erreurs = []

    manquants = modules_javascript() - coquille
    if manquants:
        erreurs.append("absents de la coquille hors ligne : "
                       + ", ".join(sorted(manquants)))

    for entree in sorted(coquille):
        if entree in ("./",):
            continue
        if not os.path.exists(os.path.join(RACINE, entree)):
            erreurs.append("mis en cache mais introuvable : %s" % entree)

    for ressource in re.findall(r'(?:href|src)="([^"#:]+)"', lire("index.html")):
        if ressource.startswith(("http", "mailto", "tel")):
            continue
        if not os.path.exists(os.path.join(RACINE, ressource)):
            erreurs.append("référencé par index.html mais introuvable : %s"
                           % ressource)

    if erreurs:
        print("Coquille hors ligne incohérente :", file=sys.stderr)
        for erreur in erreurs:
            print("  -", erreur, file=sys.stderr)
        sys.exit(1)
    print("service-worker.js : coquille complète.")


if __name__ == "__main__":
    main()
