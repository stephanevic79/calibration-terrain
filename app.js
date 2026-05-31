// === Configuration ===
const ALPHA_RIVIERE = 0.90;
const GAMMA_RIVIERE = 0.18;

// === État global ===
let currentLat = null;
let currentLon = null;
let currentTEauComplet = null;
let currentTEauSimple = null;

// === Initialisation ===
document.addEventListener('DOMContentLoaded', () => {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js');
    }
    getPosition();
    afficherHistorique();
    document.getElementById('refresh-gps').addEventListener('click', getPosition);
    document.getElementById('estimer').addEventListener('click', estimerTemperature);
    document.getElementById('enregistrer').addEventListener('click', enregistrerMesure);
    document.getElementById('export-csv').addEventListener('click', exporterCSV);
    document.getElementById('strate').addEventListener('change', function() {
        const choixProfondeur = document.getElementById('choix-profondeur');
        choixProfondeur.style.display = this.value === 'profondeur' ? 'block' : 'none';
    });
});

// === Géolocalisation ===
function getPosition() {
    const coordsEl = document.getElementById('coords');
    coordsEl.textContent = 'Acquisition GPS...';
    if (!navigator.geolocation) {
        coordsEl.textContent = 'Géolocalisation non supportée';
        return;
    }
    const options = { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 };
    navigator.geolocation.getCurrentPosition(async pos => {
        currentLat = pos.coords.latitude;
        currentLon = pos.coords.longitude;
        coordsEl.textContent = `Lat : ${currentLat.toFixed(5)}, Lon : ${currentLon.toFixed(5)}`;
        try {
            const commune = await reverseGeocode(currentLat, currentLon);
            document.getElementById('commune').textContent = `Commune : ${commune}`;
        } catch (e) {
            document.getElementById('commune').textContent = 'Commune introuvable';
        }
    }, err => {
        coordsEl.textContent = 'Erreur GPS : ' + err.message;
    }, options);
}

