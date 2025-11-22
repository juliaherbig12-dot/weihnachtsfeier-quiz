console.log("[boot] app.js geladen (finale Vercel-Version)");

// ============== Firebase Setup ==============
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

// ============== Spotify PKCE + Player (über Vercel) ==============

const clientId     = "5d0dd83f585a4ad3b9c28d86185df6a6";
const redirectUri  = "https://weihnachtsfeier-quiz.vercel.app"; 
const playlistURI  = "spotify:playlist:5YUM8W5TlJeqTvbb07Wsk2";
const tokenEndpoint = "/api/spotify-token";

let spotifyToken   = null;
let spotifyDeviceId = null;
let spotifyPlayer  = null;
let currentQuestionIndex = 0;

// --- Sofort Musik stoppen (für "Weiter zur nächsten Frage") ---
function stopSnippetImmediately() {
  if (spotifyPlayer) {
    spotifyPlayer.pause().catch(err => console.warn("[spotify] stop failed:", err));
  }
}

// ---------- PKCE ----------
function generateCodeVerifier(length = 64) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  let out = "";
  for (let i = 0; i < length; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

async function generateCodeChallenge(verifier) {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ---------- Spotify SDK laden ----------
function loadSpotifySDK() {
  return new Promise((resolve, reject) => {
    if (window.Spotify) return resolve();
    const s = document.createElement("script");
    s.src = "https://sdk.scdn.co/spotify-player.js";
    s.onload = resolve;
    s.onerror = reject;
    document.body.appendChild(s);
  });
}

// ---------- Login ----------
async function loginSpotify() {
  const verifier = generateCodeVerifier();
  localStorage.setItem("spotify_pkce_verifier", verifier);

  const challenge = await generateCodeChallenge(verifier);
  const scope = [
    "streaming","user-read-email","user-read-private",
    "user-modify-playback-state","user-read-playback-state"
  ].join(" ");

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    code_challenge_method: "S256",
    code_challenge: challenge,
    scope
  });

  window.location.href = "https://accounts.spotify.com/authorize?" + params.toString();
}

// ---------- Code -> Token ----------
async function exchangeCodeForToken(code) {
  const verifier = localStorage.getItem("spotify_pkce_verifier");

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
  if (!resp.ok) return null;

  spotifyToken = data.access_token;
  localStorage.setItem("spotify_access_token", spotifyToken);

  try {
    const url = new URL(window.location.href);
    url.searchParams.delete("code");
    url.searchParams.delete("state");
    history.replaceState({}, document.title, url.pathname);
  } catch {}

  return spotifyToken;
}

// ---------- Spotify Player ----------
async function createSpotifyPlayer() {
  if (!spotifyToken) return;

  await loadSpotifySDK();

  spotifyPlayer = new Spotify.Player({
    name: "Emoji-Quiz Player",
    getOAuthToken: cb => cb(spotifyToken),
    volume: 0.8
  });

  spotifyPlayer.addListener("ready", ({ device_id }) => {
    spotifyDeviceId = device_id;
    console.log("[spotify] Player bereit:", device_id);
  });

  spotifyPlayer.connect();
}
// ---------- Song-Snippet abspielen (Host Only) ----------
async function playSongSnippetForRound(roundIndex) {
  if (!spotifyToken || !spotifyDeviceId || !spotifyPlayer) {
    console.warn("[spotify] Player nicht bereit.");
    return;
  }

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
        offset: { position: roundIndex },
        position_ms: startMs
      })
    });

    setTimeout(() => {
      spotifyPlayer.pause().catch(e => console.warn("[spotify] pause failed:", e));
    }, 20000);

  } catch (err) {
    console.error("[spotify] play failed:", err);
  }
}

// ---------- Redirect Handling ----------
async function handleSpotifyRedirect() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");

  if (code) {
    const tok = await exchangeCodeForToken(code);
    if (tok) await createSpotifyPlayer();
  } else {
    const stored = localStorage.getItem("spotify_access_token");
    if (stored) {
      spotifyToken = stored;
      await createSpotifyPlayer();
    }
  }
}

