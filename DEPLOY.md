# Déploiement d'Obscura — CasaOS + Cloudflare Tunnel (config.yml) + Git

Chemin global :
```
PC (git push) → Serveur CasaOS (git clone + docker compose) → Cloudflare Tunnel → https://photos.paulbr.fr → QR code
```

---

## 1. Pousser le code (depuis ton PC)

Le dépôt ignore déjà `data/` et `node_modules/` (voir `.gitignore`) : tes photos et ta config **ne partent pas** sur le repo.

```bash
cd "Camera Mariage"
git init
git add .
git commit -m "Obscura"
git branch -M main
git remote add origin <URL_DE_TON_REPO_PRIVE>
git push -u origin main
```

> Utilise un repo **privé** (GitHub/Gitea). Le code ne contient aucun secret (le mot de passe est passé en variable d'env au runtime), mais autant rester discret.

---

## 2. Récupérer et lancer sur le serveur CasaOS

En SSH sur le serveur :

```bash
cd /DATA/AppData                      # ou ton emplacement habituel CasaOS
git clone <URL_DE_TON_REPO_PRIVE> obscura
cd obscura

# Premier démarrage : définis le mot de passe admin + l'URL publique
ADMIN_PASSWORD="UN_MOT_DE_PASSE_SOLIDE" \
PUBLIC_URL="https://photos.paulbr.fr" \
docker compose up -d --build
```

L'app écoute alors sur `http://IP_SERVEUR:3210`. Le dossier `./data` (photos, sessions, `config.json`) est persistant sur le serveur.

**Vérifie en local réseau** : `curl http://localhost:3210/api/status` doit répondre du JSON.

> ⚠️ `ADMIN_PASSWORD` n'est lu **qu'au tout premier lancement** (création de `config.json`). Ensuite, change-le depuis le dashboard. En cas d'oubli : `rm data/config.json` puis relance.

### Mises à jour ultérieures
```bash
cd /DATA/AppData/obscura
git pull
docker compose up -d --build      # data/ est conservé
```

---

## 3. Brancher ton Cloudflare Tunnel (config.yml existant)

Ajoute une entrée **ingress** dans ton `config.yml` (les règles sont évaluées dans l'ordre ; le `http_status:404` reste **toujours en dernier**) :

```yaml
tunnel: <TON_TUNNEL_ID>
credentials-file: /chemin/vers/<TON_TUNNEL_ID>.json

ingress:
  - hostname: photos.paulbr.fr
    service: http://localhost:3210      # cloudflared tourne sur l'hôte
  # ... tes autres hostnames éventuels ...
  - service: http_status:404
```

- **Si `cloudflared` tourne dans un conteneur** sur le même réseau Docker que l'app, mets plutôt `service: http://obscura:3000` (nom du conteneur + port interne) et assure-toi qu'ils partagent un réseau Docker.

Crée l'enregistrement DNS (une seule fois) :
```bash
cloudflared tunnel route dns <NOM_DU_TUNNEL> photos.paulbr.fr
```
*(ou ajoute manuellement un CNAME `photos` → `<TON_TUNNEL_ID>.cfargotunnel.com` dans Cloudflare DNS).*

Recharge le tunnel :
```bash
# service systemd :
sudo systemctl restart cloudflared
# ou en conteneur :
docker restart cloudflared
```

---

## 4. Finitions

1. Ouvre **https://photos.paulbr.fr/admin** → connecte-toi → **change le mot de passe**.
2. Règle dans le dashboard : `eventName`, `welcomeMessage`, `revealAt` (date/heure d'ouverture), quota par invité, intervalle diaporama.
3. **QR Code → Télécharger en PNG** → imprime-le pour les tables (il pointe vers `https://photos.paulbr.fr/`).
4. Test final sur smartphone : prendre une photo → `/admin` « Preview galerie » → installer la PWA (« Ajouter à l'écran d'accueil »).

---

## Le jour J — check-list

- [ ] `revealAt` réglé sur l'heure voulue (ex. lendemain 9h)
- [ ] `galleryLocked` = ON (la galerie s'ouvrira automatiquement à `revealAt`)
- [ ] QR codes imprimés et posés sur les tables
- [ ] Photo test depuis un téléphone → visible dans `/admin/photos`
- [ ] Écran/TV branché sur `/slideshow` pour le repas (après le reveal)
- [ ] Sauvegarde : `data/photos/` est le trésor → pense à le copier après l'événement

---

## Sauvegarde / export

- Depuis le dashboard : **Export → Télécharger toutes les photos (.zip)**.
- Ou directement sur le serveur : le dossier `data/photos/` contient tous les originaux filtrés.
