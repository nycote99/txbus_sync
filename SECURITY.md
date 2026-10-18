# Politique de sécurité

## Versions prises en charge

Sorel Transit est publié en continu depuis la branche `main` : seule la
version en ligne sur <https://nycote99.github.io/txbus_sync/> est prise en
charge. Il n'existe pas de versions maintenues en parallèle.

## Signaler une vulnérabilité

Merci de ne **pas** ouvrir d'_issue_ publique pour une vulnérabilité.
Utilisez le signalement privé de GitHub : onglet _Security_ du dépôt, puis
« Report a vulnerability ». Le signalement sera examiné dès que possible et
la correction publiée avant toute divulgation publique.

## Portée et modèle de menace

L'application est un site statique, sans serveur, sans compte et sans base de
données :

- **aucune donnée personnelle n'est collectée ni transmise** : pas de
  formulaire, pas d'analytique, pas de témoin de suivi ;
- la **géolocalisation** (« arrêts près de moi ») est calculée dans le
  navigateur ; la position ne quitte jamais l'appareil ;
- le seul appel réseau de l'application est le **flux GTFS-RT public de
  Zenbus**, interrogé en lecture seule. Ses données sont rendues dans la page
  par `textContent`, jamais par injection HTML ;
- la réservation elle-même a lieu sur le portail officiel de la STC, vers
  lequel l'application renvoie ; aucune donnée de réservation ne transite par
  ce site.

Les sujets pertinents à signaler : un contenu du flux temps réel qui
parviendrait à s'exécuter dans la page, une faille du service worker qui
servirait un contenu inattendu, ou une dépendance de développement
compromise.
