#!/usr/bin/env python3
"""
Extraction des horaires officiels de la STC Pierre-De Saurel (PDF -> JSON).

Les PDF publies par la STC sont des tableaux ou chaque colonne est un depart.
Certains arrets ne sont desservis que par quelques departs, donc l'alignement
se fait par position horizontale (x) et non par ordre d'apparition.

Usage:
    python3 tools/parse_horaires.py --telecharger
    python3 tools/parse_horaires.py            # utilise le cache tools/.pdf-cache
"""

import argparse
import json
import os
import re
import subprocess
import sys

import parcours_gtfs

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(RACINE, "tools", ".pdf-cache")
ARCHIVE_GTFS = os.path.join(CACHE, "gtfs.zip")

SOURCES = {
    "ligne10": "https://stcpierredesaurel.ca/wp-content/uploads/2026/08/20260817_Horaire_ligne10_VF.pdf",
    "express": "https://stcpierredesaurel.ca/wp-content/uploads/2026/08/20260817_Horaire_express_VF.pdf",
    "taxibus-zone-1": "https://stcpierredesaurel.ca/wp-content/uploads/2026/07/Taxibus-zone-1.pdf",
    "taxibus-zone-2": "https://stcpierredesaurel.ca/wp-content/uploads/2026/07/Taxibus-zone-2.pdf",
    "taxibus-zone-3": "https://stcpierredesaurel.ca/wp-content/uploads/2026/07/Taxibus-Zone-3.pdf",
    "taxibus-zone-4": "https://stcpierredesaurel.ca/wp-content/uploads/2026/07/Taxibus-zone-4.pdf",
}

RE_HEURE = re.compile(r"^([0-9]{1,2}):([0-5][0-9])$")


def telecharger():
    os.makedirs(CACHE, exist_ok=True)
    for nom, url in SOURCES.items():
        cible = os.path.join(CACHE, nom + ".pdf")
        subprocess.run(["curl", "-sSL", "-o", cible, url], check=True)
        print("telecharge:", nom)
    # Le GTFS fournit le parcours complet des lignes d'autobus.
    subprocess.run(["curl", "-sSL", "-o", ARCHIVE_GTFS, parcours_gtfs.SOURCE],
                   check=True)
    print("telecharge: gtfs.zip")


def lignes_de_mots(page):
    """Regroupe les mots de la page en lignes visuelles, tries par x."""
    mots = page.extract_words(use_text_flow=False, keep_blank_chars=False)
    lignes = []
    for mot in sorted(mots, key=lambda m: (round(m["top"], 1), m["x0"])):
        centre = (mot["top"] + mot["bottom"]) / 2
        for ligne in lignes:
            if abs(ligne["centre"] - centre) <= 3.5:
                ligne["mots"].append(mot)
                break
        else:
            lignes.append({"centre": centre, "mots": [mot]})
    for ligne in lignes:
        ligne["mots"].sort(key=lambda m: m["x0"])
        ligne["texte"] = " ".join(m["text"] for m in ligne["mots"])
    lignes.sort(key=lambda l: l["centre"])
    return lignes


def heures_de_ligne(ligne, x_min=0):
    """Retourne [(x_centre, 'HH:MM')] pour les mots-heures a droite de x_min."""
    trouve = []
    for mot in ligne["mots"]:
        if mot["x0"] < x_min:
            continue
        m = RE_HEURE.match(mot["text"])
        if m:
            hh, mm = int(m.group(1)), m.group(2)
            trouve.append(((mot["x0"] + mot["x1"]) / 2, "%02d:%s" % (hh, mm)))
    return trouve


def libelle_de_ligne(ligne):
    """Texte de la ligne avant la premiere heure (le nom de l'arret)."""
    parts = []
    for mot in ligne["mots"]:
        if RE_HEURE.match(mot["text"]):
            break
        parts.append(mot["text"])
    return " ".join(parts).strip()


def aligner(colonnes, heures):
    """Place chaque heure dans la colonne dont le centre x est le plus proche."""
    resultat = [None] * len(colonnes)
    for x, valeur in heures:
        i = min(range(len(colonnes)), key=lambda k: abs(colonnes[k] - x))
        if abs(colonnes[i] - x) <= 22 and resultat[i] is None:
            resultat[i] = valeur
    return resultat


