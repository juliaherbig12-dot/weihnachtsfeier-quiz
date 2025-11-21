export default async function handler(req, res) {
  try {
    const { code, codeVerifier, redirectUri, clientId } = req.body;

    const tokenResp = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        code_verifier: codeVerifier
      })
    });

    const data = await tokenResp.json();

    res.status(tokenResp.status).json(data);
  } catch (err) {
    res.status(500).json({ error: "server_error", details: err.toString() });
  }
}
