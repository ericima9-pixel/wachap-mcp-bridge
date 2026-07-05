# WaChap MCP Bridge

Petit serveur qui expose l'API WaChap (WhatsApp) comme un **serveur MCP**, pour que Claude puisse envoyer des messages, publier dans des groupes et lire les messages entrants — directement depuis la conversation.

## Ce que ça fait

- **Côté Claude → WhatsApp** : expose des outils MCP (`wachap_send_message`, `wachap_send_group_message`, `wachap_get_groups`, etc.) qui appellent l'API REST officielle de WaChap (`https://wachap.app/api/...`).
- **Côté WhatsApp → Claude** : reçoit les webhooks WaChap sur `/webhook` et les garde en mémoire (200 derniers événements), consultables via l'outil `wachap_get_recent_inbox`.

## Étape 1 — Déployer le serveur (gratuit, ~5 min)

On utilise **Render.com** (offre gratuite suffisante pour ce cas d'usage).

1. Va sur https://render.com et connecte-toi avec ton compte GitHub.
2. **New +** → **Web Service** → sélectionne le dépôt `wachap-mcp-bridge`.
3. Configuration :
   - **Runtime** : Node
   - **Build Command** : `npm install`
   - **Start Command** : `npm start`
   - **Plan** : Free
4. Dans l'onglet **Environment**, ajoute ces variables :
   - `WACHAP_ACCESS_TOKEN` = ta clé `sk_...` (visible sur `wachap.com/accounts`)
   - `WACHAP_INSTANCE_ID` = l'ID du compte WhatsApp à piloter (colonne "ID DU COMPTE")
5. Clique **Create Web Service**. Render te donne une URL du type :
   `https://wachap-mcp-bridge.onrender.com`

> Note gratuite Render : le service peut "dormir" après 15 min d'inactivité et mettre ~30s à se réveiller au premier appel suivant.

## Étape 2 — Configurer le webhook WaChap (réception)

Dans WaChap → **Comptes WhatsApp** → icône webhook (🔗) à côté de ton compte → **Gestion des Webhooks** :

- **Nom du webhook** : `Claude Bridge`
- **Lien Webhook** : `https://TON-URL-RENDER.onrender.com/webhook`
- Active les événements qui t'intéressent (au minimum "Message reçu d'un contact", et "Message reçu d'un groupe" si besoin)
- **Valider**

## Étape 3 — Connecter le serveur MCP à Claude

Dans Claude (paramètres des connecteurs / MCP), ajoute un connecteur personnalisé avec l'URL :

```
https://TON-URL-RENDER.onrender.com/mcp
```

## Outils disponibles pour Claude

| Outil | Description |
|---|---|
| `wachap_send_message` | Envoie un texte à un contact |
| `wachap_send_media` | Envoie une image/fichier à un contact |
| `wachap_send_group_message` | Envoie un texte dans un groupe |
| `wachap_send_group_media` | Envoie une image/fichier dans un groupe |
| `wachap_get_groups` | Liste les groupes (pour retrouver un `group_id`) |
| `wachap_get_qrcode` | Récupère le QR code de connexion |
| `wachap_reconnect` | Force une reconnexion WhatsApp Web |
| `wachap_get_recent_inbox` | Lit les derniers messages reçus via webhook |

## Test rapide en local (optionnel)

```bash
cp .env.example .env
# éditer .env avec tes vraies valeurs
npm install
npm start
```

Le serveur écoute sur `http://localhost:3000`. Le endpoint MCP est `POST http://localhost:3000/mcp`.