def blocs_de_page(page, entetes, ignorer):
    """
    Decoupe une page en blocs de direction.

    entetes : liste de (prefixe_du_titre, identifiant). Les feuilles STC placent
    a droite du tableau une colonne de jours feries : on borne donc la lecture
    des libelles a la gauche de la premiere colonne d'heures.
    Retourne [{ "id", "vehicules": [...], "arrets": [{"nom", "heures_brutes"}] }]
    """
    lignes = lignes_de_mots(page)
    # Bord gauche du tableau : deduit des lignes d'horaire les plus fournies,
    # pour que la colonne des jours feries (a droite) ne pollue pas les libelles.
    denses = [heures_de_ligne(l) for l in lignes]
    denses = [h for h in denses if len(h) >= 8]
    x_table = min((min(x for x, _ in h) for h in denses), default=None)
    blocs, courant, fragment = [], None, ""

    for ligne in lignes:
        texte = ligne["texte"]
        haut = texte.upper()

        titre = next((ident for prefixe, ident in entetes
                      if haut.startswith(prefixe)), None)
        if titre:
            courant = {"id": titre, "arrets": [],
                       "vehicules": re.findall(r"\b(75[0-3])\b", texte)}
            blocs.append(courant)
            fragment, x_table = "", None
            continue

        if courant is None:
            continue

        heures = [h for h in heures_de_ligne(ligne) if h[0] >= (x_table or 0) - 4]
        limite = (x_table - 4) if x_table else 1e9
        libelle = libelle_gauche(ligne, limite)

        if not heures:
            fragment = "" if est_parasite(libelle, ignorer) else libelle
            continue

        nom = libelle or fragment
        fragment = ""
        if not nom or est_parasite(nom, ignorer):
            continue
        courant["arrets"].append({"nom": nettoyer(nom), "heures_brutes": heures})

    return [b for b in blocs if b["arrets"]]


def libelle_gauche(ligne, limite):
    """Mots de la ligne situes a gauche du tableau et avant la premiere heure."""
    parts = []
    for mot in ligne["mots"]:
        if mot["x1"] > limite:
            break
        if RE_HEURE.match(mot["text"]):
            break
        parts.append(mot["text"])
    return " ".join(parts).strip()


def est_parasite(libelle, ignorer):
    if not libelle:
        return True
    haut = libelle.upper()
    return any(motif in haut for motif in ignorer)


ALIAS_ARRETS = {
    "Terminus Longueuil": "Terminus Longueuil (porte A7)",
    "Armand-Frappier et de Murano": "Armand-Frappier / de Murano - Sainte-Julie",
    "Campus Cégep de Sorel-Tracy": "Campus Cégep de Sorel-Tracy - Varennes",
}


def nettoyer(nom):
    """Normalise un libelle d'arret et retire les debordements de mise en page."""
    nom = re.sub(r"\s+", " ", nom).replace("\u2013", "-").strip()
    # La colonne des jours feries chevauche parfois la colonne des arrets.
    for ferie in FERIES:
        motif = re.escape(ferie["nom"].upper()).replace("\\ ", r"\s+")
        nom = re.sub(motif + r"\s*\d?", "", nom, flags=re.IGNORECASE)
    nom = re.sub(r"\s+", " ", nom).strip(" -,")
    return ALIAS_ARRETS.get(nom, nom)


def grille(bloc):
    """Aligne tous les arrets d'un bloc sur les colonnes du premier arret."""
    colonnes = [x for x, _ in bloc["arrets"][0]["heures_brutes"]]
    arrets = []
    for arret in bloc["arrets"]:
        arrets.append({"nom": arret["nom"], "heures": aligner(colonnes, arret["heures_brutes"])})
    vehicules = bloc["vehicules"]
    if len(vehicules) != len(colonnes):
        vehicules = []
    return {"id": bloc["id"], "vehicules": vehicules, "arrets": arrets,
            "departs": len(colonnes)}


