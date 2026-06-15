# Obscura 📷

> *Camera obscura* — l'image dort dans le noir jusqu'à sa révélation.

Appareil photo **jetable numérique** collaboratif pour mariage. Les invités scannent un QR code, prennent des photos (sans jamais les voir), et la galerie se révèle à l'heure choisie par les mariés.

Auto-hébergeable sur CasaOS / Docker, exposé via Cloudflare Tunnel.

## Stack

- **Backend** : Hono (Node.js 20+), zéro base de données
- **Frontend** : HTML/CSS/JS vanilla
- **Stockage** : système de fichiers (`/data/photos/`) + `config.json`
- **Conteneurisation** : Docker + docker-compose

## Démarrage rapide (local)

```bash
npm install
ADMIN_PASSWORD="ton-mot-de-passe" npm start
# → http://localhost:3000
```

Sur Windows PowerShell :

```powershell
$env:ADMIN_PASSWORD="ton-mot-de-passe"; npm start
```

Au premier démarrage, `data/config.json` est créé automatiquement avec ce mot de passe.

## Démarrage avec Docker

```bash
# Définir le mot de passe admin initial (premier démarrage uniquement)
export ADMIN_PASSWORD="ton-mot-de-passe"
docker compose up -d --build
# → http://localhost:3210
```

Le dossier `./data` est monté en volume : photos, sessions et config y sont persistés.

## Routes

| Route | Description |
|-------|-------------|
| `GET /` | Page caméra invité |
| `POST /upload` | Réception d'une photo |
| `GET /gallery` | Galerie publique (bloquée avant reveal) |
| `GET /slideshow` | Diaporama plein écran (post-reveal) |
| `GET /admin` | Connexion admin |
| `GET /admin/dashboard` | Dashboard (protégé) |
| `GET /photos/:filename` | Serving des photos (bloqué avant reveal sauf admin) |
| `GET /api/status` | `{ locked, revealAt, eventName }` |

## Configuration

Tout se règle depuis le dashboard admin (`/admin`). Le fichier `data/config.json` contient :

- `eventName`, `eventDate`, `welcomeMessage`
- `revealAt` (date/heure d'ouverture automatique de la galerie)
- `galleryLocked` (override manuel instantané)
- `filterDefault` : `grain` | `fade` | `noir` | `instant` | `raw`
- `maxPhotosPerSession` (`null` = illimité)
- `slideshowInterval`, `slideshowOrder` (`random` | `chronological`)
- `maxPhotoSizeMb`, `allowedOrigins`

## Mot de passe admin

- Initial : variable d'environnement `ADMIN_PASSWORD` au premier démarrage.
- Changement : depuis le dashboard, section « Mot de passe ».
- Génération manuelle d'un hash : `npm run hash-password "mon-mdp"` puis coller dans `adminPasswordHash`.

## Cloudflare Tunnel

Exposer le port local `3210` (Docker) ou `3000` (local) sur un sous-domaine, ex. `photos.paulbr.fr`.
Le QR code généré dans le dashboard pointe automatiquement vers l'URL publique (en-tête `Host`), ou définis `PUBLIC_URL` pour forcer l'URL.

## Sécurité

- Photos non servies avant `revealAt` (sauf session admin).
- Session admin par cookie `httpOnly` signé (24 h).
- Rate limiting upload : 1 photo / 2 s / IP.
- Taille max & types (`jpeg`/`png`/`webp`) validés côté serveur.