// ============== Quiz-Daten ==============
const QUESTIONS = [
  { emoji:"🤫🌌😇🌌", title:"Stille Nacht, heilige Nacht", startMs: 15000 },
  { emoji:"🎄🌿", title:"O Tannenbaum", startMs: 14000 },
  { emoji:"🤫🌨️❄️", title:"Leise rieselt der Schnee", startMs: 16000 },
  { emoji:"🗓️🔁", title:"Alle Jahre wieder", startMs: 9000 },
  { emoji:"😲🫵😁", title:"O du fröhliche", startMs: 8000 },
  { emoji:"🎼🔊🔔", title:"Kling, Glöckchen, klingelingeling", startMs: 12000 },
  { emoji:"😁❤️😂💃🎅🏼", title:"Lasst uns froh und munter sein", startMs: 16000 },
  { emoji:"🔔🔔🔔", title:"Jingle Bells", startMs: 29000 },
  { emoji:"🔴👃🦌", title:"Rudolph the Red-Nosed Reindeer", startMs: 5000 },
  { emoji:"🎄🔙🤲🫵❤️", title:"Last Christmas", startMs: 17000 },
  { emoji:"📝1️⃣🎁🫵", title:"All I Want for Christmas Is You", startMs: 85000 },
  { emoji:"😲👶👐", title:"Oh, Kinderlein kommet", startMs: 15000 },
  { emoji:"👥🗣️😁🎄😂🆕🗓️", title:"We Wish You a Merry Christmas", startMs: 6000 },
  { emoji:"🔜👶❓🎁🔜😁", title:"Morgen, Kinder, wird’s was geben", startMs: 7000 }
];

const POINTS = 125;
const ANSWER_SECONDS = 45;
const SOLUTION_SECONDS = 30;
const ROUND_TOTAL = QUESTIONS.length;

// ============== Utils ==============
const $ = (s)=>document.querySelector(s);
function rid(len=6){
  const c="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({length:len},()=>c[Math.floor(Math.random()*c.length)]).join("");
}
function normalize(s){
  if(!s) return "";
  return s.toLowerCase().normalize("NFD")
    .replace(/[\u0300-\u036f]/g,"")
    .replace(/&/g,"und")
    .replace(/[^a-z0-9äöüß \-]+/g," ")
    .replace(/\b(der|die|das|ein|eine|und|the|a|an|oh|o)\b/g," ")
    .replace(/\s+/g," ").trim();
}
function lev(a,b){
  const m=a.length,n=b.length;
  const dp=Array.from({length:m+1},()=>Array(n+1).fill(0));
  for(let i=0;i<=m;i++) dp[i][0]=i;
  for(let j=0;j<=n;j++) dp[0][j]=j;
  for(let i=1;i<=m;i++){
    for(let j=1;j<=n;j++){
      const cost=a[i-1]===b[j-1]?0:1;
      dp[i][j]=Math.min(
        dp[i-1][j]+1,
        dp[i][j-1]+1,
        dp[i-1][j-1]+cost
      );
    }
  }
  return dp[m][n];
}
function fuzzyMatch(input,target){
  const a=normalize(input), t=normalize(target);
  if(a===t) return true;
  const d=lev(a,t);
  const tol=Math.max(1,Math.min(4,Math.round(t.length*0.25)));
  return d<=tol;
}
function animateProgress(bar,duration){
  return new Promise(resolve=>{
    const start=performance.now();
    function step(t){
      const p=Math.min(1,(t-start)/duration);
      bar.style.width=(p*100)+"%";
      if(p<1) requestAnimationFrame(step);
      else { bar.style.width="0%"; resolve(); }
    }
    requestAnimationFrame(step);
  });
}
// ============== DOM-Referenzen ==============
const screenHost = $("#screen-host");
const hostPanel  = $("#hostPanel");
const createGameBtn = $("#createGameBtn");
const joinGameIdHost = $("#joinGameIdHost");
const joinHostBtn = $("#joinHostBtn");
const gameIdHost  = $("#gameIdHost");
const phaseLabel  = $("#phaseLabel");
const shareLinkI  = $("#shareLink");
const copyLinkBtn = $("#copyLinkBtn");
const roundNowEl  = $("#roundNow");
const roundTotalEl= $("#roundTotal");
const progressBar = $("#progressBar");
const hostEmoji   = $("#hostEmoji");
const solutionText= $("#solutionText");
const top5El      = $("#top5");
const playerList  = $("#playerList");
const startGameBtn= $("#startGameBtn");
const answerReview= $("#answerReview");
const saveManualBtn = $("#saveManualBtn");

const screenJoin  = $("#screen-join");
const joinGameIdI = $("#joinGameId");
const playerNameI = $("#playerName");
const enterBtn    = $("#enterBtn");

