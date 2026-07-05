import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const WACHAP_BASE = "https://wachap.app/api";
const DEFAULT_ACCESS_TOKEN = process.env.WACHAP_ACCESS_TOKEN || "";
const DEFAULT_INSTANCE_ID = process.env.WACHAP_INSTANCE_ID || "";

// Stockage en mémoire des événements reçus via webhook (messages entrants)
const inboxEvents = [];
const MAX_EVENTS = 200;

function buildUrl(path, params) {
  const url = new URL(`${WACHAP_BASE}/${path}`);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v);
  });
  return url.toString();
}

async function wachapGet(path, params) {
  const url = buildUrl(path, params);
  const res = await fetch(url);
  const text = await res.text();
  try {
    return { httpStatus: res.status, data: JSON.parse(text) };
  } catch {
    return { httpStatus: res.status, raw: text };
  }
}

function creds(instance_id, access_token) {
  return {
    instance_id: instance_id || DEFAULT_INSTANCE_ID,
    access_token: access_token || DEFAULT_ACCESS_TOKEN,
  };
}

function textResult(obj) {
  return { content: [{ type: "text", text: JSON.stringify(obj, null, 2) }] };
}

function getServer() {
  const server = new McpServer({ name: "wachap-mcp-bridge", version: "1.0.0" });

  server.registerTool(
    "wachap_send_message",
    {
      title: "Envoyer un message WhatsApp à un contact",
      description: "Envoie un message texte à un numéro WhatsApp via WaChap.",
      inputSchema: {
        number: z.string().describe("Numéro international sans + (ex: 22670000000)"),
        message: z.string().describe("Texte du message"),
        instance_id: z.string().optional().describe("Optionnel si défini par défaut sur le serveur"),
        access_token: z.string().optional(),
      },
    },
    async ({ number, message, instance_id, access_token }) => {
      const c = creds(instance_id, access_token);
      const result = await wachapGet("send", { number, type: "text", message, ...c });
      return textResult(result);
    }
  );

  server.registerTool(
    "wachap_send_media",
    {
      title: "Envoyer un média WhatsApp à un contact",
      description: "Envoie une image/fichier avec un message à un numéro WhatsApp via WaChap.",
      inputSchema: {
        number: z.string(),
        message: z.string().optional(),
        media_url: z.string().describe("URL publique du média"),
        filename: z.string().optional().describe("Nom du fichier, requis pour les documents"),
        instance_id: z.string().optional(),
        access_token: z.string().optional(),
      },
    },
    async ({ number, message, media_url, filename, instance_id, access_token }) => {
      const c = creds(instance_id, access_token);
      const result = await wachapGet("send", {
        number,
        type: "media",
        message: message || "",
        media_url,
        filename,
        ...c,
      });
      return textResult(result);
    }
  );

  server.registerTool(
    "wachap_send_group_message",
    {
      title: "Envoyer un message dans un groupe WhatsApp",
      description: "Envoie un message texte dans un groupe WhatsApp via WaChap.",
      inputSchema: {
        group_id: z.string().describe("ID du groupe, format xxxxx-xxxxx@g.us"),
        message: z.string(),
        instance_id: z.string().optional(),
        access_token: z.string().optional(),
      },
    },
    async ({ group_id, message, instance_id, access_token }) => {
      const c = creds(instance_id, access_token);
      const result = await wachapGet("send_group", { group_id, type: "text", message, ...c });
      return textResult(result);
    }
  );

  server.registerTool(
    "wachap_send_group_media",
    {
      title: "Envoyer un média dans un groupe WhatsApp",
      description: "Envoie une image/fichier avec un message dans un groupe WhatsApp via WaChap.",
      inputSchema: {
        group_id: z.string(),
        message: z.string().optional(),
        media_url: z.string(),
        filename: z.string().optional(),
        instance_id: z.string().optional(),
        access_token: z.string().optional(),
      },
    },
    async ({ group_id, message, media_url, filename, instance_id, access_token }) => {
      const c = creds(instance_id, access_token);
      const result = await wachapGet("send_group", {
        group_id,
        type: "media",
        message: message || "",
        media_url,
        filename,
        ...c,
      });
      return textResult(result);
    }
  );

  server.registerTool(
    "wachap_get_groups",
    {
      title: "Lister les groupes WhatsApp",
      description: "Récupère la liste des groupes WhatsApp de l'instance connectée (utile pour retrouver un group_id).",
      inputSchema: {
        instance_id: z.string().optional(),
        access_token: z.string().optional(),
      },
    },
    async ({ instance_id, access_token }) => {
      const c = creds(instance_id, access_token);
      const result = await wachapGet("get_groups", c);
      return textResult(result);
    }
  );

  server.registerTool(
    "wachap_get_qrcode",
    {
      title: "Obtenir le QR code de connexion WhatsApp",
      description: "Récupère le QR code pour connecter ou reconnecter une instance WhatsApp WaChap.",
      inputSchema: {
        instance_id: z.string().optional(),
        access_token: z.string().optional(),
      },
    },
    async ({ instance_id, access_token }) => {
      const c = creds(instance_id, access_token);
      const result = await wachapGet("get_qrcode", c);
      return textResult(result);
    }
  );

  server.registerTool(
    "wachap_reconnect",
    {
      title: "Reconnecter l'instance WhatsApp",
      description: "Force la reconnexion de l'instance WhatsApp en cas de perte de connexion WaChap.",
      inputSchema: {
        instance_id: z.string().optional(),
        access_token: z.string().optional(),
      },
    },
    async ({ instance_id, access_token }) => {
      const c = creds(instance_id, access_token);
      const result = await wachapGet("reconnect", c);
      return textResult(result);
    }
  );

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
  console.log(`WaChap MCP bridge en écoute sur le port ${PORT}`);
});
