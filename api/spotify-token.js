export default async function handler(req, res) {
  // CORS aktivieren
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const { code, codeVerifier, redirectUri, clientId } = req.body;

  if (!code || !codeVerifier || !redirectUri || !clientId) {
    return res.status(400).json({ error: "Missing parameters" });
  }

  const tokenUrl = "https://accounts.spotify.com/api/token";
  const params = new URLSearchParams({
    client_id: clientId,
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
  });

  try {
    const spotifyResp = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
    });

    const data = await spotifyResp.json();

    if (!spotifyResp.ok) {
      return res.status(spotifyResp.status).json(data);
    }

    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: "Server error", details: err.message });
  }
}
