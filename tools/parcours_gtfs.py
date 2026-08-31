#!/usr/bin/env python3
"""
Parcours des lignes d'autobus, lus dans le GTFS statique de la STC.

Les fiches horaires PDF ne publient qu'une dizaine de points de passage par
ligne : ce sont des reperes, pas la liste des arrets. Le GTFS, lui, donne la
sequence complete — 43 arrets pour la ligne 10 en direction du CEGEP — avec
l'heure de chaque passage.

Mais le GTFS publie par Zenbus est fige au 28 janvier 2026, tandis que les
fiches sont datees du 17 aout : trois voyages de la ligne 10 et deux express y
ont change d'heure, et deux express ont disparu du GTFS. On ne peut donc pas
substituer le GTFS aux fiches.

D'ou le partage retenu : les fiches donnent les *heures*, le GTFS donne la
*sequence des arrets et les temps de parcours entre eux*. Les deux sources
s'accordent exactement sur ces temps de parcours (verifie sur les 126 voyages
de la ligne 10), ce qui rend la greffe sure : on recale simplement le parcours
GTFS sur l'heure publiee.
"""

import collections
import csv
import io
import math
import re
import unicodedata
import zipfile

SOURCE = "https://zenbus.net/gtfs/static/download.zip?dataset=pierre-de-saurel"

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

SERVICES = {"cal1-mon-tue-wed-thu-fri-9": "semaine",
            "cal2-sat-sun-10": "fin_de_semaine"}

# Noms que la reduction ne suffit pas a rapprocher : les fiches situent l'arret
# par sa municipalite, le GTFS par son adresse ou son sens de circulation.
ALIAS = {
    "Mairie - Saint-Roch-de-Richelieu":
        "Mairie St-Roch-de-Richelieu - 1111 rue du Parc",
    "Du Petit-Bois et de la Rivière - Varennes":
        "Du Petit-Bois et De la Rivière",
    "Campus Cégep de Sorel-Tracy - Varennes":
        "Campus Cégep Sorel-Tracy - 1555 Lionel-Boulet - Varennes",
    "Armand-Frappier / de Murano - Sainte-Julie": "Armand-Frappier/de Murano",
    "Boulevard Poliquin (Thalassa)": "Poliquin - voie de service (Thalassa)",
}

# Mots vides pour le rapprochement des noms : « Boulevard Poliquin (Thalassa) »
# sur la fiche, « Poliquin - voie de service (Thalassa) » dans le GTFS.
VIDES = re.compile(r"\b(boulevard|voie|de|du|des|la|le|les|l|d"
                   r"|embarquement|debarquement)\b")


def reduire(nom):
    """Forme reduite d'un nom d'arret, pour comparer deux nomenclatures."""
    sans_accent = "".join(c for c in unicodedata.normalize("NFD", nom)
                          if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9]", "", VIDES.sub("", sans_accent.lower()))


# Les deux sens de la ligne 10 ne nomment pas leurs arrets de la meme facon :
# « Charlotte / Phipps » a l'aller, « Charlotte/Phipps » au retour. Ce sont bien
# deux arrets distincts — les deux cotes de la rue, deux positions, deux heures
# — mais l'usager cherche une intersection, pas un trottoir. On uniformise donc
# l'ecriture pour que les deux se presentent sous le meme nom ; l'identifiant
# GTFS, lui, continue de les distinguer.
def normaliser(nom):
    """Ecriture uniforme d'un nom d'arret, pour l'affichage."""
    nom = re.sub(r"\s*/\s*", " / ", nom.strip())
    nom = re.sub(r"\s*\(\s*", " (", nom)
    nom = re.sub(r"H[oô]tel[- ]Dieu", "Hôtel-Dieu", nom)
    return re.sub(r"\s+", " ", nom)


def minutes_service(heure):
    """Minutes ecoulees depuis 03:00, debut conventionnel de la journee STC.

    Le GTFS prolonge l'heure au-dela de 24:00 pour les voyages qui debordent sur
    le lendemain ; les fiches, elles, repassent a 00:00. Les deux retombent ici
    sur la meme valeur.
    """
    h, m = int(heure[:2]), int(heure[3:5])
    if h < 3:
        h += 24
    return h * 60 + m - 180


