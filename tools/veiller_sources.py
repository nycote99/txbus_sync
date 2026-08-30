#!/usr/bin/env python3
"""
Veille sur les horaires publies par la STC.

Les donnees embarquees sont figees au moment ou on les extrait. Rien n'avertit
quand la STC publie une nouvelle fiche : l'application continue de servir des
heures perimees, avec assurance, jusqu'a ce que quelqu'un s'en apercoive.

Le piege est que l'adresse des fiches change a chaque revision — le nom du
fichier porte la date, `20260817_Horaire_ligne10_VF.pdf`. Surveiller les
adresses connues ne verrait donc jamais rien venir : elles restent servies
telles quelles. Il faut relire les pages horaires du site et voir quels PDF
elles pointent aujourd'hui.

Trois divergences sont signalees :
  1. une page horaire pointe un PDF que l'application ne connait pas ;
  2. un PDF connu a change de contenu sans changer d'adresse ;
  3. le GTFS de Zenbus a ete republie (feed_version).

Usage :
    python3 tools/veiller_sources.py                # controle, sortie 1 si écart
    python3 tools/veiller_sources.py --enregistrer  # fige l'état courant
"""

import argparse
import hashlib
import io
import json
import os
import re
import sys
import urllib.request
import zipfile

import parcours_gtfs

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EMPREINTES = os.path.join(RACINE, "data", "empreintes-sources.json")

# Pages du site ou la STC publie ses fiches horaires.
PAGES = {
    "ligne10": "https://stcpierredesaurel.ca/horaire-et-parcours/horaire-ligne10/",
    "express": "https://stcpierredesaurel.ca/horaire-et-parcours/horaire-express/",
    "taxibus": "https://stcpierredesaurel.ca/horaire-et-parcours/horaire-taxibus/",
}

# La carte des circuits n'est pas une fiche horaire : elle ne change pas avec
# les heures, et sa presence sur la page ligne 10 n'annonce aucune revision.
IGNORES = re.compile(r"carte-circuits", re.I)

LIENS_PDF = re.compile(
    r"https://stcpierredesaurel\.ca/wp-content/uploads/[^\"'<> )]+\.pdf", re.I)

AGENT = "txbus_sync veille (https://github.com/nycote99/txbus_sync)"


def telecharger(url):
    requete = urllib.request.Request(url, headers={"User-Agent": AGENT})
    with urllib.request.urlopen(requete, timeout=60) as reponse:
        return reponse.read()


def pdf_des_pages():
    """Adresses des PDF que les pages horaires du site pointent aujourd'hui."""
    trouves = {}
    for nom, url in PAGES.items():
        page = telecharger(url).decode("utf-8", "replace")
        liens = {lien for lien in LIENS_PDF.findall(page)
                 if not IGNORES.search(lien)}
        trouves[nom] = sorted(liens)
    return trouves


def empreinte(url):
    return hashlib.sha256(telecharger(url)).hexdigest()


def version_gtfs():
    archive = zipfile.ZipFile(io.BytesIO(telecharger(parcours_gtfs.SOURCE)))
    lignes = archive.read("feed_info.txt").decode("utf-8-sig").splitlines()
    entetes = lignes[0].split(",")
    valeurs = lignes[1].split(",")
    champs = dict(zip(entetes, valeurs))
    return {cle: champs.get(cle) for cle in
            ("feed_version", "feed_start_date", "feed_end_date")}


def releve():
    """Etat courant des sources publiees."""
    import parse_horaires
    return {
        "pages": pdf_des_pages(),
        "empreintes": {nom: empreinte(url)
                       for nom, url in sorted(parse_horaires.SOURCES.items())},
        "gtfs": version_gtfs(),
    }


def comparer(courant, connu):
    """Divergences entre ce que la STC publie et ce que l'application embarque."""
    import parse_horaires
    ecarts = []
    embarquees = set(parse_horaires.SOURCES.values())

    for page, liens in courant["pages"].items():
        for lien in liens:
            if lien not in embarquees:
                ecarts.append("La page « %s » pointe une fiche inconnue : %s"
                              % (page, lien))
        for lien in connu.get("pages", {}).get(page, []):
            if lien not in liens:
                ecarts.append("La page « %s » ne pointe plus : %s"
                              % (page, lien))

    for nom, valeur in courant["empreintes"].items():
        ancienne = connu.get("empreintes", {}).get(nom)
        if ancienne and ancienne != valeur:
            ecarts.append("Le PDF « %s » a changé sans changer d'adresse "
                          "(%s… → %s…)" % (nom, ancienne[:12], valeur[:12]))
        elif ancienne is None:
            ecarts.append("Aucune empreinte enregistrée pour « %s »" % nom)

    ancien = connu.get("gtfs", {}).get("feed_version")
    if ancien and ancien != courant["gtfs"]["feed_version"]:
        ecarts.append("Le GTFS de Zenbus a été republié (feed_version %s → %s)"
                      % (ancien, courant["gtfs"]["feed_version"]))

    return ecarts


def main():
    analyseur = argparse.ArgumentParser(description=__doc__)
    analyseur.add_argument("--enregistrer", action="store_true",
                           help="fige l'état courant dans data/")
    options = analyseur.parse_args()

    courant = releve()

    if options.enregistrer:
        with open(EMPREINTES, "w", encoding="utf-8") as fichier:
            json.dump(courant, fichier, ensure_ascii=False, indent=1,
                      sort_keys=True)
            fichier.write("\n")
        print("écrit :", EMPREINTES)
        return

    if not os.path.exists(EMPREINTES):
        sys.exit("Aucun relevé de référence : lancer --enregistrer")
    with open(EMPREINTES, encoding="utf-8") as fichier:
        connu = json.load(fichier)

    ecarts = comparer(courant, connu)
    if not ecarts:
        print("Sources STC inchangées (GTFS feed_version %s)."
              % courant["gtfs"]["feed_version"])
        return

    print("Les sources publiées ont changé :")
    for ecart in ecarts:
        print("  -", ecart)
    print()
    print("Pour reprendre les horaires :")
    print("  1. mettre à jour SOURCES et version_horaire "
          "dans tools/parse_horaires.py")
    print("  2. python3 tools/parse_horaires.py --telecharger")
    print("  3. python3 tools/parse_gtfs.py --telecharger")
    print("  4. python3 tools/veiller_sources.py --enregistrer")
    print("  5. node --test tests/*.test.js && python3 tools/verifier_donnees.py")
    sys.exit(1)


if __name__ == "__main__":
    main()
