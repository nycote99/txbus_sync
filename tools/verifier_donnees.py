#!/usr/bin/env python3
"""
Verifications de coherence sur data/horaires.json.

Le fichier est produit par extraction de PDF : une mise en page qui change chez
la STC peut donner un JSON syntaxiquement valide mais faux. Ces controles
attrapent les degats visibles (colonnes desalignees, heures impossibles, zones
inconnues) avant qu'ils n'atteignent le site.
"""

import json
import os
import re
import sys

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FICHIER = os.path.join(RACINE, "data", "horaires.json")
RE_HEURE = re.compile(r"^([01][0-9]|2[0-3]):[0-5][0-9]$")

SERVICES = ("semaine", "fin_de_semaine")
DIRECTIONS = {"ligne10": ("cegep", "terminus"),
              "express": ("longueuil", "sorel")}


def minutes_service(heure):
    h, m = int(heure[:2]), int(heure[3:])
    return (h + 24 if h < 3 else h) * 60 + m


def verifier():
    erreurs = []

    with open(FICHIER, encoding="utf-8") as fichier:
        donnees = json.load(fichier)

    for cle in ("version_horaire", "terminus", "liens", "regles", "zones",
                "feries", "tarifs", "ligne10", "express", "taxibus",
                "zones_des_arrets"):
        if cle not in donnees:
            erreurs.append("section manquante : %s" % cle)
    if erreurs:
        return erreurs

    codes_zones = {zone["code"] for zone in donnees["zones"]}

    for ligne, directions in DIRECTIONS.items():
        for service in SERVICES:
            bloc_service = donnees[ligne].get(service)
            if not bloc_service:
                erreurs.append("%s : service %s absent" % (ligne, service))
                continue
            for direction in directions:
                bloc = bloc_service.get(direction)
                if not bloc:
                    erreurs.append("%s/%s : direction %s absente"
                                   % (ligne, service, direction))
                    continue
                erreurs.extend(verifier_grille(ligne, service, direction, bloc))

    if len(donnees["taxibus"]) < 12:
        erreurs.append("taxibus : seulement %d groupes de departs"
                       % len(donnees["taxibus"]))

    for groupe in donnees["taxibus"]:
        etiquette = "taxibus %s %s→%s" % (groupe["service"], groupe["origines"],
                                          groupe["destinations"])
        if groupe["service"] not in SERVICES:
            erreurs.append("%s : type de jour inconnu" % etiquette)
        for code in groupe["origines"] + groupe["destinations"]:
            if code not in codes_zones:
                erreurs.append("%s : zone inconnue %s" % (etiquette, code))
        if not groupe["heures"]:
            erreurs.append("%s : aucun depart" % etiquette)
        for heure in groupe["heures"]:
            if not RE_HEURE.match(heure):
                erreurs.append("%s : heure invalide %r" % (etiquette, heure))
        ordonnees = sorted(groupe["heures"], key=minutes_service)
        if groupe["heures"] != ordonnees:
            erreurs.append("%s : departs non ordonnes" % etiquette)

    for zone in donnees["zones"]:
        if not zone.get("municipalites"):
            erreurs.append("zone %s : aucune municipalite" % zone["code"])

    # Tout arret desservi doit etre rattache a une zone de taxibus, ou declare
    # explicitement hors territoire : sans cela, aucune correspondance possible.
    rattachement = donnees["zones_des_arrets"]
    for ligne in DIRECTIONS:
        for service in SERVICES:
            for bloc in donnees[ligne].get(service, {}).values():
                for arret in bloc.get("arrets", []):
                    if arret["nom"] not in rattachement:
                        erreurs.append("arrêt sans zone de taxibus : %r"
                                       % arret["nom"])
    for nom, code in rattachement.items():
        if code is not None and code not in codes_zones:
            erreurs.append("arrêt %r rattaché à la zone inconnue %s"
                           % (nom, code))

    cles_feries = {ferie["cle"] for ferie in donnees["feries"]}
    if len(cles_feries) != 14:
        erreurs.append("feries : %d entrees au lieu de 14" % len(cles_feries))

    return erreurs


def verifier_grille(ligne, service, direction, bloc):
    """Une grille valide est rectangulaire, chronologique et sans trou en tete."""
    erreurs = []
    etiquette = "%s/%s/%s" % (ligne, service, direction)
    arrets = bloc.get("arrets") or []

    if len(arrets) < 2:
        return ["%s : moins de deux arrets" % etiquette]

    largeur = len(arrets[0]["heures"])
    if largeur < 5:
        erreurs.append("%s : seulement %d departs" % (etiquette, largeur))

    for arret in arrets:
        if len(arret["heures"]) != largeur:
            erreurs.append("%s : l'arret %r a %d colonnes au lieu de %d"
                           % (etiquette, arret["nom"], len(arret["heures"]),
                              largeur))
        if not arret["nom"] or arret["nom"][0] in "•-,":
            erreurs.append("%s : libelle d'arret suspect %r"
                           % (etiquette, arret["nom"]))
        for heure in arret["heures"]:
            if heure is not None and not RE_HEURE.match(heure):
                erreurs.append("%s : heure invalide %r dans %r"
                               % (etiquette, heure, arret["nom"]))

    if None in arrets[0]["heures"]:
        erreurs.append("%s : l'arret d'origine a des colonnes vides" % etiquette)

    # Chaque voyage doit progresser dans le temps d'un arret au suivant.
    # On borne la lecture : une grille deja signalee comme irreguliere ne doit
    # pas faire echouer le controle sur une erreur d'indice.
    for colonne in range(largeur):
        precedent = None
        for arret in arrets:
            if colonne >= len(arret["heures"]):
                continue
            heure = arret["heures"][colonne]
            if heure is None or not RE_HEURE.match(heure):
                continue
            courant = minutes_service(heure)
            if precedent is not None and courant < precedent:
                erreurs.append("%s : voyage %d recule a %r (%s)"
                               % (etiquette, colonne + 1, arret["nom"], heure))
                break
            precedent = courant

    # Les departs se succedent dans l'ordre des colonnes.
    departs = [minutes_service(h) for h in arrets[0]["heures"]
               if h and RE_HEURE.match(h)]
    if departs != sorted(departs):
        erreurs.append("%s : colonnes de depart non ordonnees" % etiquette)

    return erreurs


def main():
    erreurs = verifier()
    if erreurs:
        print("Données incohérentes :", file=sys.stderr)
        for erreur in erreurs:
            print("  -", erreur, file=sys.stderr)
        sys.exit(1)
    print("data/horaires.json : cohérent.")


if __name__ == "__main__":
    main()