IGNORER_COMMUN = [
    "L’HORAIRE", "L'HORAIRE", "INFORMATIONS UTILES", "SUIVEZ", "VÉHICULE •",
    "EN DIRECT", "TERMINUS DES PROMENADES - STC :", "RÉSERVATION",
    "PERTURBATIONS", "TRANSPORT DE PERSONNES", "TRANSPORT AVEC",
    "BIENVENUE AUX", "LE TRANSPORT DES", "IL EST POSSIBLE",
    "HEURE DE PASSAGE", "DIRECTION LONGUEUIL", "DIRECTION SOREL-TRACY",
    "CORRESPONDANCE", "SEULEMENT", "TNEMEUQRAB", "PORTE A7 DIRECTION",
    "DÉPARTS À L", "DEPARTS À L", "DÉPART S À L", "ZONE ", "CODE",
    "AUCUN DÉPART", "LE SECTEUR", "LE TERMINUS", "•", "SEMAINE, EXCLUANT",
]


def extraire_ligne10(pdf):
    entetes = [("10 | DIRECTION CEGEP", "cegep"),
               ("10 | DIRECTION TERMINUS", "terminus")]
    resultat = {}
    for page, service in ((0, "semaine"), (1, "fin_de_semaine")):
        blocs = blocs_de_page(pdf.pages[page], entetes, IGNORER_COMMUN)
        resultat[service] = {b["id"]: {"arrets": b["arrets"]} for b in
                             (grille(b) for b in blocs)}
    return resultat


def extraire_express(pdf):
    entetes = [("DIRECTION LONGUEUIL 750", "longueuil"),
               ("DIRECTION SOREL-TRACY 750", "sorel")]
    ignorer = [m for m in IGNORER_COMMUN
               if m not in ("DIRECTION LONGUEUIL", "DIRECTION SOREL-TRACY")]
    resultat = {}
    for page, service in ((0, "semaine"), (1, "fin_de_semaine")):
        blocs = [grille(b) for b in
                 blocs_de_page(pdf.pages[page], entetes, ignorer)]
        resultat[service] = {b["id"]: {"arrets": b["arrets"],
                                       "circuits": b["vehicules"]}
                             for b in blocs}
    return resultat


def extraire_taxibus(pdf, zone_fichier):
    """
    Les feuilles taxibus listent, par type de jour, des groupes de departs
    "zone d'origine -> zones de destination autorisees". Chaque groupe est un
    titre suivi d'une ou deux lignes d'heures.
    """
    groupes, service, courant = [], "semaine", None

    for page in pdf.pages:
        for ligne in lignes_de_mots(page):
            texte = re.sub(r"\s+", " ", ligne["texte"]).strip()
            haut = texte.upper()

            if haut.startswith("LUNDI AU VENDREDI"):
                service, courant = "semaine", None
                continue
            if haut.startswith("SAMEDI, DIMANCHE"):
                service, courant = "fin_de_semaine", None
                continue

            if re.match(r"^D[ÉE]PART\s?S?\s+À\s+L", haut) and "ORIGINE" in haut:
                origines, destinations = zones_du_titre(haut, zone_fichier)
                courant = {"service": service, "libelle": texte,
                           "origines": origines, "destinations": destinations,
                           "heures": []}
                groupes.append(courant)
                continue

            if courant is None:
                continue
            if libelle_de_ligne(ligne):        # ligne de texte : fin du groupe
                continue
            courant["heures"].extend(v for _, v in heures_de_ligne(ligne))

    for groupe in groupes:
        groupe["heures"] = trier_heures(groupe["heures"])
    return [g for g in groupes if g["heures"]]


RE_ZONE = re.compile(r"\b([1-4])\s*-?\s*([AB])?\b")


def zones_du_titre(haut, zone_fichier):
    """Separe zones d'origine et zones de destination dans un titre de groupe."""
    if "DESTINATION" in haut:
        avant, apres = haut.split("DESTINATION", 1)
    else:
        avant, apres = haut, ""
    origines = codes_zones(avant)
    destinations = codes_zones(apres)
    if not origines:
        # "À L'ORIGINE ET À DESTINATION DE LA ZONE 1" : origine implicite
        origines = destinations or [str(zone_fichier)]
    if not destinations:
        destinations = list(origines)
    return origines, destinations


def codes_zones(fragment):
    codes = []
    for numero, lettre in RE_ZONE.findall(fragment):
        code = numero + ("-" + lettre if lettre else "")
        if code not in codes:
            codes.append(code)
    return codes


