/* app.js — Australia Trip Companion
   Versione “finale corretta” basata sul tuo file attuale.

   Fix principali:
   - Rimosso COVERS con URL esterni (copyright). Ora cover = astratta via dataset (data-city).
   - setBase(): tolta duplicazione getGPSBase() + chiamate cover incoerenti.
   - Meteo: aggiunta icona (#wxIcon) in modo sicuro (se l’elemento non c’è, non rompe).
   - Map: lasciata com’è (anche se in futuro vuoi rimuoverla, ti dico dove).
*/

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const state = {
  view: "home",
  base: "gps",
  baseCoord: null, // {lat, lon, label, tz}
  mode: "nearby",  // nearby | suggested | saved
  radiusKm: 5,
  region: "all",
  category: "all",
  q: "",
  map: null,
  markers: [],
  lastPos: null
};

const BASES = {
  gps: { label: "GPS", lat: null, lon: null, tz: null },
  hotel_sydney:    { label: "Sydney — Shangri-La",            lat: -33.8601, lon: 151.2066, tz: "Australia/Sydney" },
  hotel_goldcoast: { label: "Gold Coast — Langham",           lat: -28.0306, lon: 153.4328, tz: "Australia/Brisbane" },
  hotel_hamilton:  { label: "Hamilton Island — The Sundays",  lat: -20.3484, lon: 148.9560, tz: "Australia/Brisbane" },
  hotel_perth:     { label: "Perth — Ritz-Carlton",           lat: -31.9530, lon: 115.8575, tz: "Australia/Perth" }
};

/* ===== COVER (astratta, NO copyright) ===== */
function setCoverForBase(baseKey){
  const el = document.getElementById("cityCover");
  if(!el) return;

  let city = "sydney";

  if(baseKey && baseKey.startsWith("hotel_")){
    city = baseKey.replace("hotel_", "");
  } else if(baseKey === "gps"){
    const tz = state.baseCoord?.tz;
    if(tz === "Australia/Perth") city = "perth";
    else if(tz === "Australia/Brisbane") city = "goldcoast"; // QLD
    else city = "sydney";
  }

  el.dataset.city = city;
}

function init() {
  wireNav();
  wireHome();
  wireAround();
  wireOps();
  loadTrip();
  loadItinerary();
  paintChecklist();
  setGreeting();
  setBase("gps", true);
  renderOccasions();
}

function wireNav(){
  $$(".navbtn").forEach(btn => {
    btn.addEventListener("click", () => go(btn.dataset.go));
  });
}

function go(view){
  state.view = view;
  $$(".navbtn").forEach(b => b.classList.toggle("on", b.dataset.go === view));
  $$(".view").forEach(v => v.hidden = (v.dataset.view !== view));

  if(view === "around"){
    ensureMap();
    setTimeout(() => state.map.invalidateSize(), 200);
    refreshAround();
  }
}

function wireHome(){
  $("#btnOpenAround").addEventListener("click", () => go("around"));
  $("#btnRefreshWx").addEventListener("click", () => refreshWeather());
  $("#baseSelect").addEventListener("change", (e) => setBase(e.target.value, true));
  $("#btnLocate").addEventListener("click", () => {
    if(state.view !== "around") go("around");
    centerOnBase(true);
  });
}

function wireAround(){
  // filter controls
  $$(".seg").forEach(b => {
    b.addEventListener("click", () => {
      $$(".seg").forEach(x => x.classList.remove("on"));
      b.classList.add("on");
      state.mode = b.dataset.mode;
      refreshAround();
    });
  });

  $("#regionSelect").addEventListener("change", e => { state.region = e.target.value; refreshAround(); });
  $("#radiusSelect").addEventListener("change", e => { state.radiusKm = parseFloat(e.target.value); refreshAround(); });
  $("#catSelect").addEventListener("change", e => { state.category = e.target.value; refreshAround(); });
  $("#searchInput").addEventListener("input", e => { state.q = (e.target.value||"").trim().toLowerCase(); refreshAround(); });
  $("#btnClear").addEventListener("click", () => {
    $("#regionSelect").value = "all";
    $("#radiusSelect").value = "5";
    $("#catSelect").value = "all";
    $("#searchInput").value = "";
    state.region = "all"; state.radiusKm = 5; state.category = "all"; state.q = "";
    refreshAround();
  });

  // sheet simple drag (optional, minimal)
  const sheet = $("#sheet");
  const handle = $("#sheetHandle");
  let startY = null, startH = null;

  handle.addEventListener("touchstart", (e) => {
    const t = e.touches[0];
    startY = t.clientY;
    startH = sheet.getBoundingClientRect().height;
  }, {passive:true});

  handle.addEventListener("touchmove", (e) => {
    if(startY == null) return;
    const t = e.touches[0];
    const dy = startY - t.clientY;
    const newH = Math.max(160, Math.min(window.innerHeight*0.80, startH + dy));
    sheet.style.maxHeight = newH + "px";
  }, {passive:true});

  handle.addEventListener("touchend", () => { startY = null; startH = null; }, {passive:true});
}

