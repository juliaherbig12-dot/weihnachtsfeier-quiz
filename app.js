console.log("[boot] app.js geladen (finale Version)");

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

// ============== Spotify PKCE + Player ==============
const clientId     = "5d0dd83f585a4ad3b9c28d86185df6a6";
const redirectUri  = "https://weihnachtsfeier-quiz.vercel.app";
const playlistURI  = "spotify:playlist:5YUM8W5TlJeqTvbb07Wsk2";
const tokenEndpoint = "/api/spotify-token";

let spotifyToken    = null;
let spotifyDeviceId = null;
let spotifyPlayer   = null;

function stopSnippetImmediately() {
  if (spotifyPlayer) spotifyPlayer.pause().catch(()=>{});
}

function generateCodeVerifier(length = 64) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  return Array.from({length}, ()=>chars[Math.floor(Math.random()*chars.length)]).join("");
}

async function generateCodeChallenge(verifier) {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
}

function loadSpotifySDK() {
  return new Promise((res,rej)=>{
    if (window.Spotify) return res();
    const s=document.createElement("script");
    s.src="https://sdk.scdn.co/spotify-player.js";
    s.onload=res; s.onerror=rej;
    document.body.appendChild(s);
  });
}

async function loginSpotify() {
  const verifier = generateCodeVerifier();
  localStorage.setItem("spotify_pkce_verifier", verifier);

  const challenge = await generateCodeChallenge(verifier);
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    code_challenge_method: "S256",
    code_challenge: challenge,
    scope: [
      "streaming","user-read-email","user-read-private",
      "user-modify-playback-state","user-read-playback-state"
    ].join(" ")
  });

  window.location.href = "https://accounts.spotify.com/authorize?" + params;
}

async function exchangeCodeForToken(code) {
  const verifier = localStorage.getItem("spotify_pkce_verifier");

  const resp = await fetch(tokenEndpoint,{
    method:"POST",
    headers:{ "Content-Type":"application/json" },
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

  // URL bereinigen
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete("code");
    url.searchParams.delete("state");
    history.replaceState({}, "", url.pathname);
  } catch {}

  return spotifyToken;
}

async function createSpotifyPlayer() {
  if (!spotifyToken) return;
  await loadSpotifySDK();

  spotifyPlayer = new Spotify.Player({
    name: "Emoji-Quiz Player",
    getOAuthToken: cb => cb(spotifyToken),
    volume: 0.8
  });

  spotifyPlayer.addListener("ready", ({device_id})=>{
    spotifyDeviceId = device_id;
    console.log("Spotify ready:", device_id);
  });

  spotifyPlayer.connect();
}

async function handleSpotifyRedirect() {
  const p=new URLSearchParams(window.location.search);
  if (p.get("code")) {
    const tok = await exchangeCodeForToken(p.get("code"));
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

const POINTS = 125;
const ANSWER_SECONDS = 45;
const SOLUTION_SECONDS = 30;

// ============== Utils ==============
const $ = (s)=>document.querySelector(s);

function rid(len=6) {
  const c="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({length:len},()=>c[Math.floor(Math.random()*c.length)]).join("");
}

function normalize(s) {
  if(!s) return "";
  return s.toLowerCase().normalize("NFD")
    .replace(/[\u0300-\u036f]/g,"")
    .replace(/&/g,"und")
    .replace(/[^a-z0-9äöüß \-]+/g," ")
    .replace(/\b(der|die|das|ein|eine|und|the|a|an|oh|o)\b/g," ")
    .replace(/\s+/g," ").trim();
}

function lev(a,b){
  const m=a.length, n=b.length;
  const dp=Array.from({length:m+1},()=>Array(n+1).fill(0));
  for(let i=0;i<=m;i++) dp[i][0]=i;
  for(let j=0;j<=n;j++) dp[0][j]=j;

  for(let i=1;i<=m;i++){
    for(let j=1;j<=n;j++){
      const cost = a[i-1]===b[j-1] ? 0 : 1;
      dp[i][j] = Math.min(
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

  const d = lev(a,t);
  const tol = Math.max(1, Math.min(4, Math.round(t.length * 0.25)));
  return d <= tol;
}

function animateProgress(bar, duration){
  return new Promise(resolve=>{
    const start = performance.now();
    function step(t){
      const p = Math.min(1,(t-start)/duration);
      bar.style.width = (p*100)+"%";
      if(p<1) requestAnimationFrame(step);
      else { bar.style.width="0%"; resolve(); }
    }
    requestAnimationFrame(step);
  });
}