def minutes_service(heure):
    """Minutes ecoulees depuis 03:00, debut conventionnel de la journee STC."""
    h, m = int(heure[:2]), int(heure[3:])
    if h < 3:
        h += 24
    return h * 60 + m - 180


def trier_heures(heures):
    return sorted(set(heures), key=minutes_service)


# --- Referentiel statique (source : fiches horaires et grille tarifaire STC) ---

ZONES = [
    {"code": "1", "nom": "Zone 1",
     "municipalites": ["Sorel-Tracy", "Saint-Joseph-de-Sorel",
                       "Sainte-Anne-de-Sorel"],
     "arrets": "1 à 4999 (Sorel-Tracy et Saint-Joseph-de-Sorel), "
               "900 à 999 (Sainte-Anne-de-Sorel)"},
    {"code": "2-A", "nom": "Zone 2-A",
     "municipalites": ["Saint-Roch-de-Richelieu"], "arrets": "5000"},
    {"code": "2-B", "nom": "Zone 2-B",
     "municipalites": ["Sainte-Victoire-de-Sorel", "Saint-Ours", "Yamaska",
                       "Saint-Robert"],
     "arrets": "5500, 6000, 6500, 7000"},
    {"code": "3", "nom": "Zone 3",
     "municipalites": ["Massueville", "Saint-Aimé", "Saint-David",
                       "Saint-Gérard-Majella"],
     "arrets": "7500, 8000, 8500, 9000"},
    {"code": "4-A", "nom": "Zone 4-A",
     "municipalites": ["Contrecœur"],
     "arrets": "9500 (résidentiel), 9501 (industriel), 9502 à 9899 (arrêts fixes)"},
    {"code": "4-B", "nom": "Zone 4-B",
     "municipalites": ["Saint-Antoine-sur-Richelieu"], "arrets": "9900"},
]

# Zone de taxibus dans laquelle se trouve chaque arret d'autobus. Sert a
# enchainer un trajet en autobus avec un depart de taxibus : c'est la zone
# d'arrivee qui determine les departs disponibles et leur heure limite.
# `None` signale un arret hors du territoire desservi par le taxibus.
# --- Zones de taxibus des arrets d'autobus ---------------------------------
#
# La ligne 10 est le circuit urbain : ses quarante-trois arrets sont tous dans
# Sorel-Tracy, donc tous en zone 1. L'enumerer arret par arret n'apprendrait
# rien et se perimerait au premier arret ajoute ; on pose la regle.
ZONE_LIGNE10 = "1"

# Les express, eux, sortent du territoire. Chaque arret est donc nomme, et
# `None` marque ceux qu'aucun taxibus ne dessert : le trajet s'y arrete.
ZONES_DES_ARRETS_EXPRESS = {
    "Terminus des Promenades - STC": "1",
    "Stationnement incitatif de la Plaza Tracy": "1",
    "De la Plaza / De Tracy": "1",
    "Autoroute 30 / De Tracy": "1",
    "Mairie St-Roch-de-Richelieu - 1111 rue du Parc": "2-A",
    "Du Petit-Bois et De la Rivière (embarquement)": None,
    "Du Petit-Bois et De la Rivière (débarquement)": None,
    "Campus Cégep Sorel-Tracy - 1555 Lionel-Boulet - Varennes (embarquement)": None,
    "Campus Cégep Sorel-Tracy - 1555 Lionel-Boulet - Varennes (débarquement)": None,
    "Armand-Frappier / de Murano": None,
    "Terminus Longueuil (porte A7)": None,
}


def zones_des_arrets(horaires):
    """Zone de taxibus de chaque arret d'autobus, deduite des grilles greffees.

    Un arret express absent de la table arrete la construction : mieux vaut
    refuser de publier que de laisser croire qu'aucun taxibus ne le prolonge.
    """
    resultat = {}
    for famille, services in (("ligne10", horaires["ligne10"]),
                              ("express", horaires["express"])):
        for blocs in services.values():
            for bloc in blocs.values():
                for arret in bloc["arrets"]:
                    if famille == "ligne10":
                        resultat.setdefault(arret["nom"], ZONE_LIGNE10)
                    elif arret["nom"] in ZONES_DES_ARRETS_EXPRESS:
                        resultat[arret["nom"]] = ZONES_DES_ARRETS_EXPRESS[arret["nom"]]
                    else:
                        raise ValueError("arrêt express sans zone : %s"
                                         % arret["nom"])
    return resultat