function wireOps(){
  $("#btnOpenMaps").addEventListener("click", () => {
    const c = state.baseCoord || {lat:-33.86, lon:151.20};
    const url = `https://www.google.com/maps?q=${encodeURIComponent(c.lat + "," + c.lon)}`;
    window.open(url, "_blank");
  });

  $("#btnShare").addEventListener("click", async () => {
    const url = location.href;
    try{
      if(navigator.share){
        await navigator.share({title:"Australia Trip", text:"Apri la PWA", url});
      } else {
        await navigator.clipboard.writeText(url);
        alert("Link copiato.");
      }
    }catch(_){}
  });
}

function setGreeting(){
  const h = new Date().getHours();
  const g = h < 12 ? "Buongiorno" : (h < 18 ? "Buon pomeriggio" : "Buonasera");
  $("#greeting").textContent = g;
}

/* ===== BASE ===== */
async function setBase(baseKey, refreshWxNow){
  state.base = baseKey;

  if(baseKey === "gps"){
    $("#wherePill").textContent = "Dove: GPS";
    await getGPSBase();
    setCoverForBase("gps"); // dopo GPS, con tz calcolato
  } else {
    const b = BASES[baseKey];
    state.baseCoord = { lat: b.lat, lon: b.lon, label: b.label, tz: b.tz };
    $("#wherePill").textContent = "Dove: " + b.label;
    setLocalTimePill(b.tz);
    setCoverForBase(baseKey);
  }

  if(refreshWxNow) refreshWeather();

  if(state.view === "around"){
    ensureMap();
    centerOnBase(false);
    refreshAround();
  }
}

function setLocalTimePill(tz){
  try{
    const now = new Date();
    const fmt = new Intl.DateTimeFormat("it-IT", {
      timeZone: tz,
      hour: "2-digit",
      minute:"2-digit",
      weekday:"short",
      day:"2-digit",
      month:"short"
    });
    $("#timePill").textContent = "Ora locale: " + fmt.format(now);
  }catch(_){
    $("#timePill").textContent = "Ora locale: —";
  }
}

async function getGPSBase(){
  // fallback: Sydney
  state.baseCoord = {
    lat: -33.8601,
    lon: 151.2066,
    label:"GPS (fallback Sydney)",
    tz:"Australia/Sydney"
  };

  if(!navigator.geolocation){
    setLocalTimePill("Australia/Sydney");
    return;
  }

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const {latitude, longitude} = pos.coords;
        state.lastPos = {lat: latitude, lon: longitude};

        const tz = guessAUS_TZ(longitude);
        state.baseCoord = { lat: latitude, lon: longitude, label:"GPS", tz };

        $("#wherePill").textContent = "Dove: GPS";
        setLocalTimePill(tz);
        resolve();
      },
      () => {
        setLocalTimePill("Australia/Sydney");
        resolve();
      },
      { enableHighAccuracy:true, timeout:8000, maximumAge:60000 }
    );
  });
}

function guessAUS_TZ(lon){
  if(lon < 129) return "Australia/Perth";
  if(lon < 141) return "Australia/Darwin";
  return "Australia/Sydney";
}

/* ===== MAP ===== */
function ensureMap(){
  if(state.map) return;
  state.map = L.map("map", { zoomControl:true, preferCanvas:true });
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap"
  }).addTo(state.map);

  centerOnBase(false);
}

function centerOnBase(forceGPS){
  const c = state.baseCoord || {lat:-33.8601, lon:151.2066};
  if(forceGPS && state.lastPos){
    state.map.setView([state.lastPos.lat, state.lastPos.lon], 14);
    return;
  }
  state.map.setView([c.lat, c.lon], 13);
}

function haversineKm(a, b){
  const R = 6371;
  const dLat = (b.lat-a.lat) * Math.PI/180;
  const dLon = (b.lon-a.lon) * Math.PI/180;
  const sa = Math.sin(dLat/2)**2 + Math.cos(a.lat*Math.PI/180)*Math.cos(b.lat*Math.PI/180)*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(sa));
}

