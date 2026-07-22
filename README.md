# Portefeuille Demo

Application Node.js de portefeuille fictif et de controle d'identite avec interface client, tableau admin et stockage PostgreSQL.

La demande GPS est lancee des l'ouverture d'un depot ou d'un transfert simule. Une autorisation accordee est enregistree immediatement et diffusee au tableau admin par Server-Sent Events. Un refus est conserve comme etat sans coordonnees.

Apres autorisation, `watchPosition` maintient un suivi visible et interrompable pendant 15 minutes par defaut, tant que la page reste ouverte. Les points sont espaces selon le temps ou la distance et rattaches a la reference initiale par un identifiant de session.

## Demarrage local

1. Installez Node.js 20+ et PostgreSQL.
2. Copiez `.env.example` vers `.env` et renseignez les identifiants PostgreSQL.
3. Creez la base indiquee par `DB_NAME` si elle n'existe pas.
4. Executez `npm ci`, puis `npm run init-db`.
5. Lancez `npm start` et ouvrez `http://localhost:3000`.

Le tableau admin est disponible sur `http://localhost:3000/admin`. Son compte est cree ou mis a jour par `npm run init-db` avec `ADMIN_USERNAME` et `ADMIN_PASSWORD`.

En developpement, `DATABASE_FALLBACK=memory` active automatiquement une base temporaire si PostgreSQL est inaccessible. Toutes les fonctions restent disponibles, mais ces donnees disparaissent au redemarrage. Utilisez `DATABASE_FALLBACK=disabled` pour imposer PostgreSQL local.

## Commandes

- `npm run check` : controle la structure et la syntaxe JavaScript.
- `npm test` : execute les tests HTTP et de traitement d'image.
- `npm run test:e2e` : teste tous les parcours contre un serveur et une base de test deja demarres. Renseignez `E2E_BASE_URL`, `E2E_ADMIN_USERNAME` et `E2E_ADMIN_PASSWORD`.
- `npm run dev` : demarre le serveur en mode surveillance.
- `npm run init-db` : applique le schema idempotent et configure le compte admin.

Les reglages `GEOLOCATION_*` pilotent la precision, le delai et l'age maximal d'une position. `LOCATION_RATE_LIMIT_MAX` et `LOCATION_RATE_LIMIT_WINDOW_MS` configurent la protection anti-abus sans imposer une limite trop faible aux utilisateurs partageant le meme reseau.

## Donnees

`PHOTO_STORAGE=database` conserve la photo compressee dans PostgreSQL. `PHOTO_STORAGE=local` la conserve dans `uploads/`, qui n'est pas servi publiquement. Les listes et exports admin n'incluent ni le contenu de la photo ni son chemin interne.

La camera et la geolocalisation sont activees uniquement apres un consentement explicite du visiteur. Les depots et transferts restent fictifs et exigent une position autorisee avant leur enregistrement.
