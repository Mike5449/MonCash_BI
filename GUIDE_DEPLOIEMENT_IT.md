# Guide de Déploiement — MonCash BI Portal

**Public cible :** Équipe IT Digicel Haiti
**Version :** 1.0 (2026-07-17)
**Auteur :** Mike JEAN LOUIS

Ce document est un **runbook opérationnel** : chaque étape contient les commandes exactes à exécuter, ce qu'il faut attendre en sortie, et les erreurs connues avec leur résolution. Suivez-le dans l'ordre.

---

## 📑 Table des matières

1. [Vue d'ensemble](#1-vue-densemble)
2. [Prérequis](#2-prérequis)
3. [Préparation du serveur Linux](#3-préparation-du-serveur-linux)
4. [Installation de Docker](#4-installation-de-docker)
5. [Configuration du firewall (UFW)](#5-configuration-du-firewall-ufw)
6. [Récupération du code](#6-récupération-du-code)
7. [Configuration du fichier `.env`](#7-configuration-du-fichier-env)
8. [Build et démarrage des containers](#8-build-et-démarrage-des-containers)
9. [Vérifications post-déploiement](#9-vérifications-post-déploiement)
10. [Accès utilisateurs & DNS](#10-accès-utilisateurs--dns)
11. [Mode démo actuel & prochaines étapes](#11-mode-démo-actuel--prochaines-étapes)
12. [Maintenance](#12-maintenance)
13. [Dépannage](#13-dépannage)
14. [Annexes](#14-annexes)

---

## 1. Vue d'ensemble

### 1.1 Architecture

Le portail est packagé en 3 containers Docker orchestrés par Docker Compose :

```
                   ┌────────────────────────────────────────────┐
                   │       Serveur Linux (port 80 exposé)       │
                   │                                            │
   Navigateurs ──► │   bi-frontend (nginx 1.27)                 │
   utilisateurs    │      ├── sert le bundle React/Vite         │
                   │      └── proxy /api/* → bi-backend:8000    │
                   │                                            │
                   │   bi-backend (FastAPI, Uvicorn) ─┐         │
                   │       │                          │         │
                   │       ▼                          ▼         │
                   │   Databricks SQL             bi-redis      │
                   │   (analytics)                (cache)       │
                   │                                            │
                   └────────────────────────────────────────────┘
```

### 1.2 Composants

| Container | Rôle | Image de base | Port exposé |
|---|---|---|---|
| `bi-frontend` | Serveur web (nginx) + SPA React | `nginx:1.27-alpine` | 80 (sur l'hôte) |
| `bi-backend` | API FastAPI, connexion Databricks | `python:3.13-slim` | 8000 (interne uniquement) |
| `bi-redis` | Cache résultats analytics | `redis:7-alpine` | 6379 (interne uniquement) |

**Sécurité :** seul le port 80 est ouvert vers l'extérieur. Backend et Redis restent sur le réseau interne Docker (`moncash-portal_bi-net`).

### 1.3 Volumétrie

- Images Docker : ~1 GB (backend 980 MB + frontend 78 MB + Redis mini)
- Cache de build : ~1.7 GB (transitoire)
- Espace disque recommandé : **20 GB minimum**

---

## 2. Prérequis

### 2.1 Matériel serveur

| Ressource | Minimum | Recommandé |
|---|---|---|
| CPU | 2 cœurs | 4 cœurs |
| RAM | 4 GB | 8 GB |
| Disque | 20 GB libres | 50 GB libres |
| Réseau | 100 Mbps | 1 Gbps |

### 2.2 Système d'exploitation

- **Ubuntu 22.04 LTS ou plus récent** (validé sur Ubuntu 26.04 « Resolute Raccoon »)
- Autres distributions Linux avec Docker Engine 24+ acceptables (RHEL 9, Debian 12)

### 2.3 Réseau — Accès sortants requis

Depuis le serveur vers Internet, ces flux **doivent être autorisés** :

| Destination | Port | Usage |
|---|---|---|
| `hub.docker.com` (`*.docker.io`) | 443 | Pull des images Docker |
| `github.com` | 443 | Clone du repo |
| `adb-<xxxx>.azuredatabricks.net` | 443 | Requêtes SQL Databricks |
| `login.microsoftonline.com` | 443 | Acquisition token Azure AD |

**Test rapide avant déploiement** :
```bash
for url in \
  "https://adb-3415321098130757.17.azuredatabricks.net" \
  "https://login.microsoftonline.com" \
  "https://hub.docker.com/v2/" \
  "https://github.com"; do
  echo -n "$url : "
  curl -s -o /dev/null -w "%{http_code}\n" --max-time 5 "$url"
done
```
> Attendu : 4 codes HTTP entre 200-401 (401 pour Docker Hub est normal, c'est l'auth challenge)

### 2.4 Réseau — Accès entrants

- Port **22 (SSH)** ouvert depuis les postes admin (au minimum votre bastion / poste IT)
- Port **80 (HTTP)** ouvert depuis le VLAN utilisateurs

### 2.5 Credentials Azure Service Principal ⚠️ **CRITIQUE**

Le backend s'authentifie auprès de Databricks via **Azure AD Service Principal** (pas de PAT hardcodé). L'équipe Cloud/Sécurité doit fournir :

- `AZURE_TENANT_ID` — GUID du tenant Digicel
- `AZURE_CLIENT_ID` — App ID de la SP créée pour le portail
- `AZURE_CLIENT_SECRET` — secret de la SP (à noter, non réutilisable)

**Permissions requises** sur la SP :
- `SQL execute` sur le warehouse Databricks cible
- Accès en lecture au catalogue `gr_dgc_dwh_prd.ods_dl` (ou équivalent)

**Sans ces 3 valeurs, le backend démarre mais toute requête analytics retourne HTTP 500.**

### 2.6 Compte GitHub

Le code source est sur : https://github.com/Mike5449/MonCash_BI (repo **public** — aucun credential nécessaire pour cloner)

---

## 3. Préparation du serveur Linux

### 3.1 Connexion SSH

```bash
ssh root@ht-moncashreporting     # ou root@<IP>
```

Toutes les commandes ci-après supposent une session en tant que `root` (ou avec `sudo`).

### 3.2 Mise à jour du système

```bash
apt-get update
apt-get upgrade -y
```

### 3.3 Fuseau horaire

Garder UTC comme fuseau serveur (standard infra) :
```bash
timedatectl set-timezone UTC
timedatectl
```

### 3.4 Synchronisation NTP — ⚠️ **PARTICULARITÉ DIGICEL**

**Problème connu :** le firewall corporate Digicel **bloque le port 4460 (NTS-KE)** utilisé par les serveurs NTP par défaut d'Ubuntu (`ntp.ubuntu.com`). Résultat : `chronyd` ne parvient pas à synchroniser l'horloge, ce qui casse l'acquisition de tokens Azure AD (tolérance max 5 min d'écart).

**Solution éprouvée en 2 étapes :**

#### 3.4.1 Fixer l'horloge immédiatement via HTTPS (workaround)

```bash
# Utilise l'en-tete HTTP Date de Google (HTTPS 443, jamais bloque)
date -s "$(curl -sI https://www.google.com | grep -i '^date:' | sed 's/^[Dd]ate: //I' | tr -d '\r')"

# Verifier
date -u
timedatectl status | grep -E "Local time|Universal"
```
> L'horloge doit maintenant être proche de l'heure UTC réelle (précision : ~1 seconde).

#### 3.4.2 Installer chrony pour la synchronisation continue

```bash
apt-get install -y chrony

# Remplacer les pools NTS-only (bloques) par pool.ntp.org classique
sed -i 's/^\(pool.*ntp.ubuntu.com.*\)/#\1/' /etc/chrony/chrony.conf
grep -q "^pool pool.ntp.org" /etc/chrony/chrony.conf || echo "pool pool.ntp.org iburst maxsources 4" >> /etc/chrony/chrony.conf

# Autoriser des sauts d'horloge illimites (evite l'echec sur gros offset)
if grep -q "^makestep" /etc/chrony/chrony.conf; then
    sed -i 's|^makestep.*|makestep 1.0 -1|' /etc/chrony/chrony.conf
else
    echo "makestep 1.0 -1" >> /etc/chrony/chrony.conf
fi

systemctl restart chrony
sleep 30
chronyc tracking | head -5
```
> Attendu (après ~30 s) : `Reference ID` non nul, `System time` avec offset < 1 s.

**Note :** même si `timedatectl status` affiche `System clock synchronized: no` pendant quelques minutes, l'horloge est OK grâce au workaround HTTPS.

### 3.5 Vérification de l'environnement

```bash
echo "=== Systeme ==="
lsb_release -a
uname -r

echo "=== CPU / Memoire / Disque ==="
nproc
free -h
df -h /

echo "=== Reseau ==="
ip -4 addr | grep inet | grep -v 127.0.0.1
hostname -f
```
Notez l'IP privée du serveur — vous en aurez besoin pour le CORS et pour donner l'URL aux utilisateurs.

---

## 4. Installation de Docker

### 4.1 Installation via le script officiel

```bash
# Purge des anciennes versions eventuelles
apt-get remove -y docker docker-engine docker.io containerd runc 2>/dev/null || true

# Installation par le script officiel Docker Inc.
curl -fsSL https://get.docker.com -o /tmp/get-docker.sh
sh /tmp/get-docker.sh
rm /tmp/get-docker.sh

# Activation + demarrage du daemon
systemctl enable docker
systemctl start docker
```

### 4.2 Validation

```bash
docker version | head -20
docker compose version
docker run --rm hello-world
```
> Attendu :
> - `Docker Engine - Community` version ≥ 24
> - `Docker Compose version v2.x` (ou v5.x)
> - Sortie `Hello from Docker!` du container test

### 4.3 Nettoyage du container test

Le container `hello-world` reste en stopped state, sans impact. Pour le supprimer :
```bash
docker container prune -f
docker image rm hello-world 2>/dev/null
```

---

## 5. Configuration du firewall (UFW)

L'accès au serveur doit être verrouillé au strict nécessaire.

```bash
# 1. Installer UFW si absent (normalement present sur Ubuntu)
apt-get install -y ufw

# 2. Politique par defaut
ufw default deny incoming
ufw default allow outgoing

# 3. Autoriser SSH (CRITIQUE - avant d'activer, sinon perte de connexion)
ufw allow 22/tcp comment 'SSH'

# 4. Autoriser HTTP (le portail)
ufw allow 80/tcp comment 'HTTP MonCash Portal'

# 5. (Optionnel) HTTPS pour plus tard quand un certificat sera en place
# ufw allow 443/tcp comment 'HTTPS MonCash Portal'

# 6. Activer
ufw --force enable

# 7. Verifier
ufw status verbose
```
> Attendu : `Status: active` + règles listées pour 22 et 80 (IPv4 + IPv6).

---

## 6. Récupération du code

Le code source est publié sur GitHub (repo public).

```bash
# 1. Installer git si absent
git --version || apt-get install -y git

# 2. Cloner dans /opt (emplacement standard applications tierces)
mkdir -p /opt
cd /opt
git clone https://github.com/Mike5449/MonCash_BI.git moncash-portal
cd moncash-portal

# 3. Verifier
git log --oneline | head -5
ls -la
```
> Attendu : plusieurs commits dans l'historique, dossiers `backend/`, `frontend/`, fichiers `docker-compose.yml`, `.env.example`.

---

## 7. Configuration du fichier `.env`

Le `.env` centralise **toutes** les variables sensibles. Docker Compose l'injecte dans les containers au démarrage.

### 7.1 Générer le `.env` de production

Le script ci-dessous détecte automatiquement l'IP du serveur, génère des clés JWT robustes, et laisse les 3 vars Azure vides (à remplir par la sécurité).

```bash
cd /opt/moncash-portal

SERVER_IP=$(hostname -I | awk '{print $1}')
SECRET_KEY=$(openssl rand -hex 64)
REFRESH_SECRET_KEY=$(openssl rand -hex 64)

cat > .env << EOF
# ─────────────────────────────────────────────────────────────────
# MonCash BI Portal — Production .env
# Server: $(hostname) (${SERVER_IP})
# Generated: $(date -u '+%Y-%m-%d %H:%M UTC')
# ─────────────────────────────────────────────────────────────────

# ── Databricks SQL warehouse (Digicel Haiti prod) ────────────────
DATABRICKS_SERVER_HOSTNAME=adb-3415321098130757.17.azuredatabricks.net
DATABRICKS_HTTP_PATH=/sql/1.0/warehouses/df8d98fb09f6a448
ANALYTICS_INPUT_PATH=gr_dgc_dwh_prd.ods_dl

# ── Azure Service Principal (A REMPLIR par equipe securite) ──────
AZURE_TENANT_ID=
AZURE_CLIENT_ID=
AZURE_CLIENT_SECRET=

# ── JWT signing keys (128 chars hex chacune, generees a l'install) ──
SECRET_KEY=${SECRET_KEY}
REFRESH_SECRET_KEY=${REFRESH_SECRET_KEY}
ACCESS_TOKEN_EXPIRE_MINUTES=30
REFRESH_TOKEN_EXPIRE_DAYS=7

# ── CORS ─────────────────────────────────────────────────────────
CORS_ORIGINS=http://${SERVER_IP},http://$(hostname),http://localhost

# ── Trusted hosts (Host header allow-list) ──────────────────────
ALLOWED_HOSTS=$(hostname),${SERVER_IP},localhost,127.0.0.1

# ── Cache TTL (10 min) ──────────────────────────────────────────
CACHE_DEFAULT_TTL=600

# ── Runtime ──────────────────────────────────────────────────────
UVICORN_WORKERS=2
WEB_PORT=80
EOF

# Securiser (root seul peut lire/ecrire)
chmod 600 .env

# Verifier
ls -la .env
awk -F= '/^SECRET_KEY=/ {print "SECRET_KEY: " length($2) " chars"} /^REFRESH_SECRET_KEY=/ {print "REFRESH_SECRET_KEY: " length($2) " chars"}' .env
```
> Attendu :
> - Permissions `-rw-------` (600)
> - `SECRET_KEY: 128 chars` et `REFRESH_SECRET_KEY: 128 chars`

### 7.2 Remplir les credentials Azure

Une fois les 3 valeurs fournies par l'équipe sécurité :

```bash
nano .env
```
Éditer les 3 lignes `AZURE_*=`, sauvegarder (`Ctrl+O`, `Enter`, `Ctrl+X`).

> ⚠️ **Ne jamais commiter le `.env`** — il est déjà dans `.gitignore`, ne pas le déplacer.

### 7.3 Explication des variables

| Variable | Description | Modifiable ? |
|---|---|---|
| `DATABRICKS_SERVER_HOSTNAME` | Endpoint du workspace Databricks | Non (fixe) |
| `DATABRICKS_HTTP_PATH` | Chemin du SQL Warehouse | Non (fixe) |
| `ANALYTICS_INPUT_PATH` | Catalogue+schema source | Sur demande data eng |
| `AZURE_TENANT_ID/CLIENT_ID/CLIENT_SECRET` | Auth Azure AD | Fourni par sécurité |
| `SECRET_KEY / REFRESH_SECRET_KEY` | Signature JWT (jamais recyclées) | Regénérer si suspicion de fuite |
| `CORS_ORIGINS` | Origines browser autorisées | Ajouter les nouveaux URLs |
| `CACHE_DEFAULT_TTL` | Durée cache Redis (s) | Ajuster si besoin |
| `UVICORN_WORKERS` | Workers backend | Augmenter si trafic ↑ |
| `WEB_PORT` | Port host exposé | Changer si 80 déjà pris |

---

## 8. Build et démarrage des containers

### 8.1 Validation de la config

```bash
cd /opt/moncash-portal
docker compose config --quiet && echo "OK config valide" || echo "ECHEC config invalide"
docker compose config --services
```
> Attendu : `OK config valide` puis liste des 3 services (`backend`, `frontend`, `redis`).

### 8.2 Build des images

**Premier build : ~5-10 minutes** (téléchargement des images de base + `pip install` backend + compilation Vite frontend).

```bash
time docker compose build --progress=plain 2>&1 | tail -80
```
> Suivre attentivement la fin de la sortie :
> - `Image moncash/bi-backend:latest Built` ✅
> - `Image moncash/bi-frontend:latest Built` ✅

**Builds suivants (après modif de code)** : quelques secondes à ~1 minute grâce au cache Docker.

### 8.3 Démarrage du stack

```bash
docker compose up -d
sleep 15
docker compose ps
```
> Attendu : 3 containers avec `STATUS: Up (healthy)` ou `Up (health: starting)`.

---

## 9. Vérifications post-déploiement

### 9.1 État des containers

```bash
docker compose ps
docker compose logs --tail=30 backend
docker compose logs --tail=10 frontend
```
> Backend logs doivent contenir : `INFO: Application startup complete.` et `INFO: Uvicorn running on http://0.0.0.0:8000`

### 9.2 Test HTTP local

```bash
# Test frontend (doit retourner HTML)
curl -sI http://localhost/ | head -5

# Test backend via nginx proxy (doit retourner JSON)
curl -sI http://localhost/api/health
```
> Attendu : deux fois `HTTP/1.1 200 OK`.

### 9.3 Test HTTP depuis un poste externe

Depuis un poste dans le VLAN utilisateurs (PowerShell / autre) :
```powershell
Test-NetConnection -ComputerName <IP_serveur> -Port 80
```
> Attendu : `TcpTestSucceeded : True`

### 9.4 Test navigateur

Ouvrir : `http://<IP_serveur>/`
> Attendu : page login avec logo triangle rouge MonCash + titre "MonCashBI" dans l'onglet.

---

## 10. Accès utilisateurs & DNS

### 10.1 Problème constaté : DNS interne Digicel ne résout pas le hostname

Depuis les postes clients, `nslookup ht-moncashreporting` retourne `Non-existent domain`. Deux solutions :

**Option A — Ajout d'un enregistrement DNS interne (recommandée)**
Demander à l'équipe Réseau d'ajouter dans le DNS Digicel :
| Champ | Valeur |
|---|---|
| Type | `A` |
| Nom | `moncash-bi.digicelgroup.local` (ou similaire) |
| Valeur | IP du serveur |

Après ajout, mettre à jour le `.env` :
```bash
sed -i 's|^CORS_ORIGINS=.*|CORS_ORIGINS=http://<IP>,http://moncash-bi.digicelgroup.local|' .env
docker compose restart backend
```

**Option B — Fichier `hosts` local (workaround individuel)**
Sur chaque poste utilisateur :
```
<IP_serveur>  ht-moncashreporting
```
- Windows : `C:\Windows\System32\drivers\etc\hosts` (avec droits admin)
- Linux/Mac : `/etc/hosts`

### 10.2 Communication de l'URL aux utilisateurs

En attendant le DNS, communiquer aux utilisateurs :
```
http://<IP_serveur>/
```

---

## 11. Mode démo actuel & prochaines étapes

### 11.1 État actuel du login

Actuellement (2026-07-17), l'authentification est en **mode démo** :
- Le champ accepte **n'importe quel username** (pas de format email requis)
- **N'importe quel mot de passe** (non vide) est accepté
- Aucune vérification côté serveur, session uniquement stockée en `localStorage` du navigateur

### 11.2 Activation de l'authentification réelle

**Objectif à moyen terme** : brancher le portail sur l'annuaire d'entreprise (LDAP / Azure AD / ASP.NET auth existant à `http://hti-dtswebsrv:2020/api/Auth`).

**Modifications nécessaires :**
1. Restaurer le code d'auth ASP.NET dans `frontend/src/services/auth.ts` (voir historique git avant le commit `060a13d`)
2. Ajouter dans `frontend/nginx.conf` un `location /auth-api/` proxy vers le serveur d'auth
3. Ajouter la variable `VITE_AUTH_API_URL` dans le build frontend
4. Tester le login end-to-end

Cette activation nécessitera un **rebuild frontend + redéploiement** (~2 min).

### 11.3 Complétion des analytics (Azure SP)

Tant que les 3 vars `AZURE_*=` restent vides dans `.env`, **les pages analytics affichent des erreurs 500**. Dès livraison des creds :

```bash
cd /opt/moncash-portal
nano .env    # remplir AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET
docker compose restart backend
docker compose logs -f backend | grep -E "AUTH|token"
```
> Attendu dans les logs : `[AUTH] Success! Token acquired. Expires in XX minutes.`

---

## 12. Maintenance

### 12.1 Mise à jour du code (déploiement de nouvelle version)

```bash
cd /opt/moncash-portal
git pull origin main
docker compose build
docker compose up -d
```
> Docker Compose détecte automatiquement les images qui ont changé et ne redémarre que les containers concernés.

### 12.2 Consultation des logs

```bash
# En temps reel, tous services
docker compose logs -f

# Un seul service, derniers messages
docker compose logs --tail=100 backend

# Filtrer sur un pattern
docker compose logs backend | grep -E "ERROR|WARNING"

# Logs persistes sur disque (Docker gere la rotation automatiquement)
docker inspect --format='{{.LogPath}}' bi-backend
```

### 12.3 Redémarrage

```bash
# Redemarrer un service seul
docker compose restart backend

# Redemarrer tout le stack (sans rebuild)
docker compose restart

# Recreer les containers (apres modif .env)
docker compose up -d --force-recreate
```

### 12.4 Vidage du cache Redis

Si des analytics semblent obsolètes :
```bash
docker compose exec redis redis-cli FLUSHDB
```

### 12.5 Arrêt / reprise du stack

```bash
# Arret propre (containers stoppes, volumes conserves)
docker compose stop

# Reprise
docker compose start

# Arret + suppression des containers (volumes conserves = pas de perte donnees)
docker compose down

# Arret + suppression totale (⚠ perte cache Redis)
docker compose down -v
```

### 12.6 Nettoyage disque

```bash
# Verifier l'espace utilise par Docker
docker system df

# Nettoyer images/build cache inutilises (safe)
docker system prune -a --volumes -f

# ⚠ Ce nettoyage supprime :
#  - Toutes les images non utilisees par un container UP
#  - Tous les volumes non attaches
#  - Tout le cache de build
```

### 12.7 Sauvegarde

**Ce qui est à sauvegarder :**
- `/opt/moncash-portal/.env` — configuration + secrets JWT (irréversible si perdu = tous les tokens invalidés)
- Le code est sur GitHub, ne nécessite pas de backup local

**Commande de sauvegarde :**
```bash
# Copier .env vers un stockage securise
cp /opt/moncash-portal/.env /backups/moncash-portal-env-$(date +%Y%m%d).bak
```

### 12.8 Flush automatique du cache Redis (1 AM heure Haïti)

Puisque les données Databricks sont **J-1** (ETL nocturne), le cache est configuré
pour tenir 25 heures (`CACHE_DEFAULT_TTL=90000` dans `.env`) et est **vidé
totalement chaque nuit à 1 AM heure Haïti** par un cron sur l'hôte. Cela garantit
que les utilisateurs voient les données rafraîchies dès le début de la journée
suivante sans réveiller inutilement le SQL warehouse Databricks pendant la journée.

**Installation du cron flush (setup one-shot)** — à faire après le déploiement :

```bash
# 1. Verifier que le fuseau America/Port-au-Prince est dispo
timedatectl list-timezones | grep -i port-au-prince

# 2. Nettoyer toute vieille entree
crontab -l 2>/dev/null | grep -vE "FLUSHDB|moncash-cache-flush|CRON_TZ=America/Port-au-Prince" | crontab -

# 3. Ajouter la nouvelle entree (CRON_TZ gere DST auto)
(crontab -l 2>/dev/null; \
 echo ""; \
 echo "# --- MonCash BI : flush cache Redis quotidien a 1 AM heure Haiti ---"; \
 echo "CRON_TZ=America/Port-au-Prince"; \
 echo "0 1 * * * cd /opt/moncash-portal && /usr/bin/docker compose exec -T redis redis-cli FLUSHDB >> /var/log/moncash-cache-flush.log 2>&1"; \
) | crontab -

# 4. Log file + rotation weekly (garde 4 semaines compresses)
touch /var/log/moncash-cache-flush.log
chmod 644 /var/log/moncash-cache-flush.log
cat > /etc/logrotate.d/moncash-cache-flush << 'EOF'
/var/log/moncash-cache-flush.log {
    weekly
    rotate 4
    compress
    delaycompress
    missingok
    notifempty
    create 644 root root
}
EOF

# 5. Test manuel immediat
cd /opt/moncash-portal && docker compose exec -T redis redis-cli FLUSHDB
```

**Vérifier le lendemain matin :**

```bash
# Doit contenir une ligne datee d'environ 1 AM heure Haiti (5 AM UTC en ete, 6 AM UTC en hiver)
tail /var/log/moncash-cache-flush.log

# Historique cron systeme
journalctl -u cron.service --since "yesterday 23:00" | grep -iE "moncash|FLUSHDB"
```

**Désactiver temporairement le flush** (pour maintenance ou tests) :

```bash
# Commenter la ligne cron
crontab -l | sed '/FLUSHDB/s/^/#/' | crontab -

# Reactiver plus tard
crontab -l | sed '/FLUSHDB/s/^#//' | crontab -
```

---

## 13. Dépannage

### 13.1 Le container backend redémarre en boucle

**Diagnostic :**
```bash
docker compose logs backend | tail -50
```

| Message d'erreur | Cause | Résolution |
|---|---|---|
| `AZURE_TENANT_ID environment variable not set` | Vars Azure vides ou mal orthographiées | Vérifier `.env`, puis `docker compose restart backend` |
| `pydantic.ValidationError: SECRET_KEY` | Clé JWT manquante ou vide | Regénérer avec `openssl rand -hex 64`, mettre à jour `.env` |
| `Could not resolve host: adb-...` | DNS ou connectivité Databricks bloquée | Tester `curl https://adb-....azuredatabricks.net` depuis le container |
| `Connection refused` sur `login.microsoftonline.com` | Port 443 sortant bloqué vers Azure | Ouvrir la règle firewall |

### 13.2 Le frontend charge mais toutes les requêtes API retournent 502

Le backend n'est pas encore prêt (démarrage lent au premier boot) OU crashe.
```bash
docker compose ps                     # verifier "healthy"
docker compose logs backend | tail -30
docker compose restart backend
```

### 13.3 « CORS policy blocked » dans la console navigateur

L'URL utilisée dans le navigateur n'est pas dans `CORS_ORIGINS` du `.env`.
```bash
# Verifier la variable
grep CORS_ORIGINS /opt/moncash-portal/.env

# Ajouter l'URL manquante (exemple)
sed -i 's|^CORS_ORIGINS=.*|&,http://nouvelle-url.digicel.local|' /opt/moncash-portal/.env
docker compose restart backend
```

### 13.4 « Not able to reach the server » depuis le navigateur

**Diagnostic étape par étape :**

1. Depuis le serveur : `curl http://localhost/` → doit retourner du HTML
2. Depuis un poste client, tester la connexion TCP :
   ```powershell
   Test-NetConnection -ComputerName <IP_serveur> -Port 80
   ```
3. Si `TcpTestSucceeded : False` → firewall inter-VLAN Digicel bloque. Remonter à l'équipe Réseau.
4. Si `TcpTestSucceeded : True` mais navigateur ne charge pas → vider le cache navigateur, essayer en navigation privée.

### 13.5 Requêtes lentes / timeouts sur les analytics

**Cause connue :** les Databricks SQL warehouses **auto-suspend** après ~10 min sans requête. La première requête après suspend prend 15-30 s pour "réveiller" le cluster. C'est **normal**.

Solution long-terme : configurer le warehouse Databricks en `Always On` (coût financier plus élevé, à valider avec Finance).

### 13.6 Le stack ne démarre pas après un `docker compose up -d`

```bash
docker compose ps                    # voir quel container a un probleme
docker compose logs <service>        # inspecter les logs
docker compose down                  # tout arreter proprement
docker system df                     # verifier espace disque
docker compose up -d --force-recreate  # recreer les containers
```

### 13.7 Erreur « no space left on device » pendant le build

```bash
docker system df                  # voir l'espace utilise
docker builder prune -f           # vider le cache de build
docker image prune -a -f          # supprimer images inutilisees
df -h /                           # verifier l'espace disque host
```

---

## 14. Annexes

### 14.1 Structure des fichiers

```
/opt/moncash-portal/
├── GUIDE_DEPLOIEMENT_IT.md      ← ce document
├── DEPLOYMENT.md                ← doc anglaise plus concise
├── README.md                    ← index projet
├── docker-compose.yml           ← definition du stack (3 services)
├── .env.example                 ← template (versionne)
├── .env                         ← config prod (⚠ jamais commiter)
├── .gitignore
├── backend/
│   ├── Dockerfile               ← Python 3.13 + tesseract + uvicorn
│   ├── .dockerignore
│   ├── requirements.txt         ← dependances Python
│   ├── main.py                  ← FastAPI app
│   ├── database.py              ← acquisition token Azure + engine SQL
│   ├── core/                    ← config, security, cache
│   ├── models/                  ← modeles SQLAlchemy
│   ├── routers/                 ← endpoints API par domaine
│   ├── repositories/            ← acces donnees Databricks
│   ├── services/                ← logique metier
│   └── alembic/                 ← migrations schema
└── frontend/
    ├── Dockerfile               ← Node 20 builder → nginx 1.27 runtime
    ├── nginx.conf               ← reverse proxy /api/* -> backend
    ├── package.json
    ├── vite.config.ts
    ├── index.html               ← titre + favicon
    ├── public/
    │   ├── moncash-logo.svg     ← favicon SVG (triangle rouge)
    │   └── moncah-logo.png      ← fallback favicon PNG
    └── src/
        ├── main.tsx
        ├── App.tsx              ← routing React Router
        ├── pages/               ← pages metier (dashboards)
        ├── components/          ← composants reutilisables
        ├── hooks/               ← hooks React Query pour Databricks
        ├── services/
        │   └── auth.ts          ← ⚠ mode demo actuellement
        └── api/                 ← client HTTP auto-genere OpenAPI
```

### 14.2 Ports utilisés

| Port | Service | Exposition |
|---|---|---|
| 22/tcp | SSH | Hôte (via UFW) |
| 80/tcp | HTTP (nginx frontend) | Hôte (via UFW) |
| 8000/tcp | FastAPI backend | **Interne Docker uniquement** |
| 6379/tcp | Redis | **Interne Docker uniquement** |

### 14.3 Commandes utiles — mémo rapide

```bash
# Ou est le projet ?
cd /opt/moncash-portal

# Etat instantane
docker compose ps
docker system df

# Suivre les logs
docker compose logs -f backend
docker compose logs -f frontend

# Redemarrer apres modif .env
docker compose restart backend

# Deployer une nouvelle version
git pull && docker compose build && docker compose up -d

# Vider le cache
docker compose exec redis redis-cli FLUSHDB

# Shell dans le container backend
docker compose exec backend bash

# Ressources consommees en direct
docker stats --no-stream
```

### 14.4 Variables d'environnement — référence complète

| Nom | Type | Défaut | Description |
|---|---|---|---|
| `DATABRICKS_SERVER_HOSTNAME` | string | (requis) | Endpoint du workspace |
| `DATABRICKS_HTTP_PATH` | string | (requis) | Chemin du SQL Warehouse |
| `ANALYTICS_INPUT_PATH` | string | (requis) | `catalog.schema` source |
| `AZURE_TENANT_ID` | GUID | (vide) | Tenant Azure AD Digicel |
| `AZURE_CLIENT_ID` | GUID | (vide) | App ID Service Principal |
| `AZURE_CLIENT_SECRET` | string | (vide) | Secret Service Principal |
| `SECRET_KEY` | hex 128 chars | (généré) | Signature JWT access |
| `REFRESH_SECRET_KEY` | hex 128 chars | (généré) | Signature JWT refresh |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | int | `30` | Durée validité access token |
| `REFRESH_TOKEN_EXPIRE_DAYS` | int | `7` | Durée validité refresh token |
| `CORS_ORIGINS` | CSV | (requis) | Origines browser autorisées |
| `ALLOWED_HOSTS` | CSV | `*` | Host header allow-list (TrustedHostMiddleware) |
| `CACHE_DEFAULT_TTL` | int | `600` | TTL cache Redis (secondes) |
| `UVICORN_WORKERS` | int | `2` | Nombre workers backend |
| `WEB_PORT` | int | `80` | Port host exposé |

### 14.5 Contacts

| Rôle | Personne | Contact |
|---|---|---|
| Développeur / Owner | Mike JEAN LOUIS | jeanlouismike89@gmail.com |
| Équipe Réseau Digicel | (à compléter) | |
| Équipe Sécurité / Azure | (à compléter) | |
| Équipe Data / Databricks | (à compléter) | |

### 14.6 Références externes

- Documentation Docker Compose : https://docs.docker.com/compose/
- Documentation Databricks SQL : https://docs.databricks.com/sql/
- Documentation FastAPI : https://fastapi.tiangolo.com/
- Documentation Vite : https://vitejs.dev/
- Repo source : https://github.com/Mike5449/MonCash_BI

---

## 📌 Résumé — Déploiement en 10 commandes

Pour un serveur Ubuntu vierge, avec les credentials Azure prêts :

```bash
# 1. Preparation systeme
apt-get update && apt-get upgrade -y
date -s "$(curl -sI https://www.google.com | grep -i '^date:' | sed 's/^[Dd]ate: //I' | tr -d '\r')"

# 2. Docker
curl -fsSL https://get.docker.com | sh
systemctl enable --now docker

# 3. Firewall
ufw allow 22/tcp && ufw allow 80/tcp && ufw --force enable

# 4. Code
git clone https://github.com/Mike5449/MonCash_BI.git /opt/moncash-portal
cd /opt/moncash-portal

# 5. Configuration (ajuster IP + AZURE_* dans .env genere)
cp .env.example .env
nano .env

# 6. Build + demarrage
docker compose build && docker compose up -d

# 7. Verification
docker compose ps
curl -sI http://localhost/
```

Fin du guide.
