// api/spotify-token.js

export default async function handler(req, res) {
  // Einfache CORS-Header, damit der Browser zufrieden ist
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { code, codeVerifier, redirectUri, clientId } = req.body || {};

    if (!code || !codeVerifier || !redirectUri || !clientId) {
      return res.status(400).json({ error: "Missing parameters" });
    }

    const params = new URLSearchParams();
    params.append("grant_type", "authorization_code");
    params.append("code", code);
    params.append("redirect_uri", redirectUri);
    params.append("client_id", clientId);
    params.append("code_verifier", codeVerifier);

    const tokenResp = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: params.toString()
    });

    const data = await tokenResp.json();

    if (!tokenResp.ok) {
      console.error("[api/spotify-token] Spotify-Fehler:", tokenResp.status, data);
      return res.status(tokenResp.status).json(data);
    }

    return res.status(200).json(data);
  } catch (err) {
    console.error("[api/spotify-token] Server-Fehler:", err);
    return res.status(500).json({ error: "internal_error" });
  }
}