const screenPlayer= $("#screen-player");
const gameIdSmall = $("#gameIdSmall");
const roundNowP   = $("#roundNowP");
const roundTotalP = $("#roundTotalP");
const waitBox     = $("#waitBox");
const questionBox = $("#questionBox");
const solutionBox = $("#solutionBox");
const emojiEl     = $("#emoji");
const progressBarP= $("#progressBarP");
const ansI        = $("#answer");
const submitBtn   = $("#submitBtn");
const savedMsg    = $("#savedMsg");
const resultIcon  = $("#resultIcon");
const resultText  = $("#resultText");
const solutionTextP = $("#solutionTextP");

const screenResult= $("#screen-result");
const finalBoard  = $("#finalBoard");
const restartBtn  = $("#restartBtn");

roundTotalEl.textContent = ROUND_TOTAL;
roundTotalP.textContent  = ROUND_TOTAL;

// Helpers
function show(el){ el.classList.remove("hidden"); }
function hide(el){ el.classList.add("hidden"); }
function goto(elShow){
  [screenHost,screenJoin,screenPlayer,screenResult].forEach(el=>el.classList.add("hidden"));
  elShow.classList.remove("hidden");
}
function updateShareLink(id){
  const url = new URL(window.location.href);
  url.searchParams.set("game", id);
  url.searchParams.set("role", "player");
  shareLinkI.value = url.toString();
}

// State
let gameId = null;
let myId   = null;
let myName = null;

// ============== Host / Lobby ==============
createGameBtn.onclick = async ()=>{
  try{
    const id = rid();
    gameId = id;

    await set(ref(db, `games/${id}`), {
      createdAt: Date.now(),
      state: { round: 0, phase: "waiting" },
      players: {}
    });

    gameIdHost.textContent = id;
    phaseLabel.textContent = "Warten auf Start";
    updateShareLink(id);
    hostPanel.classList.remove("hidden");
    listenPlayersInLobby();
  }catch(err){
    alert("Konnte das Spiel nicht erstellen:\n"+err);
  }
};

joinHostBtn.onclick = async ()=>{
  const id = joinGameIdHost.value.trim().toUpperCase();
  if(!id) return alert("Bitte Spiel-ID eingeben.");
  const snap = await get(ref(db, `games/${id}`));
  if(!snap.exists()) return alert("Spiel nicht gefunden.");
  gameId = id;

  gameIdHost.textContent = id;
  updateShareLink(id);
  hostPanel.classList.remove("hidden");
  listenPlayersInLobby();

  const s = (await get(ref(db, `games/${id}/state`))).val()||{};
  phaseLabel.textContent = s.phase || "—";
};

// Lobby listener
function listenPlayersInLobby(){
  onValue(ref(db, `games/${gameId}/players`), (snap)=>{
    const players = snap.val() || {};
    playerList.innerHTML = "";
    Object.values(players).forEach(p=>{
      const d=document.createElement("div");
      d.className="playerRow";
      d.innerHTML = `<b>${p.name}</b> <span class="meta">${p.score||0} Punkte</span>`;
      playerList.appendChild(d);
    });
  });
}

copyLinkBtn.onclick = async ()=>{
  await navigator.clipboard.writeText(shareLinkI.value);
  copyLinkBtn.textContent="Kopiert!";
  setTimeout(()=>copyLinkBtn.textContent="Link kopieren",1200);
};

// ============== GAME START ==============
startGameBtn.onclick = async ()=>{
  try{
    startGameBtn.disabled = true;
    await update(ref(db, `games/${gameId}/state`), { 
      phase:"question", 
      round:0, 
      ts: Date.now() 
    });

    autoRoundLoop();
  }catch(err){
    alert("Fehler beim Start: "+err);
    startGameBtn.disabled = false;
  }
};