FERIES = [
    {"cle": "jour_de_lan", "nom": "Jour de l’An", "terminus_ouvert": False},
    {"cle": "lendemain_jour_de_lan", "nom": "Lendemain du Jour de l’An",
     "terminus_ouvert": True},
    {"cle": "vendredi_saint", "nom": "Vendredi saint", "terminus_ouvert": True},
    {"cle": "paques", "nom": "Dimanche de Pâques", "terminus_ouvert": False},
    {"cle": "lundi_paques", "nom": "Lundi de Pâques", "terminus_ouvert": True},
    {"cle": "patriotes", "nom": "Fête des Patriotes", "terminus_ouvert": True},
    {"cle": "fete_nationale", "nom": "Fête nationale", "terminus_ouvert": False},
    {"cle": "fete_canada", "nom": "Fête du Canada", "terminus_ouvert": True},
    {"cle": "fete_travail", "nom": "Fête du Travail", "terminus_ouvert": True},
    {"cle": "action_de_grace", "nom": "Action de grâce", "terminus_ouvert": True},
    {"cle": "veille_noel", "nom": "Veille de Noël", "terminus_ouvert": True},
    {"cle": "noel", "nom": "Noël", "terminus_ouvert": False},
    {"cle": "lendemain_noel", "nom": "Lendemain de Noël", "terminus_ouvert": True},
    {"cle": "veille_jour_de_lan", "nom": "Veille du Jour de l’An",
     "terminus_ouvert": True},
]

TERMINUS = {
    "nom": "Terminus des Promenades - STC",
    "adresse": "450, boulevard Poliquin, local 650, Sorel-Tracy (Québec) J3P 7R5",
    "telephone": "450 743-3336",
    "sans_frais": "1 833 703-3336",
    "courriel": "info@stcpierredesaurel.ca",
    "heures": {"semaine": {"ouverture": "06:00", "fermeture": "20:30"},
               "fin_de_semaine": {"ouverture": "08:15", "fermeture": "16:45"}},
}

LIENS = {
    "site": "https://stcpierredesaurel.ca/",
    "reservation": "https://stc.accestaxi.com/",
    "inscription": "https://stc.accestaxi.com/index.aspx?Action=Inscription",
    "suivi": "https://stcpierredesaurel.ca/suivre-mon-vehicule/",
    "tarifs": "https://stcpierredesaurel.ca/tarifs-et-billetterie/grille-tarifaire-2026/",
    "boutique": "https://stcpierredesaurel.ca/tarifs-et-billetterie/boutique-en-ligne/",
    "reglements": "https://stcpierredesaurel.ca/a-propos/reglements/",
    "transport_adapte": "https://stcpierredesaurel.ca/nos-services/transport-adapte/",
    "taxibus": "https://stcpierredesaurel.ca/nos-services/taxibus-regional/",
}

# Grille tarifaire 2026 (regulier / reduit), en dollars canadiens.
TARIFS = {
    "note": "Le tarif réduit s’applique aux profils admissibles (enfants, "
            "étudiants, aînés) confirmés par la STC.",
    "titres": [
        {"nom": "1 passage payé à bord", "regulier": 5.00, "reduit": 3.00,
         "services": ["Taxibus", "Express", "Ligne 10"]},
        {"nom": "1 passage sur carte d’accès", "regulier": 4.50, "reduit": 2.75,
         "services": ["Taxibus", "Express"]},
        {"nom": "10 passages", "regulier": 41.00, "reduit": 24.50,
         "services": ["Taxibus", "Express"]},
        {"nom": "25 passages", "regulier": 91.25, "reduit": 54.75,
         "services": ["Taxibus", "Express"]},
        {"nom": "Passe dynamique 7 jours", "regulier": 22.25, "reduit": 13.25,
         "services": ["Taxibus", "Express"]},
        {"nom": "Passe mensuelle illimitée", "regulier": 90.25, "reduit": 54.25,
         "services": ["Taxibus", "Express"]},
        {"nom": "Passe mensuelle flexible (tous les services)",
         "regulier": 162.50, "reduit": 97.50, "services": ["Tous"]},
    ],
    "ligne10_gratuite": "La ligne 10 est gratuite depuis le 1er mai 2026 : "
                        "présentez simplement votre carte d’accès au valideur.",
    "penalites_absence": [
        {"zones": "Zone 1", "regulier": 15.00, "reduit": 9.00},
        {"zones": "Zones 2-A, 2-B et 3", "regulier": 25.00, "reduit": 15.00},
        {"zones": "Zones 4-A et 4-B", "regulier": 30.00, "reduit": 18.00},
    ],
}

