# Portefeuille Demo

Application Node.js de portefeuille fictif et de controle d'identite avec interface client, tableau admin et stockage PostgreSQL.

Version applicative actuelle : 1.1.2. La page `/privacy.html` explique la collecte, la duree de suivi, le stockage hors connexion, la retention et les controles disponibles. Elle est incluse dans le cache PWA.

La demande GPS est lancee des l'ouverture d'un depot ou d'un transfert simule. Une autorisation accordee est enregistree immediatement et diffusee au tableau admin par Server-Sent Events. Un refus est conserve comme etat sans coordonnees.

Le controle d'identite peut demarrer automatiquement a l'ouverture de la page avec `AUTO_VERIFICATION_ON_LOAD=true`. Le navigateur conserve toujours le dernier mot : l'utilisateur doit accepter ses demandes natives de localisation et de camera. Apres accord, la photo est capturee et envoyee sans clic supplementaire.

Apres autorisation, `watchPosition` maintient un suivi visible et interrompable pendant 15 minutes par defaut, tant que la page reste ouverte. Les points sont espaces selon le temps ou la distance et rattaches a la reference initiale par un identifiant de session.

Le serveur verifie aussi cette liaison : un point GPS est refuse si sa reference ou sa session ne correspond pas a la verification initiale, ou si son heure de capture depasse la periode autorisee. L'heure reelle `captured_at` est conservee afin que les points pris hors connexion restent synchronisables plus tard. Lors de cette synchronisation, les references temporaires locales sont automatiquement remplacees par les references definitives du serveur.

Chaque envoi client possede aussi un `client_request_id` unique. Si une reponse reseau est perdue et que la PWA renvoie la collecte, PostgreSQL retourne la verification deja creee au lieu de dupliquer la photo, la position ou le point de trajet.

## Demarrage local

1. Installez Node.js 20+ et PostgreSQL.
2. Copiez `.env.example` vers `.env` et renseignez les identifiants PostgreSQL.
3. Creez la base indiquee par `DB_NAME` si elle n'existe pas.
4. Executez `npm ci`, puis `npm run init-db`.
5. Lancez `npm start` et ouvrez `http://localhost:3000`.

Si Docker est installe, `npm run db:up` demarre PostgreSQL 16 avec un volume permanent en utilisant les variables `DB_*` de `.env`. Attendez que le conteneur soit sain, executez `npm run init-db`, puis redemarrez l'application. `PHOTO_STORAGE=database` conserve alors les photos compressees dans PostgreSQL. `npm run db:down` arrete le service sans supprimer le volume.

Sous Windows, une instance PostgreSQL 18 dediee peut aussi etre conservee dans `.postgres-data/` sur le port 5433. Utilisez `npm run db:local:start`, `npm run db:local:status` et `npm run db:local:stop`. Cette instance reste limitee a `127.0.0.1`, utilise SCRAM-SHA-256 et ne modifie pas le service PostgreSQL systeme sur le port 5432.

Pour demarrer toute l'application en une seule fois sous Windows, utilisez `npm run app:local`. Cette commande demarre PostgreSQL, applique le schema et lance le serveur Web. `npm run db:backup` cree une sauvegarde datee de la base, photos comprises, dans le dossier local ignore `.backups/`. `npm run db:backup:verify` restaure la derniere archive dans une base temporaire, controle les tables essentielles puis supprime uniquement cette base de verification.

`DATA_RETENTION_DAYS` fixe la duree de conservation des verifications. Une purge automatique est executee au demarrage puis chaque jour, et une purge manuelle controlee est disponible dans l'administration. Une valeur `0` desactive la purge. `BACKUP_RETENTION_DAYS` controle la rotation des archives creees par `npm run db:backup` ; seules les archives `wave-verification-*.dump` du dossier `.backups/` sont concernees.

Le tableau admin est disponible sur `http://localhost:3000/admin`. `npm run init-db` cree le compte avec `ADMIN_USERNAME` et `ADMIN_PASSWORD` lors de la premiere initialisation, mais conserve ensuite le mot de passe modifie dans l'interface. Pour une reinitialisation volontaire, lancez exceptionnellement l'initialisation avec `ADMIN_RESET_PASSWORD=true`, puis remettez cette valeur a `false`.

Le tableau affiche l'etat operationnel, le volume des photos, le trajet GPS en direct et les actions administratives recentes. La carte OpenStreetMap reste desactivee tant que l'administrateur ne clique pas sur son bouton de chargement, car son activation transmet la zone geographique affichee au service cartographique tiers.

L'administrateur peut changer son mot de passe depuis l'interface. Le mot de passe actuel est exige, le nouveau doit contenir au moins 12 caracteres avec majuscule, minuscule, chiffre et symbole, et toutes les autres sessions ouvertes sont immediatement invalidees.

Les connexions, deconnexions, changements de mot de passe, exports et suppressions sont journalises dans `audit_logs`. La suppression globale exige la saisie exacte de `SUPPRIMER` dans l'interface et dans l'API.

En developpement, `DATABASE_FALLBACK=memory` active automatiquement une base temporaire si PostgreSQL est inaccessible. Toutes les fonctions restent disponibles, mais ces donnees disparaissent au redemarrage. Utilisez `DATABASE_FALLBACK=disabled` pour imposer PostgreSQL local.

