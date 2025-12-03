console.log("[boot] app.js geladen (finale Version)");

// ======================================================
//  SPOTIFY WEB PLAYBACK SDK – SAFARI-SAFE INIT
// ======================================================
let spotifySDKReadyResolve;
const spotifySDKReady = new Promise((resolve) => {
  spotifySDKReadyResolve = resolve;
});

// wird von der Spotify-SDK aufgerufen, wenn sie fertig ist
window.onSpotifyWebPlaybackSDKReady = () => {
  console.log("Spotify SDK ready (Safari-safe)");
  if (spotifySDKReadyResolve) spotifySDKReadyResolve();
};

// ======================================================
//  FIREBASE SETUP
// ======================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-app.js";
import { getDatabase, ref, set, update, onValue, get } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyCjzRjDFtOL_b46qoSp_StbA33Gx2teIFs",
  authDomain: "weihnachtsquiz-mta.firebaseapp.com",
  databaseURL: "https://weihnachtsquiz-mta-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "weihnachtsquiz-mta",
  storageBucket: "weihnachtsquiz-mta.appspot.com",
  messagingSenderId: "816671471599",
  appId: "1:816671471599:web:9255059bd2707095aaa81a"
};
const app = initializeApp(firebaseConfig);
const db  = getDatabase(app);

// ======================================================
//  SPOTIFY PKCE + PLAYER
// ======================================================
const clientId      = "5d0dd83f585a4ad3b9c28d86185df6a6";
const redirectUri   = "https://weihnachtsfeier-quiz.vercel.app";
const playlistURI   = "spotify:playlist:5YUM8W5TlJeqTvbb07Wsk2";
const tokenEndpoint = "/api/spotify-token";

let spotifyToken    = null;
let spotifyDeviceId = null;
let spotifyPlayer   = null;

// wie lange maximal pro Runde spielen (ms)
const SNIPPET_DURATION_MS = 60000;

// sofort stoppen (z.B. beim Klick auf "Weiter")
function stopSnippetImmediately() {
  if (spotifyPlayer) {
    spotifyPlayer.pause().catch(() => {});
  }
}

// ---------- PKCE-Helper ----------
function generateCodeVerifier(length = 64) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

async function generateCodeChallenge(verifier) {
  const data   = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ---------- SDK laden & auf Ready warten ----------
async function loadSpotifySDK() {
  // Wenn schon da, nichts tun
  if (window.Spotify && window.Spotify.Player) return;

  // Script nur einmal einfügen
  if (!document.querySelector('script[src="https://sdk.scdn.co/spotify-player.js"]')) {
    const s   = document.createElement("script");
    s.src     = "https://sdk.scdn.co/spotify-player.js";
    s.async   = true;
    s.defer   = true;
    s.onerror = (e) => console.error("Spotify SDK load error:", e);
    document.body.appendChild(s);
  }

  // Warten, bis onSpotifyWebPlaybackSDKReady feuert
  await spotifySDKReady;
}

// ---------- Login ----------
async function loginSpotify() {
  try {
    const verifier = generateCodeVerifier();
    localStorage.setItem("spotify_pkce_verifier", verifier);

    const challenge = await generateCodeChallenge(verifier);

    const params = new URLSearchParams({
      client_id: clientId,
      response_type: "code",
      redirect_uri: redirectUri,
      code_challenge: challenge,
      code_challenge_method: "S256",
      scope: [
        "streaming",
        "user-read-email",
        "user-read-private",
        "user-modify-playback-state",
        "user-read-playback-state"
      ].join(" ")
    });

    // Safari-Fix: Verifier zusätzlich in URL mitschicken
    params.append("pkce", verifier);

    window.location.href = "https://accounts.spotify.com/authorize?" + params.toString();
  } catch (err) {
    console.error("loginSpotify error:", err);
    alert("Spotify-Login ist fehlgeschlagen. Versuche es bitte nochmal.");
  }
}

// ---------- Code -> Token ----------
async function exchangeCodeForToken(code) {
  // Verifier aus URL oder Fallback localStorage
  const url      = new URL(window.location.href);
  const verifier = url.searchParams.get("pkce") || localStorage.getItem("spotify_pkce_verifier");

  if (!verifier) {
    console.error("Kein PKCE-Verifier gefunden.");
    return null;
  }

  const resp = await fetch(tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      code,
      codeVerifier: verifier,
      redirectUri,
      clientId
    })
  });

  const data = await resp.json();
  if (!resp.ok) {
    console.error("Token-Exchange fehlgeschlagen:", data);
    return null;
  }

  spotifyToken = data.access_token;
  localStorage.setItem("spotify_access_token", spotifyToken);

  return spotifyToken;
}