def en_heure(minutes):
    total = (minutes + 180) % 1440
    return "%02d:%02d" % (total // 60, total % 60)


def _lire(archive, nom):
    with archive.open(nom) as brut:
        return list(csv.DictReader(io.TextIOWrapper(brut, encoding="utf-8-sig",
                                                    newline="")))


def parcours(chemin_archive):
    """Parcours par (famille, direction, service).

    Chaque parcours porte la sequence canonique des arrets — l'union des
    variantes, ordonnee par la distance parcourue — et, pour chaque voyage, le
    passage a chacun de ses arrets en minutes de service.
    """
    with zipfile.ZipFile(chemin_archive) as archive:
        routes = {r["route_id"]: r["route_short_name"]
                  for r in _lire(archive, "routes.txt")}
        arrets = {s["stop_id"]: s for s in _lire(archive, "stops.txt")}
        voyages = _lire(archive, "trips.txt")
        passages = _lire(archive, "stop_times.txt")

    par_voyage = collections.defaultdict(list)
    for passage in passages:
        par_voyage[passage["trip_id"]].append(passage)
    for liste in par_voyage.values():
        liste.sort(key=lambda p: int(p["stop_sequence"]))

    groupes = collections.defaultdict(list)
    for voyage in voyages:
        famille = FAMILLES.get(routes.get(voyage["route_id"]))
        direction = DIRECTIONS.get((voyage.get("trip_headsign") or "").strip())
        service = SERVICES.get(voyage["service_id"])
        if not (famille and direction and service):
            continue
        groupes[(famille, direction, service)].append(voyage)

    resultat = {}
    for cle, liste in groupes.items():
        distances = collections.defaultdict(list)
        construits = []
        for voyage in liste:
            etapes = par_voyage[voyage["trip_id"]]
            if not etapes:
                continue
            for etape in etapes:
                distances[etape["stop_id"]].append(
                    float(etape["shape_dist_traveled"] or 0))
            construits.append({
                "id": voyage["trip_id"],
                "passages": {e["stop_id"]: minutes_service(e["departure_time"])
                             for e in etapes},
            })
        ordre = sorted(distances, key=lambda s: sum(distances[s]) / len(distances[s]))
        construits.sort(key=lambda v: min(v["passages"].values()))
        resultat[cle] = {
            "arrets": [{"id": s, "nom": arrets[s]["stop_name"],
                        "code": arrets[s].get("stop_code") or None,
                        "lat": round(float(arrets[s]["stop_lat"]), 6),
                        "lon": round(float(arrets[s]["stop_lon"]), 6)}
                       for s in ordre],
            "voyages": construits,
        }
    return resultat


def resoudre(noms_fiche, arrets_gtfs):
    """Associe chaque nom de la fiche horaire a un arret du GTFS.

    Retourne (table, inconnus). Un nom qu'on ne sait pas rattacher est signale
    plutot que devine : la fiche a peut-etre change, et une association fausse
    contaminerait les horaires.
    """
    index = collections.defaultdict(list)
    for arret in arrets_gtfs:
        index[reduire(arret["nom"])].append(arret["id"])

    table, inconnus = {}, []
    for nom in noms_fiche:
        candidats = index.get(reduire(ALIAS.get(nom, nom)), [])
        if len(candidats) == 1:
            table[nom] = candidats[0]
        else:
            inconnus.append(nom)
    return table, inconnus


def greffer(bloc, parcours_ligne):
    """Densifie une grille de fiche horaire avec le parcours complet du GTFS.

    Les heures publiees restent la reference : on ne fait que prolonger chaque
    colonne aux arrets que la fiche passe sous silence, en recalant sur elle le
    voyage GTFS correspondant. Une colonne qu'on ne sait pas apparier — un
    voyage cree ou deplace depuis janvier — est reconduite telle quelle, avec
    ses seuls points de passage publies.

    Retourne (bloc, rapport).
    """
    noms = [arret["nom"] for arret in bloc["arrets"]]
    table, inconnus = resoudre(noms, parcours_ligne["arrets"])
    if inconnus:
        raise ValueError("arrêts de la fiche introuvables dans le GTFS : %s"
                         % ", ".join(inconnus))
    connus = set(table.values())

    colonnes = len(bloc["arrets"][0]["heures"])
    publiees = []
    for colonne in range(colonnes):
        heures = {}
        for arret in bloc["arrets"]:
            heure = arret["heures"][colonne]
            if heure:
                heures[table[arret["nom"]]] = minutes_service(heure)
        publiees.append(heures)

    apparies = _aligner(publiees, connus, parcours_ligne["voyages"])

    dense = {arret["id"]: [None] * colonnes for arret in parcours_ligne["arrets"]}
    for colonne, voyage in enumerate(apparies):
        heures = publiees[colonne]
        if voyage is None:
            for identifiant, minutes in heures.items():
                dense[identifiant][colonne] = en_heure(minutes)
            continue
        repere = next(iter(heures))
        decalage = heures[repere] - voyage["passages"][repere]
        for identifiant, minutes in voyage["passages"].items():
            dense[identifiant][colonne] = en_heure(minutes + decalage)

    # Post-condition : la greffe prolonge la fiche, elle ne la corrige jamais.
    # Le GTFS date de janvier ; si jamais un de ses horaires venait a ecraser
    # une heure publiee en aout, mieux vaut ne rien publier du tout.
    for colonne, heures in enumerate(publiees):
        for identifiant, minutes in heures.items():
            if dense[identifiant][colonne] != en_heure(minutes):
                raise ValueError(
                    "la greffe a modifié une heure publiée : colonne %d, "
                    "%s au lieu de %s" % (colonne, dense[identifiant][colonne],
                                          en_heure(minutes)))

    resultat = dict(bloc)
    resultat["arrets"] = [
        {"nom": normaliser(arret["nom"]), "id": arret["id"],
         "heures": dense[arret["id"]]}
        for arret in parcours_ligne["arrets"]
        if any(dense[arret["id"]])
    ]
    resultat["voyages_gtfs"] = [v["id"] if v else None for v in apparies]
    return resultat, {
        "arrets_fiche": len(noms),
        "arrets_dense": len(resultat["arrets"]),
        "colonnes": colonnes,
        "colonnes_appariees": sum(1 for v in apparies if v),
    }


# Au-dela de cet ecart, une colonne de la fiche et un voyage du GTFS ne
# decrivent plus le meme depart : la ligne 10 passe toutes les dix minutes aux
# heures de pointe, et un voyage supprime ne doit pas se faire adopter par son
# voisin. La penalite d'abandon vaut la moitie de l'ecart maximal : apparier
# deux departs coute alors moins cher que de les laisser tous deux orphelins
# tant qu'ils sont a moins de vingt minutes l'un de l'autre.
ECART_MAX = 20
ABANDON = ECART_MAX / 2


def _aligner(publiees, connus, voyages):
    """Apparie les colonnes de la fiche aux voyages du GTFS, dans l'ordre.

    Les deux listes decrivent la meme journee mais pas tout a fait la meme
    offre : le GTFS de janvier ignore deux express ajoutes depuis, et decale de
    cinq minutes trois departs. On cherche donc l'appariement croissant le moins
    couteux plutot qu'une correspondance terme a terme, qui deraperait d'un cran
    a la premiere difference.
    """
    ordonnes = sorted(voyages, key=lambda v: min(v["passages"].values()))
    infini = float("inf")
    cout = [[infini] * len(ordonnes) for _ in publiees]
    for i, heures in enumerate(publiees):
        for j, voyage in enumerate(ordonnes):
            cout[i][j] = _cout(heures, connus, voyage)

    # Alignement par programmation dynamique : chaque colonne est appariee au
    # voyage suivant, ou abandonnee, sans jamais revenir en arriere.
    total = [[0.0] * (len(ordonnes) + 1) for _ in range(len(publiees) + 1)]
    for i in range(1, len(publiees) + 1):
        total[i][0] = total[i - 1][0] + ABANDON
    for j in range(1, len(ordonnes) + 1):
        total[0][j] = total[0][j - 1] + ABANDON
    for i in range(1, len(publiees) + 1):
        for j in range(1, len(ordonnes) + 1):
            total[i][j] = min(total[i - 1][j] + ABANDON,
                              total[i][j - 1] + ABANDON,
                              total[i - 1][j - 1] + cout[i - 1][j - 1])

    resultat = [None] * len(publiees)
    i, j = len(publiees), len(ordonnes)
    while i > 0 and j > 0:
        if total[i][j] == total[i - 1][j - 1] + cout[i - 1][j - 1]:
            resultat[i - 1] = ordonnes[j - 1]
            i, j = i - 1, j - 1
        elif total[i][j] == total[i - 1][j] + ABANDON:
            i -= 1
        else:
            j -= 1
    return resultat


def _cout(heures, connus, voyage):
    """Ecart entre une colonne et un voyage, ou l'infini s'ils sont inconciliables.

    Le voyage doit desservir tous les arrets ou la fiche annonce une heure, et
    aucun autre de ceux qu'elle sait nommer : sans cette seconde condition, un
    express qui s'arrete a Saint-Roch se ferait passer pour celui qui file tout
    droit.
    """
    if not heures:
        return float("inf")
    desservis = set(voyage["passages"])
    if not set(heures) <= desservis or desservis & connus != set(heures):
        return float("inf")
    decalages = {minutes - voyage["passages"][identifiant]
                 for identifiant, minutes in heures.items()}
    if len(decalages) != 1:
        return float("inf")
    ecart = abs(next(iter(decalages)))
    return ecart if ecart <= ECART_MAX else float("inf")


# --- Traces des parcours -----------------------------------------------------
#
# Le GTFS decrit chaque parcours par sa polyligne : 5654 points au total, 354 ko
# bruts. On n'embarque pas cela pour dessiner une carte de la taille d'un
# telephone.
#
# Deux reductions, toutes deux mesurees plutot que devinees :
#   1. un seul trace par direction, celui que suivent le plus de voyages. La
#      ligne 10 n'en a de toute facon qu'un par sens (ses 63 voyages le
#      partagent) ; les express en ont quatre variantes qui ne different que par
#      l'arret desservi a Varennes, et le representatif en couvre 42 sur 49.
#      Le detour de Saint-Roch n'est donc pas dessine — les vehicules, eux, sont
#      places a leur position GPS reelle et non projetes sur le trace.
#   2. une simplification de Douglas-Peucker a dix metres. A 390 px de large, la
#      boucle urbaine fait quinze metres par pixel : l'ecart reste sous le
#      pixel. Il reste 398 points et 8 ko.
TOLERANCE_METRES = 10

# Metres par degre a 46° N. La longitude est comprimee par le cosinus de la
# latitude ; l'ignorer etirerait le reseau d'un tiers en largeur.
METRES_PAR_DEGRE_LAT = 111132.0
METRES_PAR_DEGRE_LON = 111320.0 * math.cos(math.radians(46.03))


def _distance_au_segment(point, debut, fin):
    """Distance en metres d'un point au segment [debut, fin]."""
    ax = (debut[1] - point[1]) * METRES_PAR_DEGRE_LON
    ay = (debut[0] - point[0]) * METRES_PAR_DEGRE_LAT
    bx = (fin[1] - point[1]) * METRES_PAR_DEGRE_LON
    by = (fin[0] - point[0]) * METRES_PAR_DEGRE_LAT
    dx, dy = bx - ax, by - ay
    if dx == 0 and dy == 0:
        return math.hypot(ax, ay)
    part = max(0.0, min(1.0, -(ax * dx + ay * dy) / (dx * dx + dy * dy)))
    return math.hypot(ax + part * dx, ay + part * dy)


def simplifier(points, tolerance=TOLERANCE_METRES):
    """Douglas-Peucker : retire les points qui ne changent pas le trace."""
    if len(points) < 3:
        return list(points)
    pire, rang = 0.0, 0
    for i in range(1, len(points) - 1):
        ecart = _distance_au_segment(points[i], points[0], points[-1])
        if ecart > pire:
            pire, rang = ecart, i
    if pire <= tolerance:
        return [points[0], points[-1]]
    return (simplifier(points[:rang + 1], tolerance)[:-1]
            + simplifier(points[rang:], tolerance))


def traces(chemin_archive, tolerance=TOLERANCE_METRES):
    """Trace representatif de chaque (famille, direction), simplifie."""
    with zipfile.ZipFile(chemin_archive) as archive:
        routes = {r["route_id"]: r["route_short_name"]
                  for r in _lire(archive, "routes.txt")}
        voyages = _lire(archive, "trips.txt")
        polylignes = collections.defaultdict(list)
        for point in _lire(archive, "shapes.txt"):
            polylignes[point["shape_id"]].append((
                int(point["shape_pt_sequence"]),
                float(point["shape_pt_lat"]),
                float(point["shape_pt_lon"])))

    for liste in polylignes.values():
        liste.sort()

    frequences = collections.Counter()
    for voyage in voyages:
        famille = FAMILLES.get(routes.get(voyage["route_id"]))
        direction = DIRECTIONS.get((voyage.get("trip_headsign") or "").strip())
        if famille and direction and voyage.get("shape_id"):
            frequences[(famille, direction, voyage["shape_id"])] += 1

    retenus = {}
    for (famille, direction, forme), nombre in frequences.items():
        cle = "%s|%s" % (famille, direction)
        if cle not in retenus or nombre > retenus[cle][1]:
            retenus[cle] = (forme, nombre)

    resultat = {}
    for cle, (forme, _) in sorted(retenus.items()):
        points = [(lat, lon) for _, lat, lon in polylignes[forme]]
        resultat[cle] = [[round(lat, 5), round(lon, 5)]
                         for lat, lon in simplifier(points, tolerance)]
    return resultat
