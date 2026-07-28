import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

// --- Nouvelle infrastructure WaChap (migration wachap.app -> wachap.com, juillet 2026) ---
const WACHAP_BASE = "https://api.wachap.com/v1";
const DEFAULT_SECRET_KEY = process.env.WACHAP_ACCESS_TOKEN || ""; // sk_...
const DEFAULT_ACCOUNT_ID = process.env.WACHAP_INSTANCE_ID || ""; // UUID du compte (ex: d5de4c8b-...)

// Stockage en mémoire des événements reçus via webhook (messages entrants)
const inboxEvents = [];
const MAX_EVENTS = 200;

function creds(accountId, secretKey) {
  return {
    accountId: accountId || DEFAULT_ACCOUNT_ID,
    secretKey: secretKey || DEFAULT_SECRET_KEY,
  };
}

async function wachapPost(path, secretKey, body) {
  const url = `${WACHAP_BASE}/${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${secretKey}`,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  try {
    return { httpStatus: res.status, data: JSON.parse(text) };
  } catch {
    return { httpStatus: res.status, raw: text };
  }
}

async function wachapGetReq(path, secretKey, params = {}) {
  const url = new URL(`${WACHAP_BASE}/${path}`);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v);
  });
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${secretKey}` },
  });
  const text = await res.text();
  try {
    return { httpStatus: res.status, data: JSON.parse(text) };
  } catch {
    return { httpStatus: res.status, raw: text };
  }
}

function textResult(obj) {
  return { content: [{ type: "text", text: JSON.stringify(obj, null, 2) }] };
}

function getServer() {
  const server = new McpServer({ name: "wachap-mcp-bridge", version: "2.0.0" });

  // --- Envoyer un message à un contact (texte, image, audio, vidéo, document, localisation, contact) ---
  server.registerTool(
    "wachap_send_message",
    {
      title: "Envoyer un message WhatsApp à un contact",
      description:
        "Envoie un message (texte, image, audio, vidéo, document, localisation ou contact) à un numéro WhatsApp via WaChap.",
      inputSchema: {
        number: z.string().describe("Numéro international avec + (ex: +22670000000)"),
        type: z
          .enum(["text", "image", "audio", "video", "document", "location", "contact"])
          .default("text")
          .describe("Type de message"),
        content: z.string().optional().describe("Texte du message (requis si type=text)"),
        imageUrl: z.string().optional(),
        audioUrl: z.string().optional(),
        videoUrl: z.string().optional(),
        documentUrl: z.string().optional(),
        fileName: z.string().optional(),
        caption: z.string().optional(),
        latitude: z.number().optional(),
        longitude: z.number().optional(),
        locationName: z.string().optional(),
        address: z.string().optional(),
        accountId: z.string().optional().describe("Optionnel si défini par défaut sur le serveur"),
        access_token: z.string().optional().describe("Secret Key WaChap, optionnel si défini par défaut"),
      },
    },
    async ({
      number,
      type,
      content,
      imageUrl,
      audioUrl,
      videoUrl,
      documentUrl,
      fileName,
      caption,
      latitude,
      longitude,
      locationName,
      address,
      accountId,
      access_token,
    }) => {
      const c = creds(accountId, access_token);
      const result = await wachapPost("whatsapp/messages/send", c.secretKey, {
        data: {
          accountId: c.accountId,
          to: number,
          type,
          content,
          imageUrl,
          audioUrl,
          videoUrl,
          documentUrl,
          fileName,
          caption,
          latitude,
          longitude,
          name: locationName,
          address,
        },
      });
      return textResult(result);
    }
  );

  // --- Envoyer un message dans un groupe ---
  server.registerTool(
    "wachap_send_group_message",
    {
      title: "Envoyer un message dans un groupe WhatsApp",
      description:
        "Envoie un message (texte, image, vidéo, document, audio) dans un groupe WhatsApp via WaChap.",
      inputSchema: {
        group_id: z.string().describe("ID du groupe, format xxxxx@g.us"),
        type: z
          .enum(["text", "image", "video", "document", "audio", "location", "contact"])
          .default("text"),
        content: z.string().optional().describe("Texte du message (requis si type=text)"),
        imageUrl: z.string().optional(),
        caption: z.string().optional(),
        accountId: z.string().optional(),
        access_token: z.string().optional(),
      },
    },
    async ({ group_id, type, content, imageUrl, caption, accountId, access_token }) => {
      const c = creds(accountId, access_token);
      const result = await wachapPost("whatsapp/groups/send", c.secretKey, {
        accountId: c.accountId,
        groupJid: group_id,
        type,
        content,
        imageUrl,
        caption,
      });
      return textResult(result);
    }
  );

  // --- Lister les groupes ---
  server.registerTool(
    "wachap_get_groups",
    {
      title: "Lister les groupes WhatsApp",
      description:
        "Récupère la liste des groupes WhatsApp du compte connecté (utile pour retrouver un group_id/jid).",
      inputSchema: {
        accountId: z.string().optional(),
        access_token: z.string().optional(),
      },
    },
    async ({ accountId, access_token }) => {
      const c = creds(accountId, access_token);
      const result = await wachapPost("whatsapp/groups/list", c.secretKey, {
        accountId: c.accountId,
      });
      return textResult(result);
    }
  );

  // --- Lister les comptes WhatsApp connectés ---
  server.registerTool(
    "wachap_get_accounts",
    {
      title: "Lister les comptes WhatsApp connectés",
      description: "Récupère tous les comptes WhatsApp connectés à l'instance WaChap (avec leur statut).",
      inputSchema: {
        status: z
          .enum(["connected", "disconnected", "connecting", "error"])
          .optional()
          .describe("Filtrer par statut de connexion"),
        access_token: z.string().optional(),
      },
    },
    async ({ status, access_token }) => {
      const c = creds(undefined, access_token);
      const result = await wachapGetReq("whatsapp/accounts", c.secretKey, { status });
      return textResult(result);
    }
  );

  // --- Messages entrants (webhook) ---
  server.registerTool(
    "wachap_get_recent_inbox",
    {
      title: "Voir les messages entrants récents",
      description:
        "Retourne les derniers événements WhatsApp reçus via le webhook WaChap configuré (messages entrants de contacts et/ou groupes selon la config du webhook).",
      inputSchema: {
        limit: z.number().optional().describe("Nombre max d'événements à retourner (défaut 20)"),
      },
    },
    async ({ limit }) => {
      const n = limit || 20;
      const recent = inboxEvents.slice(-n).reverse();
      return textResult({ count: recent.length, events: recent });
    }
  );

  // --- Publier un statut WhatsApp (texte, image ou vidéo) ---
  server.registerTool(
    "wachap_post_status",
    {
      title: "Publier un statut WhatsApp",
      description:
        "Publie un statut WhatsApp (texte, image ou vidéo, avec légende) via WaChap.",
      inputSchema: {
        content: z.string().optional().describe("Texte du statut"),
        imageUrl: z.string().optional().describe("URL de l'image (statut image + texte)"),
        videoUrl: z.string().optional().describe("URL de la vidéo (statut vidéo + texte)"),
        backgroundColor: z.string().optional().describe("Couleur de fond, ex: #7B2CBF"),
        font: z.number().optional(),
        privacyType: z
          .string()
          .optional()
          .describe("Ex: all_contacts, contacts_except, only_share_with"),
        accountId: z.string().optional(),
        access_token: z.string().optional(),
      },
    },
    async ({
      content,
      imageUrl,
      videoUrl,
      backgroundColor,
      font,
      privacyType,
      accountId,
      access_token,
    }) => {
      const c = creds(accountId, access_token);
      const result = await wachapPost("whatsapp/status/post", c.secretKey, {
        accountId: c.accountId,
        content,
        imageUrl,
        videoUrl,
        backgroundColor,
        font,
        privacyType: privacyType || "all_contacts",
      });
      return textResult(result);
    }
  );

  return server;
}

const app = express();
app.use(express.json({ limit: "5mb" }));

// URL à coller dans WaChap > Gestion des Webhooks
app.post("/webhook", (req, res) => {
  const event = { receivedAt: new Date().toISOString(), body: req.body };
  inboxEvents.push(event);
  if (inboxEvents.length > MAX_EVENTS) inboxEvents.shift();
  console.log("Webhook WaChap reçu:", JSON.stringify(event));
  res.status(200).json({ ok: true });
});

app.get("/health", (req, res) => res.json({ status: "ok", time: new Date().toISOString() }));

// Endpoint MCP (mode stateless, une session par requête)
app.post("/mcp", async (req, res) => {
  try {
    const server = getServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

app.get("/mcp", (req, res) => {
  res.status(405).json({ error: "Méthode non autorisée. Utilisez POST pour le protocole MCP." });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`WaChap MCP bridge (v2 - api.wachap.com/v1) en écoute sur le port ${PORT}`);
});