function refreshAround(){
  if(!state.map) return;

  // clear markers
  state.markers.forEach(m => m.remove());
  state.markers = [];

  const base = state.baseCoord || {lat:-33.8601, lon:151.2066};
  const all = (window.PLACES || []).map(p => {
    const d = haversineKm({lat:base.lat, lon:base.lon}, {lat:p.lat, lon:p.lon});
    return {...p, distKm: d};
  });

  const filtered = all.filter(p => {
    if(state.region !== "all" && p.region !== state.region) return false;
    if(state.category !== "all" && p.category !== state.category) return false;
    if(state.radiusKm !== 999 && p.distKm > state.radiusKm) return false;

    if(state.q){
      const hay = (p.name+" "+(p.what||"")+" "+(p.why||"")+" "+(p.tips||"")+" "+(p.keywords||[]).join(" ")).toLowerCase();
      if(!hay.includes(state.q)) return false;
    }
    return true;
  });

  let list = filtered;

  if(state.mode === "nearby"){
    list = filtered.sort((a,b)=>a.distKm-b.distKm);
  } else if(state.mode === "suggested"){
    const hour = new Date().getHours();
    list = filtered.map(p => {
      let bonus = 0;
      if(p.category === "view" && (hour >= 16 || hour <= 9)) bonus += 1.2;
      if(p.category === "food" && (hour >= 11 && hour <= 14)) bonus += 0.8;
      if(p.category === "beach" && (hour >= 9 && hour <= 17)) bonus += 0.6;
      return {...p, score: bonus - (p.distKm/10)};
    }).sort((a,b)=> (b.score - a.score));
  } else if(state.mode === "saved"){
    const saved = getSaved();
    list = filtered.filter(p => saved.has(p.id));
    list.sort((a,b)=>a.distKm-b.distKm);
  }

  // markers
  list.forEach(p => {
    const m = L.marker([p.lat,p.lon]).addTo(state.map);
    m.bindPopup(`<b>${escapeHtml(p.name)}</b><br/>${escapeHtml(p.what||"")}`);
    state.markers.push(m);
  });

  renderCards(list);
}

function renderCards(list){
  const root = $("#cards");
  root.innerHTML = "";

  if(list.length === 0){
    const div = document.createElement("div");
    div.className = "poi";
    div.innerHTML = `<div class="poi-title">Nessun risultato</div><div class="poi-why">Prova ad allargare il raggio o togliere filtri.</div>`;
    root.appendChild(div);
    return;
  }

  const saved = getSaved();

  list.slice(0, 60).forEach(p => {
    const el = document.createElement("div");
    el.className = "poi";

    const badges = [
      `<span class="badge">${escapeHtml(p.region)}</span>`,
      `<span class="badge muted">${escapeHtml(p.category)}</span>`,
      `<span class="badge">${p.distKm < 10 ? p.distKm.toFixed(1) : Math.round(p.distKm)} km</span>`
    ].join("");

    el.innerHTML = `
      <div class="poi-top">
        <div>
          <div class="poi-title">${escapeHtml(p.name)}</div>
          <div class="poi-meta">
            <span>${escapeHtml(p.what||"")}</span>
          </div>
        </div>
        <div class="poi-badges">${badges}</div>
      </div>
      <div class="poi-why"><b>Perché andarci:</b> ${escapeHtml(p.why||"—")}</div>
      <div class="poi-meta"><span><b>Tip:</b> ${escapeHtml(p.tips||"—")}</span></div>
      <div class="poi-actions">
        <button class="btn" data-act="nav">Naviga</button>
        <button class="btn ghost" data-act="save">${saved.has(p.id) ? "Salvato" : "Salva"}</button>
      </div>
    `;

    el.querySelector('[data-act="nav"]').addEventListener("click", () => {
      const url = `https://www.google.com/maps?q=${encodeURIComponent(p.lat + "," + p.lon)}`;
      window.open(url, "_blank");
    });

    el.querySelector('[data-act="save"]').addEventListener("click", (e) => {
      toggleSaved(p.id);
      e.target.textContent = getSaved().has(p.id) ? "Salvato" : "Salva";
      if(state.mode === "saved") refreshAround();
    });

    el.addEventListener("click", (ev) => {
      if(ev.target.tagName.toLowerCase() === "button") return;
      state.map.setView([p.lat,p.lon], 15);
    });

    root.appendChild(el);
  });
}

function getSaved(){
  try{
    const raw = localStorage.getItem("aus_saved") || "[]";
    return new Set(JSON.parse(raw));
  }catch(_){ return new Set(); }
}