// ============== RUNDENABLAUF – FIXED VERSION ==============
async function autoRoundLoop() {
  for (let r = 0; r < ROUND_TOTAL; r++) {

    // ► PHASE 1: FRAGE
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

    // direkt zur Frage den Song starten
    playSongSnippetForRound(r);

    // Timer für die Antwortzeit
    await animateProgress(progressBar, ANSWER_SECONDS * 1000);

    // Auto-Bewertung nach Ablauf der Zeit
    await initialAutoScoring(r);

    // ► PHASE 2: LÖSUNG
    await update(ref(db, `games/${gameId}/state`), { 
      phase: "solution", 
      ts: Date.now() 
    });

    phaseLabel.textContent = "Lösung";
    solutionText.textContent = "Lösung: " + QUESTIONS[r].title;
    solutionText.classList.remove("hidden");

    // Antworten anzeigen + Top 5
    await renderAnswersForReview(r);
    await renderTop5();

    // Weiter-Button
    const nextBtn = document.createElement("button");
    nextBtn.textContent = "Weiter zur nächsten Frage";
    nextBtn.className = "btn mt-1";
    solutionText.insertAdjacentElement("afterend", nextBtn);
    
    await new Promise(res => {
      nextBtn.onclick = () => {
        stopSnippetImmediately();   // Musik sofort stoppen
        nextBtn.remove();
        res();
      };
    });
  }

  // ► PHASE 3: ENDE (nach allen Runden)
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

// ============== AUTO-SCORING ==============
async function initialAutoScoring(round){
  const snap = await get(ref(db, `games/${gameId}/players`));
  const players = snap.val() || {};
  const updates = {};

  for(const [pid,p] of Object.entries(players)){
    const ans = p.answers?.[round]?.text || "";
    const ok = fuzzyMatch(ans, QUESTIONS[round].title);
    const prevScore = p.score || 0;
    const alreadyCorrect = p.answers?.[round]?.correct === true;
    const add = ok && !alreadyCorrect ? POINTS : 0;

    updates[pid] = {
      name: p.name,
      score: prevScore + add,
      answers: { ...(p.answers||{}), [round]: { text: ans, correct: ok } }
    };
  }

  const payload = {};
  for(const [pid,val] of Object.entries(updates)){
    payload[`games/${gameId}/players/${pid}`] = val;
  }
  if(Object.keys(payload).length) await update(ref(db), payload);
}

// ============== MANUELLE KORREKTUR ==============
async function renderAnswersForReview(round){
  const snap = await get(ref(db, `games/${gameId}/players`));
  const players = snap.val() || {};

  answerReview.innerHTML = "";

  Object.entries(players).forEach(([pid,p]) => {

    const ansObj = p.answers?.[round] || { text:"(keine Antwort)", correct:false };
    const ansText = ansObj.text || "(keine Antwort)";
    const correct = !!ansObj.correct;

    const row = document.createElement("div");
    row.className = "playerRow";
    row.dataset.pid = pid;

    row.innerHTML = `
      <div>
        <b>${p.name}</b> <span class="tag">Runde ${round+1}</span><br>
        <span class="meta">${ansText}</span>
      </div>
      <div>
        <button class="btn ghost markBtn" data-value="true"
            style="background:${correct ? "#16a34a" : "#334155"}">✅</button>
        <button class="btn ghost markBtn" data-value="false"
            style="background:${!correct ? "#dc2626" : "#334155"}">❌</button>
      </div>`;

    answerReview.appendChild(row);
  });

  // Klick-Events
  answerReview.querySelectorAll(".markBtn").forEach(btn=>{
    btn.onclick = ()=>{
      const area = btn.parentElement;
      area.querySelectorAll(".markBtn").forEach(b=>b.style.background="#334155");

      const val = btn.dataset.value === "true";
      btn.style.background = val ? "#16a34a" : "#dc2626";

      btn.closest(".playerRow").dataset.mark = val ? "true" : "false";
    };
  });

  // SPEICHERN
  saveManualBtn.onclick = async ()=>{
    const rows = [...answerReview.querySelectorAll(".playerRow")];
    const changes = {};

    for(const row of rows){
      const markAttr = row.dataset.mark;
      if(markAttr === undefined) continue;

      const pid = row.dataset.pid;
      const mark = markAttr === "true";

      const pSnap = await get(ref(db, `games/${gameId}/players/${pid}`));
      const p = pSnap.val();

      const oldCorrect = p.answers?.[round]?.correct || false;

      let score = p.score || 0;
      if(mark && !oldCorrect) score += POINTS;
      if(!mark && oldCorrect) score -= POINTS;

      changes[`games/${gameId}/players/${pid}/answers/${round}/correct`] = mark;
      changes[`games/${gameId}/players/${pid}/score`] = score;
    }

    if(Object.keys(changes).length) await update(ref(db), changes);

    alert("Korrekturen gespeichert ✔️");

    await renderTop5();
    await renderAnswersForReview(round);
  };
}

// ============== TOP 5 & FINAL ==============
async function renderTop5(){
  const snap = await get(ref(db, `games/${gameId}/players`));
  const arr = Object.values(snap.val()||{})
    .map(p=>({name:p.name,score:p.score||0}))
    .sort((a,b)=>b.score-a.score)
    .slice(0,5);

  top5El.innerHTML = "";

  arr.forEach((p,i)=>{
    const medal = i===0?"🥇":i===1?"🥈":i===2?"🥉":"🎄";
    const d=document.createElement("div");
    d.className="playerRow";
    d.innerHTML = `<div>${medal} <b>${p.name}</b></div><div>${p.score} Punkte</div>`;
    top5El.appendChild(d);
  });
}

async function renderFinal(){
  const snap = await get(ref(db, `games/${gameId}/players`));
  const arr = Object.values(snap.val()||{})
    .map(p=>({name:p.name,score:p.score||0}))
    .sort((a,b)=>b.score-a.score);

  finalBoard.innerHTML = "";

  arr.forEach((p,i)=>{
    const medal = i===0?"🥇":i===1?"🥈":i===2?"🥉":"🎄";
    const d=document.createElement("div");
    d.className="playerRow";
    d.innerHTML = `<div>${medal} <b>${p.name}</b></div><div>${p.score} Punkte</div>`;
    finalBoard.appendChild(d);
  });
}

// ============== PLAYER-FLOW ==============

// Wenn man mit ?game=ABCD12 als Spieler joinen soll:
const url = new URL(window.location.href);
if (url.searchParams.get("game") && url.searchParams.get("role") === "player") {
  goto(screenJoin);
  joinGameIdI.value = url.searchParams.get("game").toUpperCase();
}

enterBtn.onclick = async ()=>{
  const gid = joinGameIdI.value.trim().toUpperCase();
  const name = playerNameI.value.trim();

  if(!gid || !name) return alert("Bitte Spiel-ID und Namen eingeben.");

  const snap = await get(ref(db, `games/${gid}`));
  if(!snap.exists()) return alert("Spiel nicht gefunden.");

  gameId = gid;
  myName = name;
  myId = "p_"+Math.random().toString(36).slice(2,10);

  await set(ref(db, `games/${gameId}/players/${myId}`), {
    name: myName, score:0, answers:{}
  });

  gameIdSmall.textContent = gameId;
  goto(screenPlayer);
  listenStateAsPlayer();
};

function listenStateAsPlayer(){
  onValue(ref(db, `games/${gameId}/state`), async (snap)=>{
    const s = snap.val() || {phase:"waiting",round:0};

    roundNowP.textContent = (s.round||0)+1;

    if(s.phase==="waiting"){
      show(waitBox);
      hide(questionBox);
      hide(solutionBox);
    }

    else if(s.phase==="question"){
      const r = s.round;

      emojiEl.textContent = QUESTIONS[r].emoji;
      ansI.value = "";
      savedMsg.classList.add("hidden");

      show(questionBox);
      hide(waitBox);
      hide(solutionBox);

      const remaining = Math.max(0, ANSWER_SECONDS*1000 - (Date.now()-s.ts));
      animateProgress(progressBarP, remaining);
    }

    else if(s.phase==="solution"){
      const r = s.round;

      const aSnap = await get(ref(db, `games/${gameId}/players/${myId}/answers/${r}`));
      const ans = aSnap.val();
      const ok = ans
        ? ans.correct
        : fuzzyMatch(ans?.text || "", QUESTIONS[r].title);

      resultIcon.textContent = ok ? "✅" : "❌";
      resultText.textContent = ok ? "Richtig!" : "Leider falsch!";
      resultText.className  = ok ? "big correct" : "big wrong";

      solutionTextP.textContent = "Lösung: " + QUESTIONS[r].title;

      show(solutionBox);
      hide(questionBox);
      hide(waitBox);

      const remaining = Math.max(0, SOLUTION_SECONDS*1000 - (Date.now()-s.ts));
      animateProgress(progressBarP, remaining);
    }

    else if(s.phase==="end"){
      hide(questionBox);
      hide(waitBox);
      show(solutionBox);

      resultIcon.textContent = "🎉";
      resultText.className = "big";
      resultText.textContent = "Danke fürs Mitspielen!";
      solutionTextP.textContent = "";
    }
  });
}

// Antwort abschicken
submitBtn.onclick = async ()=>{
  const s = await get(ref(db, `games/${gameId}/state`));
  if(s.val()?.phase !== "question") return;

  const r = s.val().round;
  const text = ansI.value.trim();
  if(!text) return;

  await update(ref(db, `games/${gameId}/players/${myId}/answers`), {
    [r]: { text }
  });

  savedMsg.classList.remove("hidden");
  ansI.value = "";
};

// ============== DOMContentLoaded – Spotify aktivieren ==============
document.addEventListener("DOMContentLoaded", () => {
  const btn = document.getElementById("spotifyLoginBtn");
  if (btn) btn.onclick = loginSpotify;
  handleSpotifyRedirect();
});

// ============== Restart ==============
restartBtn.onclick = ()=>{
  location.href = location.origin + location.pathname;
};