// === Reverse geocoding (Nominatim) ===
async function reverseGeocode(lat, lon) {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=12`;
    const resp = await fetch(url);
    const data = await resp.json();
    return data.address?.city || data.address?.town || data.address?.village || data.address?.municipality || 'Inconnue';
}

// === Récupération météo Open-Meteo ===
async function fetchMeteoHistorique(lat, lon, start, end) {
    const url = new URL('https://archive-api.open-meteo.com/v1/archive');
    url.searchParams.set('latitude', lat);
    url.searchParams.set('longitude', lon);
    url.searchParams.set('start_date', start);
    url.searchParams.set('end_date', end);
    url.searchParams.set('daily', 'temperature_2m_mean,wind_speed_10m_max');
    url.searchParams.set('timezone', 'auto');
    const resp = await fetch(url);
    const json = await resp.json();
    return json.daily;
}

async function fetchMeteoJour(lat, lon, dateStr) {
    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.searchParams.set('latitude', lat);
    url.searchParams.set('longitude', lon);
    url.searchParams.set('daily', 'temperature_2m_mean,wind_speed_10m_max,precipitation_sum,cloud_cover_mean');
    url.searchParams.set('start_date', dateStr);
    url.searchParams.set('end_date', dateStr);
    url.searchParams.set('timezone', 'auto');
    const resp = await fetch(url);
    const json = await resp.json();
    return json.daily;
}

// === Modèle complet (avec vent) ===
function estimerTemperatureComplet(dates, tAir, wind) {
    const n = dates.length;
    if (n < 7) return tAir[n-1] || 15;
    const tEau = new Array(n);
    const sum7 = tAir.slice(0,7).reduce((a,b)=>a+b,0);
    tEau[0] = sum7 / 7;
    for (let i=1; i<n; i++) {
        const tAirEq = tAir[i] - GAMMA_RIVIERE * wind[i];
        tEau[i] = ALPHA_RIVIERE * tEau[i-1] + (1 - ALPHA_RIVIERE) * tAirEq;
    }
    return tEau[n-1];
}

// === Modèle simplifié (sans vent) ===
function estimerTemperatureSimple(dates, tAir) {
    const n = dates.length;
    if (n < 7) return tAir[n-1] || 15;
    const tEau = new Array(n);
    const sum7 = tAir.slice(0,7).reduce((a,b)=>a+b,0);
    tEau[0] = sum7 / 7;
    for (let i=1; i<n; i++) {
        tEau[i] = ALPHA_RIVIERE * tEau[i-1] + (1 - ALPHA_RIVIERE) * tAir[i];
    }
    return tEau[n-1];
}

// === Estimation pour plan d'eau (moyenne 30 jours, commun aux deux modèles) ===
function estimerTemperaturePlanEau(tAir) {
    if (tAir.length === 0) return 15;
    return tAir.reduce((a,b)=>a+b,0) / tAir.length;
}

// === Fonction principale d'estimation ===
async function estimerTemperature() {
    if (!currentLat || !currentLon) {
        alert('Position GPS non disponible');
        return;
    }
    const milieu = document.getElementById('milieu').value;
    const aujourdhui = new Date();
    const dateStr = aujourdhui.toISOString().split('T')[0];
    const startDate = new Date(aujourdhui);
    startDate.setDate(startDate.getDate() - 90);
    const startStr = startDate.toISOString().split('T')[0];

    document.getElementById('t-estimee-complet').textContent = 'Calcul en cours...';
    document.getElementById('t-estimee-simple').textContent = '';

    try {
        const [archive, jour] = await Promise.all([
            fetchMeteoHistorique(currentLat, currentLon, startStr, dateStr),
            fetchMeteoJour(currentLat, currentLon, dateStr)
        ]);

        let tComplet, tSimple;
        if (milieu === 'riviere') {
            tComplet = estimerTemperatureComplet(archive.time, archive.temperature_2m_mean, archive.wind_speed_10m_max);
            tSimple = estimerTemperatureSimple(archive.time, archive.temperature_2m_mean);
        } else {
            tComplet = estimerTemperaturePlanEau(archive.temperature_2m_mean);
            tSimple = tComplet; // pour l'instant identique, à affiner plus tard
        }

        currentTEauComplet = tComplet;
        currentTEauSimple = tSimple;
        document.getElementById('t-estimee-complet').textContent = `🌡️ Modèle complet : ${tComplet.toFixed(1)} °C`;
        document.getElementById('t-estimee-simple').textContent = `📉 Modèle simplifié (sans vent) : ${tSimple.toFixed(1)} °C`;
    } catch (e) {
        document.getElementById('t-estimee-complet').textContent = 'Erreur lors de la récupération météo';
        console.error(e);
    }
}

// === Enregistrement mesure ===
function enregistrerMesure() {
    const tMesuree = parseFloat(document.getElementById('t-mesuree').value);
    if (isNaN(tMesuree)) {
        document.getElementById('message').textContent = 'Veuillez entrer une température mesurée';
        return;
    }
    if (currentTEauComplet === null) {
        document.getElementById('message').textContent = 'Veuillez d\'abord estimer la température';
        return;
    }
    if (!currentLat || !currentLon) {
        document.getElementById('message').textContent = 'Position GPS non disponible';
        return;
    }

    const strate = document.getElementById('strate').value;
    let profondeur = 0.3; // surface par défaut
    if (strate === 'profondeur') {
        profondeur = parseFloat(document.getElementById('profondeur-max').value);
    }

    const mesure = {
        date: new Date().toISOString(),
        lat: currentLat,
        lon: currentLon,
        milieu: document.getElementById('milieu').value,
        strate: strate,
        profondeur: profondeur,
        tEstimeeComplet: currentTEauComplet,
        tEstimeeSimple: currentTEauSimple,
        tMesuree: tMesuree
    };

    const mesures = JSON.parse(localStorage.getItem('mesures') || '[]');
    mesures.push(mesure);
    localStorage.setItem('mesures', JSON.stringify(mesures));
    document.getElementById('message').textContent = '✅ Mesure enregistrée';
    document.getElementById('t-mesuree').value = '';
    afficherHistorique();
}

// === Affichage historique avec suppression ===
function afficherHistorique() {
    const mesures = JSON.parse(localStorage.getItem('mesures') || '[]');
    const liste = document.getElementById('liste-mesures');
    liste.innerHTML = '';
    mesures.slice(-10).reverse().forEach((m, i) => {
        const li = document.createElement('li');
        const date = new Date(m.date).toLocaleString('fr-FR');
        const indexReel = mesures.length - 1 - i;
        const ecartComplet = (m.tMesuree - m.tEstimeeComplet).toFixed(1);
        const ecartSimple = (m.tMesuree - m.tEstimeeSimple).toFixed(1);
        li.innerHTML = `
            ${date} - ${m.milieu} (${m.strate}, ${m.profondeur}m)<br>
            Complet : ${m.tEstimeeComplet.toFixed(1)}°C → ${m.tMesuree.toFixed(1)}°C (écart ${ecartComplet}°C)<br>
            Simplifié : ${m.tEstimeeSimple.toFixed(1)}°C → ${m.tMesuree.toFixed(1)}°C (écart ${ecartSimple}°C)
            <button class="btn-suppr" data-index="${indexReel}" title="Supprimer">❌</button>
        `;
        liste.appendChild(li);
    });

    document.querySelectorAll('.btn-suppr').forEach(btn => {
        btn.addEventListener('click', function() {
            const index = parseInt(this.getAttribute('data-index'));
            supprimerMesure(index);
        });
    });
}

function supprimerMesure(index) {
    if (!confirm('Supprimer cette mesure ?')) return;
    const mesures = JSON.parse(localStorage.getItem('mesures') || '[]');
    mesures.splice(index, 1);
    localStorage.setItem('mesures', JSON.stringify(mesures));
    afficherHistorique();
}

// === Export CSV ===
function exporterCSV() {
    const mesures = JSON.parse(localStorage.getItem('mesures') || '[]');
    if (mesures.length === 0) {
        alert('Aucune mesure à exporter');
        return;
    }
    let csv = 'date,latitude,longitude,milieu,strate,profondeur_m,t_estimee_complet,t_estimee_simple,t_mesuree\n';
    mesures.forEach(m => {
        csv += `${m.date},${m.lat},${m.lon},${m.milieu},${m.strate},${m.profondeur.toFixed(2)},${m.tEstimeeComplet.toFixed(2)},${m.tEstimeeSimple.toFixed(2)},${m.tMesuree.toFixed(2)}\n`;
    });
    const blob = new Blob([csv], {type: 'text/csv'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'mesures_terrain.csv';
    a.click();
    URL.revokeObjectURL(url);
}