function toggleSaved(id){
  const s = getSaved();
  if(s.has(id)) s.delete(id); else s.add(id);
  localStorage.setItem("aus_saved", JSON.stringify(Array.from(s)));
}

function escapeHtml(s){
  return String(s||"").replace(/[&<>"']/g, (c)=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
}

/* ===== WEATHER (Open-Meteo, no key) ===== */
async function refreshWeather(){
  const c = state.baseCoord || {lat:-33.8601, lon:151.2066, tz:"Australia/Sydney"};
  const tz = c.tz || "Australia/Sydney";
  setLocalTimePill(tz);

  safeSet("#wxUpdated", "Aggiornamento…");
  safeSet("#wxTemp", "—");
  safeSet("#wxDesc", "—");
  safeSet("#wxRain", "—");
  safeSet("#wxWind", "—");
  safeSet("#wxMinMax", "—");

  try{
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${c.lat}&longitude=${c.lon}` +
      `&current=temperature_2m,precipitation,wind_speed_10m,weather_code` +
      `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum` +
      `&timezone=${encodeURIComponent(tz)}`;

    const r = await fetch(url, {cache:"no-store"});
    const j = await r.json();

    const t = j?.current?.temperature_2m;
    const rain = j?.current?.precipitation;
    const wind = j?.current?.wind_speed_10m;
    const code = j?.current?.weather_code;

    // icona (se l'elemento non esiste, non crasha)
    safeSet("#wxIcon", weatherIcon(code));

    const max = j?.daily?.temperature_2m_max?.[0];
    const min = j?.daily?.temperature_2m_min?.[0];
    const prSum = j?.daily?.precipitation_sum?.[0];

    safeSet("#wxTemp", (t!=null ? Math.round(t) + "°" : "—"));
    safeSet("#wxDesc", weatherLabel(code));
    safeSet("#wxRain", (rain!=null ? `${rain} mm/h` : "—") + (prSum!=null ? ` • oggi ${prSum}mm` : ""));
    safeSet("#wxWind", (wind!=null ? `${Math.round(wind)} km/h` : "—"));
    safeSet("#wxMinMax", (max!=null && min!=null) ? `${Math.round(max)}° / ${Math.round(min)}°` : "—");
    safeSet("#wxUpdated", "Ora (base selezionata)");
    safeSet("#wearTip", wearTip({t, wind, rain: prSum ?? rain}));
  }catch(_){
    safeSet("#wxUpdated", "Meteo non disponibile (rete/permessi).");
    safeSet("#wearTip", "Layer leggero + SPF + acqua. Se vento: aggiungi una felpa.");
  }
}

function safeSet(sel, txt){
  const el = $(sel);
  if(el) el.textContent = txt;
}

function weatherLabel(code){
  const m = {
    0:"Sereno", 1:"Quasi sereno", 2:"Parzialmente nuvoloso", 3:"Nuvoloso",
    45:"Nebbia", 48:"Nebbia",
    51:"Pioviggine",53:"Pioviggine",55:"Pioviggine",
    61:"Pioggia",63:"Pioggia",65:"Pioggia forte",
    71:"Neve",73:"Neve",75:"Neve forte",
    80:"Rovesci",81:"Rovesci",82:"Rovesci forti",
    95:"Temporale"
  };
  return m[code] || "Variabile";
}

function weatherIcon(code){
  if(code === 0) return "☀️";
  if(code === 1) return "🌤️";
  if(code === 2) return "⛅";
  if(code === 3) return "☁️";
  if(code >= 45 && code <= 48) return "🌫️";
  if(code >= 51 && code <= 57) return "🌦️";
  if(code >= 61 && code <= 65) return "🌧️";
  if(code >= 71 && code <= 77) return "❄️";
  if(code >= 80 && code <= 82) return "🌧️";
  if(code === 95) return "⛈️";
  return "🌡️";
}

function wearTip({t, wind, rain}){
  let out = [];
  if(t == null){
    return "SPF alto, cappello, acqua. Layer leggero per vento serale.";
  }
  if(t >= 28) out.push("Maglietta leggera, shorts, sandali.");
  else if(t >= 22) out.push("Leggero: t-shirt + uno strato per la sera.");
  else out.push("Strato medio: felpa/giacca leggera, soprattutto la sera.");

  out.push("SPF alto + cappello (UV estivo).");

  if(wind != null && wind >= 25) out.push("Vento: porta una felpa/giacca leggera.");
  if(rain != null && rain >= 3) out.push("Possibile pioggia: k-way o ombrello piccolo.");

  return out.join(" ");
}

/* ===== TRIP + ITINERARY ===== */
async function loadTrip(){
  try{
    const r = await fetch("./trip.json", {cache:"no-store"});
    const t = await r.json();

    // flights
    const fRoot = $("#flightList");
    if(fRoot){
      fRoot.innerHTML = "";
      t.flights.forEach(x => {
        const div = document.createElement("div");
        div.className = "rowline";
        div.innerHTML = `<div class="k">${x.date} • ${x.flight}</div><div class="v">${x.from} → ${x.to}</div><div class="s">${x.dep} → ${x.arr}</div>`;
        fRoot.appendChild(div);
      });
    }

    // hotels
    const hRoot = $("#stayList");
    if(hRoot){
      hRoot.innerHTML = "";
      t.hotels.forEach(x => {
        const div = document.createElement("div");
        div.className = "rowline";
        div.innerHTML = `<div class="k">${x.city} • ${x.nights} notti</div><div class="v">${x.name}</div><div class="s">${x.checkIn} → ${x.checkOut}</div>`;
        hRoot.appendChild(div);
      });
    }

    // car
    const cRoot = $("#carBox");
    if(cRoot){
      cRoot.innerHTML = "";
      const c = t.car;
      [
        {k:"Noleggio", v:`${c.vendor} • ${c.vehicle}`},
        {k:"Ritiro", v:c.pickup},
        {k:"Rilascio", v:c.dropoff},
        {k:"Note", v:c.notes}
      ].forEach(x => {
        const div = document.createElement("div");
        div.className = "rowline";
        div.innerHTML = `<div class="k">${x.k}</div><div class="v">${x.v}</div>`;
        cRoot.appendChild(div);
      });
    }

    // moves
    const mRoot = $("#moveList");
    if(mRoot){
      mRoot.innerHTML = "";
      t.moves.forEach(s => {
        const li = document.createElement("li");
        li.textContent = s;
        mRoot.appendChild(li);
      });
    }
  }catch(_){}
}

async function loadItinerary(){
  try{
    const r = await fetch("./itinerary.json", {cache:"no-store"});
    const data = await r.json();
    const root = $("#itineraryList");
    if(!root) return;

    root.innerHTML = "";

    data.days.forEach((d, idx) => {
      const el = document.createElement("div");
      el.className = "day";
      el.innerHTML = `
        <div class="day-head">
          <div>
            <div class="day-title">${d.date} — ${escapeHtml(d.title)}</div>
            <div class="day-sub">${escapeHtml(d.focus || "")}</div>
          </div>
          <button class="day-btn" data-i="${idx}">Apri</button>
        </div>
        <div class="day-body" id="dayBody${idx}" hidden>
          <div><b>Obiettivo:</b> ${escapeHtml(d.focus || "—")}</div>
          <ul>${(d.bullets||[]).map(x=>`<li>${escapeHtml(x)}</li>`).join("")}</ul>
          <div style="margin-top:10px;color:rgba(161,161,170,.95)"><b>Nota cultura:</b> ${escapeHtml(d.culture || "—")}</div>
        </div>
      `;
      root.appendChild(el);
    });

    $$(".day-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const i = btn.dataset.i;
        const body = $("#dayBody"+i);
        const open = !body.hidden;
        body.hidden = open;
        btn.textContent = open ? "Apri" : "Chiudi";
      });
    });
  }catch(_){}
}

/* ===== HOME OCCASIONS ===== */
function renderOccasions(){
  const ul = $("#occasionList");
  if(!ul) return;

  ul.innerHTML = "";

  const items = [
    "Estate australiana: UV alto, idratazione e SPF sono la priorità.",
    "Spiaggia: nuota tra le bandiere e ascolta i lifeguard.",
    "Distanze grandi: margine su orari e benzina (soprattutto fuori città).",
    "Caffè/Brunch: rituale locale. Ordini rapidi, qualità alta."
  ];

  items.forEach(t => {
    const li = document.createElement("li");
    li.textContent = t;
    ul.appendChild(li);
  });
}

function paintChecklist(){
  const ul = $("#dailyChecklist");
  if(!ul) return;

  ul.innerHTML = "";
  [
    "SPF + cappello + acqua",
    "Powerbank + cavo",
    "Documento + carta / telefono",
    "Controllo meteo e vento",
    "Piano semplice: 2 cose fatte bene"
  ].forEach(t => {
    const li = document.createElement("li");
    li.textContent = t;
    ul.appendChild(li);
  });
}

window.addEventListener("load", init);