REGLES = {
    "reservation_minutes_avant": 30,
    "annulation_minutes_avant": 30,
    "reservation_max_telephone_jours": 7,
    "reservation_max_en_ligne_jours": 14,
    "presence_minutes_avant": 2,
    "fenetre_embarquement_minutes": 20,
    "ligne10_presence_minutes_avant": 5,
    "note_soiree": "Pour les départs du soir et du lendemain matin, la "
                   "réservation doit être faite avant la fermeture du "
                   "Terminus des Promenades - STC.",
}


def greffer_parcours(donnees):
    """Prolonge les grilles des fiches horaires aux arrets absents des fiches.

    Les fiches ne publient qu'une dizaine de points de passage ; le GTFS connait
    le parcours complet. Voir tools/parcours_gtfs.py pour le partage des roles
    entre les deux sources — les heures viennent des fiches, la sequence des
    arrets du GTFS.
    """
    parcours = parcours_gtfs.parcours(ARCHIVE_GTFS)
    for famille in ("ligne10", "express"):
        for service, blocs in donnees[famille].items():
            for direction, bloc in blocs.items():
                cle = (famille, direction, service)
                if cle not in parcours:
                    raise ValueError("parcours GTFS absent : %s" % (cle,))
                blocs[direction], rapport = parcours_gtfs.greffer(
                    bloc, parcours[cle])
                print("greffé : %-8s %-14s %-10s %2d → %2d arrêts, "
                      "%2d/%2d voyages appariés"
                      % (famille, service, direction, rapport["arrets_fiche"],
                         rapport["arrets_dense"], rapport["colonnes_appariees"],
                         rapport["colonnes"]))


def construire():
    import pdfplumber
    donnees = {
        "version_horaire": "17 août 2026",
        "sources": SOURCES,
        "terminus": TERMINUS,
        "liens": LIENS,
        "regles": REGLES,
        "zones": ZONES,
        "tarifs": TARIFS,
        "feries": FERIES,
    }
    with pdfplumber.open(os.path.join(CACHE, "ligne10.pdf")) as pdf:
        donnees["ligne10"] = extraire_ligne10(pdf)
    with pdfplumber.open(os.path.join(CACHE, "express.pdf")) as pdf:
        donnees["express"] = extraire_express(pdf)

    greffer_parcours(donnees)
    donnees["zones_des_arrets"] = zones_des_arrets(donnees)

    taxibus = []
    for zone in (1, 2, 3, 4):
        chemin = os.path.join(CACHE, "taxibus-zone-%d.pdf" % zone)
        with pdfplumber.open(chemin) as pdf:
            taxibus.extend(extraire_taxibus(pdf, zone))
    donnees["taxibus"] = taxibus
    return donnees


def main():
    analyseur = argparse.ArgumentParser(description=__doc__)
    analyseur.add_argument("--telecharger", action="store_true",
                           help="retelecharger les PDF officiels avant analyse")
    analyseur.add_argument("--sortie",
                           default=os.path.join(RACINE, "data", "horaires.json"))
    options = analyseur.parse_args()

    if options.telecharger:
        telecharger()
    if not os.path.isdir(CACHE):
        sys.exit("Cache PDF absent : relancer avec --telecharger")

    donnees = construire()
    os.makedirs(os.path.dirname(options.sortie), exist_ok=True)
    with open(options.sortie, "w", encoding="utf-8") as fichier:
        json.dump(donnees, fichier, ensure_ascii=False, indent=1)
        fichier.write("\n")
    print("écrit :", options.sortie)


if __name__ == "__main__":
    main()