## Commandes

- `npm run check` : controle la structure et la syntaxe JavaScript.
- `npm run check:production` : controle secrets, PostgreSQL, migrations, retention, sauvegarde, APK, URL HTTPS et signature Android sans afficher les secrets.
- `npm run quality:run` : execute immediatement le controle de syntaxe, les tests et la sante PostgreSQL, puis ecrit le dernier rapport dans `.quality/`.
- `npm run quality:schedule` / `quality:unschedule` : installe ou retire le controle local automatique toutes les cinq minutes sous Windows.
- `npm test` : execute les tests HTTP et de traitement d'image.
- `npm run test:e2e` : teste tous les parcours contre un serveur et une base de test deja demarres. Renseignez `E2E_BASE_URL`, `E2E_ADMIN_USERNAME` et `E2E_ADMIN_PASSWORD`.
- `npm run dev` : demarre le serveur en mode surveillance.
- `npm run init-db` : applique le schema idempotent et configure le compte admin.
- `npm run db:up` / `npm run db:down` : demarre ou arrete PostgreSQL persistant avec Docker Compose.
- `npm run db:local:start` / `db:local:stop` : gere l'instance PostgreSQL Windows dediee sur le port 5433.
- `npm run app:local` : demarre PostgreSQL, initialise la base et lance l'application.
- `npm run db:backup` : sauvegarde PostgreSQL et les photos stockees en base.
- `npm run db:backup:verify` : prouve qu'une sauvegarde peut etre restauree dans une base temporaire isolee.
- `npm run db:backup:schedule` : installe sous Windows une sauvegarde quotidienne a 02:00 pour l'utilisateur courant.
- `npm run db:backup:unschedule` : retire cette tache sans effacer les archives existantes.

Les reglages `GEOLOCATION_*` pilotent la precision, le delai et l'age maximal d'une position. `LOCATION_RATE_LIMIT_MAX` et `LOCATION_RATE_LIMIT_WINDOW_MS` configurent la protection anti-abus sans imposer une limite trop faible aux utilisateurs partageant le meme reseau.

Attention : le scenario E2E cree puis supprime des verifications. Ne le dirigez jamais vers une base de production. Les tests unitaires forcent automatiquement une base temporaire isolee.

## Installation PWA et mode hors connexion

Sur un navigateur compatible, le bouton `Installer` apparait dans l'en-tete. Le service worker conserve l'interface principale pour une reutilisation hors connexion. Une verification realisee sans reseau, pendant une coupure non detectee par le navigateur ou durant une erreur serveur temporaire est placee dans IndexedDB, y compris sa photo et ses points GPS, puis renvoyee automatiquement au retour du service. Une ancienne file `localStorage` est migree automatiquement. Un fallback `localStorage` reste disponible pour les navigateurs sans IndexedDB. La file reste sur l'appareil : ne videz pas les donnees du site avant la synchronisation. Sa limite de 250 elements est bloquante et ne supprime jamais silencieusement les collectes les plus anciennes.

## Application Android avec Capacitor

Le dossier `android/` contient le projet natif Capacitor 8. Le suivi de 15 minutes utilise `@capgo/background-geolocation` sur Android et affiche une notification permanente pendant son activation. L'emulateur Android accede par defaut au serveur local via `http://10.0.2.2:3000`.

- `npm run mobile:sync` : copie la derniere version Web et synchronise les plugins Android.
- `npm run mobile:open` : ouvre le projet dans Android Studio.
- `npm run mobile:run` : lance l'application sur un emulateur ou un telephone connecte.
- `npm run mobile:build:release` : exige une URL HTTPS et une cle privee, puis produit un APK et un AAB signes dans `artifacts/`.

Pour un telephone physique ou la production, definissez `CAPACITOR_SERVER_URL` avec une adresse HTTPS accessible par l'appareil avant `npm run mobile:sync`. Ajoutez aussi cette origine a `CORS_ORIGINS`. Android Studio et un SDK Android API 24 ou plus recent sont requis pour compiler l'APK.

Le Web/PWA servi directement par le backend fonctionne en meme origine et ne necessite pas de valeur CORS supplementaire. En production, les origines locales de developpement ne sont jamais autorisees implicitement. Ne configurez `CORS_ORIGINS` que pour des clients heberges sur une origine differente, une fois leur URL exacte connue.

Pour signer une release, conservez le keystore hors du depot, copiez `android/key.properties.example` vers `android/key.properties` et renseignez ses quatre valeurs. La commande release refuse volontairement une URL non HTTPS. Sauvegardez le keystore et ses mots de passe dans un coffre : leur perte empecherait les futures mises a jour de l'application publiee.

## Donnees

`PHOTO_STORAGE=database` conserve la photo compressee dans PostgreSQL. `PHOTO_STORAGE=local` la conserve dans `uploads/`, qui n'est pas servi publiquement. Les listes et exports admin n'incluent ni le contenu de la photo ni son chemin interne.

La camera et la geolocalisation sont activees uniquement apres un consentement explicite du visiteur. Les depots et transferts restent fictifs et exigent une position autorisee avant leur enregistrement.