// ---------- Spotify Player ----------
async function createSpotifyPlayer() {
  if (!spotifyToken) {
    console.warn("createSpotifyPlayer ohne Token aufgerufen.");
    return;
  }

  await loadSpotifySDK();

  if (!window.Spotify || !window.Spotify.Player) {
    console.error("Spotify SDK ist nicht korrekt geladen.");
    return;
  }

  spotifyPlayer = new Spotify.Player({
    name: "Emoji-Quiz Player",
    getOAuthToken: cb => cb(spotifyToken),
    volume: 0.8
  });

  spotifyPlayer.addListener("ready", ({ device_id }) => {
    spotifyDeviceId = device_id;
    console.log("Spotify Player bereit, Device:", device_id);
  });

  spotifyPlayer.addListener("initialization_error", ({ message }) => {
    console.error("Spotify init error:", message);
  });
  spotifyPlayer.addListener("authentication_error", ({ message }) => {
    console.error("Spotify auth error:", message);
  });
  spotifyPlayer.addListener("account_error", ({ message }) => {
    console.error("Spotify account error:", message);
  });
  spotifyPlayer.addListener("playback_error", ({ message }) => {
    console.error("Spotify playback error:", message);
  });

  spotifyPlayer.connect();
}

// ---------- Song-Snippet abspielen (Host-only, Lösungsphase) ----------
async function playSongSnippetForRound(roundIndex) {
  if (!spotifyToken || !spotifyDeviceId || !spotifyPlayer) {
    console.warn("[spotify] Player nicht bereit oder kein Token.");
    return;
  }

  // Startposition aus QUESTIONS oder Fallback 30s
  const defaultStartMs = 30000;
  const startMs = QUESTIONS[roundIndex]?.startMs ?? defaultStartMs;

  try {
    await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${spotifyDeviceId}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${spotifyToken}`
      },
      body: JSON.stringify({
        context_uri: playlistURI,
        offset: { position: roundIndex }, // gleiche Reihenfolge wie QUESTIONS[]
        position_ms: startMs
      })
    });

    // nach 60s automatisch stoppen (falls der Host nicht klickt)
    setTimeout(() => {
      if (spotifyPlayer) {
        spotifyPlayer.pause().catch(() => {});
      }
    }, SNIPPET_DURATION_MS);

  } catch (err) {
    console.error("[spotify] play failed:", err);
  }
}

// ---------- Redirect Handling ----------
async function handleSpotifyRedirect() {
  const params = new URLSearchParams(window.location.search);
  const code   = params.get("code");

  if (code) {
    const tok = await exchangeCodeForToken(code);

    if (tok) {
      await createSpotifyPlayer();
    }

    // URL aufräumen (code/state/pkce entfernen)
    try {
      const clean = new URL(window.location.href);
      clean.searchParams.delete("code");
      clean.searchParams.delete("state");
      clean.searchParams.delete("pkce");
      history.replaceState({}, "", clean.pathname + clean.search);
    } catch {}
  } else {
    // evtl. vorhandenen Token aus localStorage nutzen
    const stored = localStorage.getItem("spotify_access_token");
    if (stored) {
      spotifyToken = stored;
      await createSpotifyPlayer();
    }
  }
}

// ======================================================
//  QUIZ-DATEN
// ======================================================
const QUESTIONS = [
  { emoji:"🤫🌌😇🌌", title:"Stille Nacht, heilige Nacht", startMs:15000 },
  { emoji:"🎄🌿", title:"O Tannenbaum", startMs:14000 },
  { emoji:"🤫🌨️❄️", title:"Leise rieselt der Schnee", startMs:16000 },
  { emoji:"🗓️🔁", title:"Alle Jahre wieder", startMs:9000 },
  { emoji:"😲🫵😁", title:"O du fröhliche", startMs:8000 },
  { emoji:"🎼🔊🔔", title:"Kling, Glöckchen, klingelingeling", startMs:12000 },
  { emoji:"😁❤️😂💃🎅🏼", title:"Lasst uns froh und munter sein", startMs:16000 },
  { emoji:"🔔🔔🔔", title:"Jingle Bells", startMs:29000 },
  { emoji:"🔴👃🦌", title:"Rudolph the Red Nosed Reindeer", startMs:5000 },
  { emoji:"🎄🔙🤲🫵❤️", title:"Last Christmas", startMs:17000 },
  { emoji:"📝1️⃣🎁🫵", title:"All I Want for Christmas Is You", startMs:85000 },
  { emoji:"😲👶👐", title:"Ihr Kinderlein kommet", startMs:15000 },
  { emoji:"👥🗣️😁🎄😂🆕🗓️", title:"We Wish You a Merry Christmas", startMs:6000 },
  { emoji:"🔜👶❓🎁🔜😁", title:"Morgen, Kinder, wird’s was geben", startMs:7000 }
];

// ============== Musik-Tracks (gleichen Reihenfolge wie QUESTIONS) ==============
const TRACKS = [
  "spotify:track:4qfPuvrFSxPoKxFPTCgFHG", // 1 Stille Nacht
  "spotify:track:4L01qPvvrLpzjAU6YewsGQ", // 2 O Tannenbaum
  "spotify:track:3BFGSCDtnznuaCG2KC9VmO", // 3 Leise rieselt der Schnee
  "spotify:track:6ZqI26Bd0q0h6RRGMZLZtA", // 4 Alle Jahre wieder
  "spotify:track:5JMzHxVh9Yx8RJWbR4p9G9", // 5 O du fröhliche
  "spotify:track:0L3L0a0zDAoFwRKIYYNP6P", // 6 Kling Glöckchen
  "spotify:track:1adcjxlYjX4jG3Ejj6LikU", // 7 Lasst uns froh und munter sein
  "spotify:track:6oJ6le65B3SEqPwMRNXWjY", // 8 Jingle Bells
  "spotify:track:1qU8E4qpG0wQmK7fQBZG1V", // 9 Rudolph
  "spotify:track:5fgVsemWi9sWnGdCapjK0X", // 10 Last Christmas
  "spotify:track:0bYg9bo50gSsH3LtXe2SQn", // 11 All I Want for Christmas
  "spotify:track:1YjK0//9ojJqR0bAKPjW2C", // 12 Ihr Kinderlein kommet
  "spotify:track:3bN6p0omHeORh1oD7XYe6Y", // 13 We Wish You
  "spotify:track:2SOfJr5B9ZekNDPd7oUHnW"  // 14 Morgen, Kinder
];


const POINTS           = 125;
const ANSWER_SECONDS   = 45;
const SOLUTION_SECONDS = 30;

// ======================================================
//  HELPER / UTILS
// ======================================================
const $ = (s) => document.querySelector(s);

function rid(len = 6) {
  const c = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: len }, () => c[Math.floor(Math.random() * c.length)]).join("");
}

function normalize(s) {
  if (!s) return "";
  return s.toLowerCase().normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, "und")
    .replace(/[^a-z0-9äöüß \-]+/g, " ")
    .replace(/\b(der|die|das|ein|eine|und|the|a|an|oh|o)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function lev(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[m][n];
}

function fuzzyMatch(input, target) {
  const a = normalize(input), t = normalize(target);
  if (a === t) return true;

  const d   = lev(a, t);
  const tol = Math.max(1, Math.min(4, Math.round(t.length * 0.25)));
  return d <= tol;
}

function animateProgress(bar, duration) {
  return new Promise(resolve => {
    const start = performance.now();
    function step(t) {
      const p = Math.min(1, (t - start) / duration);
      bar.style.width = (p * 100) + "%";
      if (p < 1) requestAnimationFrame(step);
      else { bar.style.width = "0%"; resolve(); }
    }
    requestAnimationFrame(step);
  });
}

// ======================================================
//  DOM-REFERENZEN
// ======================================================
const screenHost   = $("#screen-host");
const hostPanel    = $("#hostPanel");
const createGameBtn= $("#createGameBtn");
const gameIdHost   = $("#gameIdHost");
const phaseLabel   = $("#phaseLabel");
const roundNowEl   = $("#roundNow");
const roundTotalEl = $("#roundTotal");
const progressBar  = $("#progressBar");
const hostEmoji    = $("#hostEmoji");
const solutionText = $("#solutionText");
const top5El       = $("#top5");
const playerList   = $("#playerList");
const startGameBtn = $("#startGameBtn");
const answerReview = $("#answerReview");
const saveManualBtn= $("#saveManualBtn");

const screenJoin   = $("#screen-join");
const joinGameIdI  = $("#joinGameId");
const playerNameI  = $("#playerName");
const enterBtn     = $("#enterBtn");

const screenPlayer = $("#screen-player");
const gameIdSmall  = $("#gameIdSmall");
const roundNowP    = $("#roundNowP");
const roundTotalP  = $("#roundTotalP");
const waitBox      = $("#waitBox");
const questionBox  = $("#questionBox");
const solutionBox  = $("#solutionBox");
const emojiEl      = $("#emoji");
const progressBarP = $("#progressBarP");
const ansI         = $("#answer");
const submitBtn    = $("#submitBtn");
const savedMsg     = $("#savedMsg");
const resultIcon   = $("#resultIcon");
const resultText   = $("#resultText");
const solutionTextP= $("#solutionTextP");

const screenResult = $("#screen-result");
const finalBoard   = $("#finalBoard");
const restartBtn   = $("#restartBtn");

roundTotalP.textContent  = QUESTIONS.length;
roundTotalEl.textContent = QUESTIONS.length;

// Helpers für Screens
function show(el){ el.classList.remove("hidden"); }
function hide(el){ el.classList.add("hidden"); }
function goto(elShow){
  [screenHost, screenJoin, screenPlayer, screenResult]
    .forEach(el => el.classList.add("hidden"));
  elShow.classList.remove("hidden");
}

// ======================================================
//  QR-CODE (nur /?join, NIE ID)
// ======================================================
function updateShareLink(id) {
  const joinUrl = "https://weihnachtsfeier-quiz.vercel.app/?join";
  const qr = document.getElementById("qrcode");
  qr.innerHTML = "";

  new QRCode(qr, {
    text: joinUrl,
    width: 180,
    height: 180,
    colorDark: "#ffffff",
    colorLight: "#0b1429",
    correctLevel: QRCode.CorrectLevel.H
  });
}

// ======================================================
//  STATE
// ======================================================
let gameId = null;
let myId   = null;
let myName = null;

// ======================================================
//  HOST: SPIEL ERSTELLEN
// ======================================================
createGameBtn.onclick = async () => {
  try {
    const id = rid();
    gameId = id;

    await set(ref(db, `games/${id}`), {
      createdAt: Date.now(),
      state: { round: 0, phase: "waiting" },
      players: {}
    });

    gameIdHost.textContent = id;
    phaseLabel.textContent = "Warten …";
    updateShareLink(id);
    show(hostPanel);
    listenPlayersInLobby();
  } catch (err) {
    alert("Fehler beim Erstellen des Spiels: " + err);
  }
};

function listenPlayersInLobby() {
  onValue(ref(db, `games/${gameId}/players`), snap => {
    const players = snap.val() || {};
    playerList.innerHTML = "";
    Object.values(players).forEach(p => {
      const d = document.createElement("div");
      d.className = "playerRow";
      d.innerHTML = `<b>${p.name}</b> <span class="meta">${p.score || 0} Punkte</span>`;
      playerList.appendChild(d);
    });
  });
}

// ======================================================
//  SPIEL STARTEN (HOST)
// ======================================================
startGameBtn.onclick = async () => {
  try {
    startGameBtn.disabled = true;

    await update(ref(db, `games/${gameId}/state`), {
      phase: "question",
      round: 0,
      ts: Date.now()
    });

    autoRoundLoop();
  } catch (err) {
    alert("Fehler: " + err);
    startGameBtn.disabled = false;
  }
};

// ======================================================
//  RUNDEN-FLOW (HOST)
// ======================================================
async function autoRoundLoop() {
  for (let r = 0; r < QUESTIONS.length; r++) {

    // PHASE: FRAGE
    await update(ref(db, `games/${gameId}/state`), {
      round: r,
      phase: "question",
      ts: Date.now()
    });

    hostEmoji.textContent = QUESTIONS[r].emoji;
    solutionText.classList.add("hidden");
    phaseLabel.textContent = "Frage";
    roundNowEl.textContent = r + 1;
    answerReview.innerHTML = "";

    await animateProgress(progressBar, ANSWER_SECONDS * 1000);

    await initialAutoScoring(r);

    // PHASE: LÖSUNG
    await update(ref(db, `games/${gameId}/state`), {
      phase: "solution",
      ts: Date.now()
    });

    solutionText.textContent = "Lösung: " + QUESTIONS[r].title;
    solutionText.classList.remove("hidden");
    phaseLabel.textContent = "Lösung";

    // 🎵 Song-Snippet abspielen
    playSongSnippetForRound(r);

    await renderTop5();
    await renderAnswersForReview(r);

    // Weiter zur nächsten Frage
    const btn = document.createElement("button");
    btn.textContent = "Weiter zur nächsten Frage";
    btn.className = "btn mt-1";
    solutionText.insertAdjacentElement("afterend", btn);

    await new Promise(res => {
      btn.onclick = () => {
        stopSnippetImmediately();  // Musik sofort stoppen
        btn.remove();
        res();
      };
    });
  }

  // PHASE: ENDE
  await update(ref(db, `games/${gameId}/state`), {
    phase: "end",
    ts: Date.now()
  });

  phaseLabel.textContent = "Ende";
  solutionText.textContent = "Frohe Weihnachten!";

  await renderTop5();
  await renderFinal();
  goto(screenResult);
}

// ======================================================
//  AUTOMATISCHE BEWERTUNG
// ======================================================
async function initialAutoScoring(round) {
  const snap    = await get(ref(db, `games/${gameId}/players`));
  const players = snap.val() || {};

  const result = {};

  for (const [pid, p] of Object.entries(players)) {
    const ans   = p.answers?.[round]?.text || "";
    const ok    = fuzzyMatch(ans, QUESTIONS[round].title);
    const prev  = p.score || 0;
    const wasOk = p.answers?.[round]?.correct === true;
    const add   = ok && !wasOk ? POINTS : 0;

    result[pid] = {
      name: p.name,
      score: prev + add,
      answers: {
        ...(p.answers || {}),
        [round]: { text: ans, correct: ok }
      }
    };
  }

  const updates = {};
  for (const [pid, p] of Object.entries(result)) {
    updates[`games/${gameId}/players/${pid}`] = p;
  }
  if (Object.keys(updates).length) {
    await update(ref(db), updates);
  }
}

// ======================================================
//  MANUELLE KORREKTUR
// ======================================================
async function renderAnswersForReview(round) {
  const snap    = await get(ref(db, `games/${gameId}/players`));
  const players = snap.val() || {};

  answerReview.innerHTML = "";

  Object.entries(players).forEach(([pid, p]) => {
    const ansObj = p.answers?.[round] || { text: "(keine Antwort)", correct: false };
    const ansTxt = ansObj.text || "(keine Antwort)";
    const ok     = !!ansObj.correct;

    const row = document.createElement("div");
    row.className  = "playerRow";
    row.dataset.pid= pid;

    row.innerHTML = `
      <div>
        <b>${p.name}</b> <span class="tag">Runde ${round + 1}</span><br>
        <span class="meta">${ansTxt}</span>
      </div>
      <div>
        <button class="btn ghost markBtn" data-value="true"
          style="background:${ok ? "#16a34a" : "#334155"}">✅</button>
        <button class="btn ghost markBtn" data-value="false"
          style="background:${!ok ? "#dc2626" : "#334155"}">❌</button>
      </div>
    `;
    answerReview.appendChild(row);
  });

  // Klick-Events
  answerReview.querySelectorAll(".markBtn").forEach(btn => {
    btn.onclick = () => {
      const wrap = btn.parentElement;
      wrap.querySelectorAll(".markBtn").forEach(b => b.style.background = "#334155");

      const val = btn.dataset.value === "true";
      btn.style.background = val ? "#16a34a" : "#dc2626";
      btn.closest(".playerRow").dataset.mark = val.toString();
    };
  });

  // Speichern
  saveManualBtn.onclick = async () => {
    const rows    = [...answerReview.querySelectorAll(".playerRow")];
    const changes = {};

    for (const row of rows) {
      if (row.dataset.mark === undefined) continue;

      const pid  = row.dataset.pid;
      const mark = row.dataset.mark === "true";

      const psnap = await get(ref(db, `games/${gameId}/players/${pid}`));
      const p     = psnap.val();
      const oldOk = p.answers?.[round]?.correct || false;

      let score = p.score || 0;
      if (mark && !oldOk) score += POINTS;
      if (!mark && oldOk) score -= POINTS;

      changes[`games/${gameId}/players/${pid}/answers/${round}/correct`] = mark;
      changes[`games/${gameId}/players/${pid}/score`]                   = score;
    }

    if (Object.keys(changes).length) {
      await update(ref(db), changes);
    }

    alert("Korrekturen gespeichert ✔️");
    await renderTop5();
    await renderAnswersForReview(round);
  };
}

// ======================================================
//  TOP 5 & FINALE LISTE
// ======================================================
async function renderTop5() {
  const snap = await get(ref(db, `games/${gameId}/players`));
  const arr  = Object.values(snap.val() || {})
    .map(p => ({ name: p.name, score: p.score || 0 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  top5El.innerHTML = "";

  arr.forEach((p, i) => {
    const medal = ["🥇", "🥈", "🥉"][i] || "🎄";
    const d = document.createElement("div");
    d.className = "playerRow";
    d.innerHTML = `<div>${medal} <b>${p.name}</b></div><div>${p.score} Punkte</div>`;
    top5El.appendChild(d);
  });
}

async function renderFinal() {
  const snap = await get(ref(db, `games/${gameId}/players`));
  const arr  = Object.values(snap.val() || {})
    .map(p => ({ name: p.name, score: p.score || 0 }))
    .sort((a, b) => b.score - a.score);

  finalBoard.innerHTML = "";

  arr.forEach((p, i) => {
    const medal = ["🥇", "🥈", "🥉"][i] || "🎄";
    const d = document.createElement("div");
    d.className = "playerRow";
    d.innerHTML = `<div>${medal} <b>${p.name}</b></div><div>${p.score} Punkte</div>`;
    finalBoard.appendChild(d);
  });
}

// ======================================================
//  PLAYER-FLOW
// ======================================================

// QR-/URL-Startmodus
const url = new URL(window.location.href);
let startMode = url.searchParams.has("join") ? "join" : "host";

// DOMContentLoaded: Screen + Spotify-Redirect
document.addEventListener("DOMContentLoaded", () => {
  if (startMode === "join") {
    goto(screenJoin);
  } else {
    goto(screenHost);
  }

  const btn = document.getElementById("spotifyLoginBtn");
  if (btn) btn.onclick = loginSpotify;

  handleSpotifyRedirect();
});

// Spieler tritt bei
enterBtn.onclick = async () => {
  const gid  = joinGameIdI.value.trim().toUpperCase();
  const name = playerNameI.value.trim();

  if (!gid || !name) {
    alert("Bitte Spiel-ID und Namen eingeben.");
    return;
  }

  const snap = await get(ref(db, `games/${gid}`));
  if (!snap.exists()) {
    alert("Spiel nicht gefunden.");
    return;
  }

  gameId = gid;
  myName = name;
  myId   = "p_" + Math.random().toString(36).slice(2, 10);

  await set(ref(db, `games/${gameId}/players/${myId}`), {
    name: myName,
    score: 0,
    answers: {}
  });

  gameIdSmall.textContent = gameId;
  goto(screenPlayer);
  listenStateAsPlayer();
};

// Player State Listener
function listenStateAsPlayer() {
  onValue(ref(db, `games/${gameId}/state`), async snap => {
    const s = snap.val() || { phase: "waiting", round: 0 };

    roundNowP.textContent = (s.round || 0) + 1;

    if (s.phase === "waiting") {
      show(waitBox);
      hide(questionBox);
      hide(solutionBox);
      return;
    }

    if (s.phase === "question") {
      const r = s.round;

      emojiEl.textContent = QUESTIONS[r].emoji;
      ansI.value = "";
      savedMsg.classList.add("hidden");

      show(questionBox);
      hide(waitBox);
      hide(solutionBox);

      const remaining = Math.max(0, ANSWER_SECONDS * 1000 - (Date.now() - s.ts));
      animateProgress(progressBarP, remaining);
      return;
    }

    if (s.phase === "solution") {
      const r = s.round;

      const aSnap = await get(ref(db, `games/${gameId}/players/${myId}/answers/${r}`));
      const ans   = aSnap.val();

      const ok = ans
        ? ans.correct
        : fuzzyMatch(ans?.text || "", QUESTIONS[r].title);

      resultIcon.textContent = ok ? "✅" : "❌";
      resultText.textContent = ok ? "Richtig!" : "Leider falsch!";
      resultText.className   = ok ? "big correct" : "big wrong";

      solutionTextP.textContent = "Lösung: " + QUESTIONS[r].title;

      show(solutionBox);
      hide(questionBox);
      hide(waitBox);

      const remaining = Math.max(0, SOLUTION_SECONDS * 1000 - (Date.now() - s.ts));
      animateProgress(progressBarP, remaining);
      return;
    }

    if (s.phase === "end") {
      hide(questionBox);
      hide(waitBox);
      show(solutionBox);

      const snapPlayers = await get(ref(db, `games/${gameId}/players`));
      const players     = snapPlayers.val() || {};

      const arr = Object.entries(players).map(([pid, p]) => ({
        id: pid,
        name: p.name,
        score: p.score || 0
      })).sort((a, b) => b.score - a.score);

      const total   = arr.length;
      const myIndex = arr.findIndex(p => p.id === myId);
      const myPlace = myIndex >= 0 ? myIndex + 1 : null;
      const myScore = players[myId]?.score || 0;

      resultIcon.textContent = "🎉";
      resultText.className   = "big";

      if (myPlace !== null) {
        resultText.textContent   = `Du bist Platz ${myPlace} von ${total}!`;
        solutionTextP.textContent = `Deine Punktzahl: ${myScore} Punkte`;
      } else {
        resultText.textContent   = "Danke fürs Mitspielen!";
        solutionTextP.textContent = "";
      }
    }
  });
}

// Antwort abschicken
submitBtn.onclick = async () => {
  const s = await get(ref(db, `games/${gameId}/state`));
  if (s.val()?.phase !== "question") return;

  const r    = s.val().round;
  const text = ansI.value.trim();
  if (!text) return;

  await update(ref(db, `games/${gameId}/players/${myId}/answers`), {
    [r]: { text }
  });

  savedMsg.classList.remove("hidden");
  ansI.value = "";
};

// Restart
restartBtn.onclick = () => {
  location.href = location.origin + location.pathname;
};
