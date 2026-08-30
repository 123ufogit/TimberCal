/* =========================================================================
   石川県林業試験場 現地調査 WebGIS - メインスクリプト
   =========================================================================
   構成:
     A. 地図・タイルレイヤ初期化
     B. 樹種カラーパレット定義
     C. GeoJSONレイヤ読み込み（trees / zoning / codrat）
     D. GeoJSONレイヤ 表示制御・透過率スライダー
     E. GPS機能
     F. トラック記録
     G. POI登録
     H. GeoJSON出力
     I. レイヤパネル・タイルオーバーレイ制御
     J. UI ユーティリティ・ボタンイベント
   ========================================================================= */

/* =========================================================================
   A. 地図・タイルレイヤ初期化
   ========================================================================= */

/** 初期中心：金沢市 07HD811 DEM 調査地付近 */
const INITIAL_CENTER = [36.587443, 136.775525];
const INITIAL_ZOOM   = 16;

const map = L.map('map', {
  center:             INITIAL_CENTER,
  zoom:               INITIAL_ZOOM,
  zoomControl:        true,
  attributionControl: true,
  maxZoom: 36,
  minZoom: 5,
});

/* ズームコントロールを左上に配置 */
map.zoomControl.setPosition('topleft');

/* スケールバー（メートル単位） */
L.control.scale({
  position: 'bottomleft',
  imperial: false,
  maxWidth: 120,
}).addTo(map);

/* ---- ベースマップ定義（標準地図・航空写真・OSM） ---- */
const baseMaps = {
  std: L.tileLayer(
    'https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png',
    {
      attribution:
        '<a href="https://maps.gsi.go.jp/development/ichiran.html"' +
        ' target="_blank">国土地理院 (標準地図)</a>',
      maxZoom: 36,
      maxNativeZoom: 18,
    }
  ),
  photo: L.tileLayer(
    'https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg',
    {
      attribution:
        '<a href="https://maps.gsi.go.jp/development/ichiran.html"' +
        ' target="_blank">国土地理院 (全国最新写真)</a>',
      maxZoom: 36,
      maxNativeZoom: 18,
    }
  )
};

/* 初期ベースマップ表示：国土地理院 標準地図 */
let currentBaseMapKey = 'std';
baseMaps[currentBaseMapKey].addTo(map);

/* ベースマップ切り替えイベントリスナー */
document.querySelectorAll('input[name="basemap"]').forEach(radio => {
  radio.addEventListener('change', function () {
    if (this.checked && baseMaps[this.value] && this.value !== currentBaseMapKey) {
      map.removeLayer(baseMaps[currentBaseMapKey]);
      baseMaps[this.value].addTo(map);
      baseMaps[this.value].bringToBack();
      currentBaseMapKey = this.value;
      showToast(`🗾 ベースマップ変更: ${this.nextElementSibling.textContent.trim()}`);
    }
  });
});

/* ---- オーバーレイ1：傾斜区分（高精細1mカラー画像、初期非表示・透過率40%） ---- */
// 傾斜区分専用のカスタムペインを作成 (ベースマップ: 200 と GeoJSON/マーカー: 400~600 の中間 z-index: 250 に設定)
map.createPane('slopePane');
map.getPane('slopePane').style.zIndex = 250;
map.getPane('slopePane').style.pointerEvents = 'none';

const slopeBounds = [
  [36.5806468, 136.7643842], // SW
  [36.5942384, 136.7866666]  // NE
];

const slopeImageUrl = (typeof window !== 'undefined' && window.slopeOverlayData)
  ? window.slopeOverlayData
  : 'data/slope_overlay.png';

const slopeOverlay = L.imageOverlay(
  slopeImageUrl,
  slopeBounds,
  {
    opacity: 0.4,
    pane: 'slopePane'
  }
); // 初期非表示のため addTo(map) しない

/* 傾斜区分 ON/OFF */
document.getElementById('toggle-slope')
  .addEventListener('change', function () {
    this.checked
      ? map.addLayer(slopeOverlay)
      : map.removeLayer(slopeOverlay);
  });

/* 傾斜区分 透過率スライダー */
document.getElementById('slider-slope')
  .addEventListener('input', function () {
    const t = parseInt(this.value);
    const op = (100 - t) / 100;
    document.getElementById('val-slope').textContent = `${t}%`;
    slopeOverlay.setOpacity(op);
  });

/* ---- オーバーレイ2：森林資源20mメッシュ（初期非表示・透過率70%） ---- */
const frLayer = L.tileLayer(
  'https://rinya-tiles.geospatial.jp/fr_mesh20m_webp_2025/{z}/{x}/{y}.webp',
  {
    attribution:
      '<a href="https://www.rinya.maff.go.jp/" target="_blank">' +
      '林野庁 森林資源メッシュ</a>',
    maxZoom: 36,
    maxNativeZoom: 18,
    opacity: 0.3, // 透過率70% → opacity = (100-70)/100
  }
); // 初期非表示のため addTo しない

/* =========================================================================
   B. 樹種カラーパレット定義
   ========================================================================= */

/** 樹種 → 色 マッピング（屋外高コントラスト対応） */
const SPECIES_COLOR = {
  'スギ':     '#2e7d32',
  'ヒノキ':   '#66bb6a',
  'マツ':     '#f9a825',
  'アカマツ': '#ff8f00',
  'クロマツ': '#6d4c41',
  'ナラ':     '#8d6e63',
  'ブナ':     '#a5d6a7',
  'カシ':     '#00897b',
  'サクラ':   '#f48fb1',
  'ケヤキ':   '#ffcc02',
  'コナラ':   '#bcaaa4',
  '広葉樹':   '#26a69a',
  '針葉樹':   '#1565c0',
  '竹':       '#c6ff00',
  '未立木':   '#757575',
};

/* 自動生成カラー（SPECIES_COLOR にない樹種用） */
const AUTO_COLORS = [
  '#e41a1c','#377eb8','#4daf4a','#984ea3','#ff7f00',
  '#ffff33','#a65628','#f781bf','#999999'
];

/* 自動割り当て用キャッシュ */
const autoColorMap = {};
let autoColorIndex = 0;


const DEFAULT_SPECIES_COLOR = '#9e9e9e';

/**
 * species 属性値から色を返す（完全一致 → 部分一致）
 * @param {string} species
 * @returns {string} カラーコード
 */
function getSpeciesColor(species) {
  if (!species) return DEFAULT_SPECIES_COLOR;

  // 完全一致
  if (SPECIES_COLOR[species]) return SPECIES_COLOR[species];

  // 部分一致（例：スギ（成木）など）
  for (const key of Object.keys(SPECIES_COLOR)) {
    if (species.includes(key)) return SPECIES_COLOR[key];
  }

  // 自動色割り当て（trees.geojson に含まれるが SPECIES_COLOR にない樹種）
  if (!autoColorMap[species]) {
    autoColorMap[species] = AUTO_COLORS[autoColorIndex % AUTO_COLORS.length];
    autoColorIndex++;
  }

  return autoColorMap[species];
}


/* =========================================================================
   C. GeoJSONレイヤ読み込み
   =========================================================================
   index.html と同じフォルダに配置すること：
     trees.geojson / zoning.geojson / codrat.geojson
   ========================================================================= */

/* 各レイヤを格納する LayerGroup */
const treesLayerGroup  = L.layerGroup().addTo(map);
const zoningLayerGroup = L.layerGroup().addTo(map);

/* GeoJSON レイヤの実体（透過率制御用に参照を保持） */
let treesGeoJSON  = null;
let zoningGeoJSON = null;
let mesh20Layer = null;

/* 実データから検出した樹種リスト（凡例生成用） */
const detectedSpecies = new Set();

/**
 * 複数のURL候補からJSONを安全に取得するヘルパー関数
 */
async function fetchJson(urls) {
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
    } catch (e) {
      // 次のURL候補を試す
    }
  }
  throw new Error(`Failed to fetch JSON from candidates: ${urls.join(', ')}`);
}

/* ------------------------------------------------------------------
   C-1. 樹木データ（data/trees.geojson）
   ------------------------------------------------------------------ */
function renderTreesLayer(data) {
  treesGeoJSON = L.geoJSON(data, {

    /* ポイント：JYUSYU / species で色分けした円マーカー */
    pointToLayer: function (feature, latlng) {
      const sp    = feature.properties && (feature.properties.JYUSYU || feature.properties.species);
      const color = getSpeciesColor(sp);
      if (sp) detectedSpecies.add(sp);
      return L.circleMarker(latlng, {
        radius: 3.5, fillColor: color,
        color: '#ffffff', weight: 1,
        opacity: 0.9, fillOpacity: 0.9,
      });
    },

    /* ポリゴン・ライン：JYUSYU / species で塗り色を変える */
    style: function (feature) {
      const sp    = feature.properties && (feature.properties.JYUSYU || feature.properties.species);
      const color = getSpeciesColor(sp);
      if (sp) detectedSpecies.add(sp);
      return {
        fillColor: color, color: '#ffffff',
        weight: 1, fillOpacity: 0.75,
      };
    },

    /* ツールチップ：JYUSYU / species + 他属性 */
    onEachFeature: function (feature, layer) {
      const p  = feature.properties || {};
      const sp = p.JYUSYU || p.species || '不明';
      const lines = [`<b>🌳 ${sp}</b>`];
      let n = 0;
      for (const [k, v] of Object.entries(p)) {
        if (k === 'JYUSYU' || k === 'species' || k === 'X' || k === 'Y') continue;
        if (n++ >= 5) break;
        lines.push(`${k}: ${v}`);
      }
      layer.bindTooltip(lines.join('<br>'),
        { sticky: true, direction: 'top' });
    },
  });

  treesLayerGroup.addLayer(treesGeoJSON);
  treesGeoJSON.bringToFront(); 
  if (treesGeoJSON.getBounds().isValid()) {
    map.fitBounds(treesGeoJSON.getBounds());
  }
  buildTreesLegend();
  showToast(`🌳 樹木データ読み込み完了（${data.features
    ? data.features.length : '?'}件）`);
}

async function loadTreesData() {
  // 1. window.treesGeoJsonData (data/trees.js) からのグローバルロード
  if (typeof window !== 'undefined' && window.treesGeoJsonData) {
    console.log('Loaded trees from window.treesGeoJsonData');
    renderTreesLayer(window.treesGeoJsonData);
    return;
  }

  // 2. fetchJson での非同期取得
  try {
    const data = await fetchJson([
      'data/trees.geojson',
      './data/trees.geojson',
      'trees.geojson'
    ]);
    renderTreesLayer(data);
  } catch (err) {
    console.warn('data/trees.geojson 読み込み失敗:', err);
    if (window.location.protocol === 'file:') {
      showToast('⚠ file://プロトコルではブラウザのセキュリティ制限によりfetchがブロックされます。\nローカルWebサーバー(Live Server等)で開いてください。');
    } else {
      showToast('⚠ data/trees.geojson が見つかりません');
    }
  }
}

loadTreesData();

/* ------------------------------------------------------------------
   C-2. ゾーニングデータ（zoning.geojson）
   ------------------------------------------------------------------ */

/* ゾーニング用カラーパレット */
const ZONE_COLORS = [
  '#e53935','#1e88e5','#43a047','#fb8c00',
  '#8e24aa','#00acc1','#f4511e','#6d4c41',
];
const zoneColorCache = {};
let   zoneColorIndex = 0;

/**
 * ゾーンフィーチャーの色を返す
 * zone / name / type 属性を優先参照
 */
function getZoneColor(properties) {
  const key = properties.zone || properties.name
            || properties.type || null;
  if (!key) {
    return ZONE_COLORS[zoneColorIndex++ % ZONE_COLORS.length];
  }
  if (!zoneColorCache[key]) {
    zoneColorCache[key] =
      ZONE_COLORS[Object.keys(zoneColorCache).length
                  % ZONE_COLORS.length];
  }
  return zoneColorCache[key];
}

function renderZoningLayer(data) {
  zoningGeoJSON = L.geoJSON(data, {

    /* ポリゴン：ゾーン属性で色分け・初期透過率50% */
    style: function (feature) {
      const color = getZoneColor(feature.properties || {});
      return {
        fillColor: color, color: color,
        weight: 2, opacity: 0.9, fillOpacity: 0.15,
      };
    },

    /* ツールチップ：ゾーン名と属性 */
    onEachFeature: function (feature, layer) {
      const p    = feature.properties || {};
      const name = p.zone || p.name || p.type || 'ゾーン';
      const lines = [`<b>📦 ${name}</b>`];
      for (const [k, v] of Object.entries(p)) {
        if (['zone','name','type'].includes(k)) continue;
        lines.push(`${k}: ${v}`);
      }
      layer.bindTooltip(lines.join('<br>'),
        { sticky: true, direction: 'top' });
      layer.on('click', function (e) {
        e.originalEvent.stopPropagation();
      });
      layer.interactive = false;
    },
  });

  zoningLayerGroup.addLayer(zoningGeoJSON);
  zoningGeoJSON.bringToBack();
  buildZoningLegend();
  showToast(`📦 ゾーニング読み込み完了（${data.features
    ? data.features.length : '?'}件）`);
}

async function loadZoningData() {
  // 1. window.zoningGeoJsonData (data/zoning.js) からの即時ロード
  if (typeof window !== 'undefined' && window.zoningGeoJsonData) {
    console.log('Loaded zoning from window.zoningGeoJsonData');
    renderZoningLayer(window.zoningGeoJsonData);
    return;
  }

  // 2. fetchJson での非同期取得
  try {
    const data = await fetchJson([
      'data/zoning.geojson',
      './data/zoning.geojson',
      'zoning.geojson'
    ]);
    renderZoningLayer(data);
  } catch (err) {
    console.warn('data/zoning.geojson 読み込み失敗:', err);
    if (window.location.protocol === 'file:') {
      showToast('⚠ file://プロトコルではセキュリティ制限によりzoning.geojsonが直接フェッチできません。\ndata/zoning.js またはローカルWebサーバーをご利用ください。');
    } else {
      showToast('⚠ data/zoning.geojson が見つかりません');
    }
  }
}

loadZoningData();



/* ------------------------------------------------------------------
   C-4. 20m メッシュデータ（20mesh.geojson）
   ------------------------------------------------------------------ */
fetchJson(['20mesh.geojson', './20mesh.geojson', 'data/20mesh.geojson'])
  .then(data => {
    mesh20Layer = L.geoJSON(data, {
      style: function () {
        return {
          color: '#888888',
          weight: 1,
          opacity: 0.5
        };
      }
    });

    // 初期表示：ズーム19以上のときのみ
    if (map.getZoom() >= 19) {
      mesh20Layer.addTo(map);
    }

    showToast(`🧵 20mメッシュ読み込み完了（${data.features
      ? data.features.length : '?'}件）\n※ズーム19以上で地図上に枠線が表示されます`);
  })
  .catch(err => {
    console.warn('20mesh.geojson 読み込み失敗:', err);
  });


/* =========================================================================
   D. GeoJSONレイヤ 表示制御・透過率スライダー
   ========================================================================= */

/* 樹木データ ON/OFF */
document.getElementById('toggle-trees')
  .addEventListener('change', function () {
    this.checked
      ? map.addLayer(treesLayerGroup)
      : map.removeLayer(treesLayerGroup);
  });

/* ゾーニング ON/OFF */
document.getElementById('toggle-zoning')
  .addEventListener('change', function () {
    this.checked
      ? map.addLayer(zoningLayerGroup)
      : map.removeLayer(zoningLayerGroup);
  });

/* ゾーニング 透過率スライダー */
document.getElementById('slider-zoning')
  .addEventListener('input', function () {
    const t = parseInt(this.value);
    const fo = (100 - t) / 100;
    document.getElementById('val-zoning').textContent = `${t}%`;
    if (zoningGeoJSON) {
      zoningGeoJSON.setStyle(feature => {
        const color = getZoneColor(feature.properties || {});
        return {
          fillColor: color, color: color,
          weight: 2, opacity: 0.9, fillOpacity: fo,
        };
      });
    }
  });



/* =========================================================================
   凡例生成：樹種別カラー
   ========================================================================= */

/** 樹種別カラー凡例を動的生成（trees.geojson 読み込み完了後に呼ぶ） */
function buildTreesLegend() {
  const container = document.getElementById('legend-trees');
  container.innerHTML = '';
   
/** ゾーン凡例を動的生成（zoning.geojson 読み込み完了後に呼ぶ） */
function buildZoningLegend() {
  const container = document.getElementById('legend-zoning');
  if (!container) return;
  container.innerHTML = '';

  // zoneColorCache に登録されたキーごとに凡例を作成
  const keys = Object.keys(zoneColorCache).sort();
  keys.forEach(key => {
    const color = zoneColorCache[key];
    const item = document.createElement('div');
    item.className = 'legend-item';
    item.innerHTML =
      `<div class="legend-color"
            style="background:${color};"></div>
       <span>${key}</span>`;
    container.appendChild(item);
  });
}
  // trees.geojson に登場した樹種のみを凡例に表示
  const sorted = [...detectedSpecies].sort();

  sorted.forEach(sp => {
    const item = document.createElement('div');
    item.className = 'legend-item';
    item.innerHTML =
      `<div class="legend-color"
            style="background:${getSpeciesColor(sp)};"></div>
       <span>${sp}</span>`;
    container.appendChild(item);
  });

  // その他（分類不能・未分類）
  const other = document.createElement('div');
  other.className = 'legend-item';
  other.innerHTML =
    `<div class="legend-color"
          style="background:${DEFAULT_SPECIES_COLOR};"></div>
     <span>その他</span>`;
  container.appendChild(other);
}


/* 凡例の折りたたみ開閉 */
const btnLegendToggle = document.getElementById('btn-legend-toggle');
if (btnLegendToggle) {
  btnLegendToggle.addEventListener('click', function () {
    const isOpen =
      document.getElementById('legend-trees').classList.toggle('show');
    this.textContent = isOpen ? '▲ 樹種別の色' : '▼ 樹種別の色';
  });
}

// ★ 新しい凡例パネルの開閉ボタン
const legendToggleBtn = document.getElementById('legend-toggle-btn');
const legendContent   = document.getElementById('legend-content');

if (legendToggleBtn && legendContent) {
  legendToggleBtn.addEventListener('click', () => {
    const isOpen = legendContent.classList.toggle('show');
    legendToggleBtn.textContent = isOpen ? '凡例 ▲' : '凡例 ▼';
  });
}

/* =========================================================================
   E. GPS機能
   ========================================================================= */

const gpsState = {
  watching:       false,
  watchId:        null,
  following:      false,
  lastPosition:   null,
  currentMarker:  null,
  accuracyCircle: null,
  lastHeading:    null, 
};

/* 現在地マーカーアイコン（青い丸） */
const gpsIcon = L.divIcon({
  className: '',
  html: `<div style="width:18px;height:18px;background:#1e90ff;
    border:3px solid #ffffff;border-radius:50%;
    box-shadow:0 0 8px rgba(30,144,255,0.8);"></div>`,
  iconSize:   [18, 18],
  iconAnchor: [9, 9],
});

/** GPS監視を開始する */
function startGpsWatch() {
  if (!navigator.geolocation || gpsState.watching) return;
  gpsState.watchId = navigator.geolocation.watchPosition(
    onGpsSuccess, onGpsError,
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
  );
  gpsState.watching = true;
  updateStatusText('GPS監視中...');
}

/** GPS取得成功コールバック */
function onGpsSuccess(pos) {
  const { latitude: lat, longitude: lng,
          accuracy: acc, heading: hdg } = pos.coords;
  gpsState.lastPosition = pos;

  const latlng = L.latLng(lat, lng);
  if (!gpsState.currentMarker) {
    gpsState.currentMarker = L.marker(latlng,
      { icon: gpsIcon, zIndexOffset: 1000 }).addTo(map);
    gpsState.accuracyCircle = L.circle(latlng, {
      radius: acc, color: '#1e90ff',
      fillColor: '#1e90ff', fillOpacity: 0.12,
      weight: 1, dashArray: '4,4',
    }).addTo(map);
  } else {
    gpsState.currentMarker.setLatLng(latlng);
    gpsState.accuracyCircle.setLatLng(latlng);
    gpsState.accuracyCircle.setRadius(acc);
  }

  if (gpsState.following)
    map.panTo(latlng, { animate: true, duration: 0.5 });

  document.getElementById('disp-lat').textContent = lat.toFixed(6);
  document.getElementById('disp-lng').textContent = lng.toFixed(6);
  if (hdg !== null && !isNaN(hdg)) updateCompass(hdg);
  if (trackState.recording) addTrackPoint(lat, lng);
  updateStatusText(`GPS精度: ±${Math.round(acc)}m`);
}

/** GPS取得失敗コールバック */
function onGpsError(err) {
  const msgs = {
    1: '⚠ GPS許可が必要です',
    2: '⚠ GPS信号が取得できません',
    3: '⚠ GPS取得タイムアウト',
  };
  const msg = msgs[err.code] || 'GPS取得エラー';
  showToast(msg);
  updateStatusText(msg);
}

/** コンパス表示を更新する */
function updateCompass(deg) {
  gpsState.lastHeading = deg; // ★ 方位を保存

  const dirs = ['↑N','↗NE','→E','↘SE','↓S','↙SW','←W','↖NW'];
  document.getElementById('compass-display').textContent =
    dirs[Math.round(deg / 45) % 8];
  document.getElementById('compass-deg').textContent =
    `${Math.round(deg)}°`;
  updateCrosshair(); // ★ 赤ライン更新
}

/** ズーム19以上＋特定方位で赤い縦横ラインを表示 */
function updateCrosshair() {
  const z = map.getZoom();
  const deg = gpsState.lastHeading;

  // 条件：ズーム19以上＋方位が指定範囲
  if (z < 19 || deg === null || isNaN(deg)) {
    if (crosshairLayer) {
      map.removeLayer(crosshairLayer);
      crosshairLayer = null;
    }
    return;
  }

  const d = (deg + 360) % 360;
  const ok =
    (d >= 358 || d <= 2) ||
    (d >= 88 && d <= 92) ||
    (d >= 178 && d <= 182) ||
    (d >= 268 && d <= 272);

  if (!ok) {
    if (crosshairLayer) {
      map.removeLayer(crosshairLayer);
      crosshairLayer = null;
    }
    return;
  }

  const center = map.getCenter();
  const bounds = map.getBounds();

  const lat1 = bounds.getNorth();
  const lat2 = bounds.getSouth();
  const lng1 = bounds.getWest();
  const lng2 = bounds.getEast();

  const vertical = L.polyline([[lat1, center.lng], [lat2, center.lng]], {
    color: '#ff0000',
    weight: 2,
    opacity: 0.9,
  });

  const horizontal = L.polyline([[center.lat, lng1], [center.lat, lng2]], {
    color: '#ff0000',
    weight: 2,
    opacity: 0.9,
  });

  if (crosshairLayer) {
    map.removeLayer(crosshairLayer);
  }
  crosshairLayer = L.layerGroup([vertical, horizontal]).addTo(map);
}


/* =========================================================================
   F. トラック記録
   ========================================================================= */

const trackState = { recording: false, pointCount: 0, startTime: null };
let trackCoords   = [];
const trackLayer  = L.layerGroup().addTo(map);
let trackPolyline = null;
let crosshairLayer = null;

/** トラック記録を開始する */
function startTracking() {
  if (trackState.recording) {
    showToast('⚠ 既に記録中です'); return;
  }
  trackState.recording  = true;
  trackState.pointCount = 0;
  trackState.startTime  = new Date();
  trackCoords = [];
  if (trackPolyline) {
    trackLayer.removeLayer(trackPolyline);
    trackPolyline = null;
  }
  document.getElementById('btn-track-start').classList.add('recording');
  document.getElementById('btn-track-stop').disabled = false;
  startGpsWatch();
  updateStatusText('⏺ トラック記録中');
  showToast('⏺ トラック記録を開始しました');
  updateTrackInfo();
}

/** トラック記録を停止する */
function stopTracking() {
  if (!trackState.recording) return;
  trackState.recording = false;
  document.getElementById('btn-track-start')
    .classList.remove('recording');
  document.getElementById('btn-track-stop').disabled = true;
  showToast(`⏹ 記録停止: ${trackState.pointCount}点`);
  updateStatusText(`トラック停止（${trackState.pointCount}点）`);
  updateTrackInfo();
}

/** トラックに座標点を追加する */
function addTrackPoint(lat, lng) {
  trackCoords.push([lat, lng]);
  trackState.pointCount++;
  if (trackPolyline) {
    trackPolyline.setLatLngs(trackCoords);
  } else {
    trackPolyline = L.polyline(trackCoords, {
      color: '#ff4444', weight: 4, opacity: 0.85,
      lineJoin: 'round', lineCap: 'round',
    }).addTo(trackLayer);
  }
  updateTrackInfo();
}

/** トラック情報表示を更新する */
function updateTrackInfo() {
  document.getElementById('track-info').textContent =
    `トラック: ${trackState.pointCount}点`;
}

/* =========================================================================
   G. POI登録
   ========================================================================= */

let poiList = [];
const poiLayer = L.layerGroup().addTo(map);

/** POI登録モーダルを開く */
function openPoiModal() {
  if (!gpsState.lastPosition) startGpsWatch();
  const src = gpsState.lastPosition
    ? `📍 ${gpsState.lastPosition.coords.latitude.toFixed(6)},` +
      ` ${gpsState.lastPosition.coords.longitude.toFixed(6)}`
    : `📍 ${map.getCenter().lat.toFixed(6)},` +
      ` ${map.getCenter().lng.toFixed(6)} (地図中心)`;
  document.getElementById('poi-coords-display').textContent = src;
  document.getElementById('poi-name').value = '';
  document.getElementById('poi-note').value = '';
  document.getElementById('poi-modal').classList.add('show');
  setTimeout(() => document.getElementById('poi-name').focus(), 100);
}

/** POIを登録する */
function registerPoi() {
  const name = document.getElementById('poi-name').value.trim()
             || '調査地点';
  const note = document.getElementById('poi-note').value.trim();
  let lat, lng;
  if (gpsState.lastPosition) {
    lat = gpsState.lastPosition.coords.latitude;
    lng = gpsState.lastPosition.coords.longitude;
  } else {
    const c = map.getCenter(); lat = c.lat; lng = c.lng;
  }
  const poi = {
    id: poiList.length + 1, name, note, lat, lng,
    timestamp: new Date().toISOString(),
  };
  poiList.push(poi);
  addPoiMarker(poi);
  document.getElementById('poi-modal').classList.remove('show');
  showToast(`📌 POI登録: ${name}`);
  updateStatusText(`POI ${poiList.length}件登録済`);
}

/** POIマーカーを地図上に追加する */
function addPoiMarker(poi) {
  const icon = L.divIcon({
    className: '',
    html: `<div style="position:relative;width:28px;height:36px;">
      <div style="width:28px;height:28px;background:#ffcc00;
        border:3px solid #333;border-radius:50% 50% 50% 0;
        transform:rotate(-45deg);
        box-shadow:2px 2px 6px rgba(0,0,0,0.5);"></div>
      <div style="position:absolute;top:4px;left:6px;
        color:#333;font-size:11px;font-weight:bold;">
        ${poi.id}</div>
    </div>`,
    iconSize: [28, 36], iconAnchor: [14, 36], popupAnchor: [0, -36],
  });
  L.marker([poi.lat, poi.lng], { icon })
    .bindTooltip(
      `<b>${poi.name}</b>${poi.note ? '<br>' + poi.note : ''}`,
      { permanent: false, direction: 'top' }
    )
    .addTo(poiLayer);
}

/* =========================================================================
   H. GeoJSON出力
   ========================================================================= */

/** トラック＋POIを GeoJSON ファイルとして出力する */
function exportGeoJSON() {
  const features = [];

  /* トラック → LineString */
  if (trackCoords.length >= 2) {
    features.push({
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: trackCoords.map(c => [c[1], c[0]]),
      },
      properties: {
        type: 'track', name: 'トラック',
        pointCount: trackCoords.length,
        startTime: trackState.startTime
          ? trackState.startTime.toISOString() : null,
        exportTime: new Date().toISOString(),
      },
    });
  }

  /* POI → Point */
  poiList.forEach(poi => {
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [poi.lng, poi.lat] },
      properties: {
        type: 'poi', id: poi.id, name: poi.name,
        note: poi.note, timestamp: poi.timestamp,
      },
    });
  });

  if (features.length === 0) {
    showToast('⚠ 出力するデータがありません'); return;
  }

  const geojson = {
    type: 'FeatureCollection',
    features,
    metadata: {
      title:      '林業試験場 現地調査データ',
      exportTime: new Date().toISOString(),
      trackCount: trackCoords.length,
      poiCount:   poiList.length,
    },
  };

  const blob = new Blob(
    [JSON.stringify(geojson, null, 2)],
    { type: 'application/geo+json' }
  );
  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  const now = new Date();
  const dt  = `${now.getFullYear()}`
    + `${String(now.getMonth()+1).padStart(2,'0')}`
    + `${String(now.getDate()).padStart(2,'0')}_`
    + `${String(now.getHours()).padStart(2,'0')}`
    + `${String(now.getMinutes()).padStart(2,'0')}`;
  a.download = `survey_${dt}.geojson`;
  a.href = url;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast(`💾 GeoJSON出力完了（トラック${trackCoords.length}点`
    + ` / POI${poiList.length}件）`);
}

/* =========================================================================
   I. レイヤパネル・タイルオーバーレイ制御
   ========================================================================= */

function openLayerPanel() {
  document.getElementById('layer-panel').classList.add('open');
  document.getElementById('panel-overlay').classList.add('show');
}
function closeLayerPanel() {
  document.getElementById('layer-panel').classList.remove('open');
  document.getElementById('panel-overlay').classList.remove('show');
}



/* 森林資源20mメッシュ ON/OFF */
document.getElementById('toggle-fr')
  .addEventListener('change', function () {
    if (this.checked) {
      if (frLayer) map.addLayer(frLayer);
      if (mesh20Layer) map.addLayer(mesh20Layer);
    } else {
      if (frLayer) map.removeLayer(frLayer);
      if (mesh20Layer) map.removeLayer(mesh20Layer);
    }
  });
/* 森林資源 透過率スライダー */
document.getElementById('slider-fr')
  .addEventListener('input', function () {
    const t = parseInt(this.value);
    frLayer.setOpacity((100 - t) / 100);
    document.getElementById('val-fr').textContent = `${t}%`;
  });

/* トラックレイヤ ON/OFF */
document.getElementById('toggle-track')
  .addEventListener('change', function () {
    this.checked
      ? map.addLayer(trackLayer)
      : map.removeLayer(trackLayer);
  });

/* POIレイヤ ON/OFF */
document.getElementById('toggle-poi')
  .addEventListener('change', function () {
    this.checked
      ? map.addLayer(poiLayer)
      : map.removeLayer(poiLayer);
  });

/* トラッククリア */
document.getElementById('btn-clear-track')
  .addEventListener('click', function () {
    if (trackState.recording) {
      showToast('⚠ 記録停止後にクリアしてください'); return;
    }
    if (trackCoords.length === 0) {
      showToast('クリアするトラックがありません'); return;
    }
    if (!confirm(`トラック（${trackCoords.length}点）をクリアしますか？`))
      return;
    trackCoords = []; trackState.pointCount = 0;
    if (trackPolyline) {
      trackLayer.removeLayer(trackPolyline);
      trackPolyline = null;
    }
    updateTrackInfo();
    showToast('🗑 トラックをクリアしました');
  });

/* POIクリア */
document.getElementById('btn-clear-poi')
  .addEventListener('click', function () {
    if (poiList.length === 0) {
      showToast('クリアするPOIがありません'); return;
    }
    if (!confirm(`POI（${poiList.length}件）をクリアしますか？`))
      return;
    poiList = []; poiLayer.clearLayers();
    showToast('🗑 POIをクリアしました');
    updateStatusText('待機中');
  });

/* =========================================================================
   J. UI ユーティリティ・ボタンイベント
   ========================================================================= */

/** ステータステキストを更新する */
function updateStatusText(text) {
  document.getElementById('status-text').textContent = text;
}

/** トースト通知を表示する */
let toastTimer = null;
function showToast(msg, duration = 2500) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), duration);
}

/* 地図移動時：緯度経度更新 */
map.on('move', function () {
  if (!gpsState.following || !gpsState.lastPosition) {
    const c = map.getCenter();
    document.getElementById('disp-lat').textContent =
      c.lat.toFixed(6);
    document.getElementById('disp-lng').textContent =
      c.lng.toFixed(6);
  }
});

/* ズーム変更時：ズームレベル更新 */
map.on('zoomend', function () {
  const z = map.getZoom();
  document.getElementById('disp-zoom').textContent = z;

  // ★ 20mメッシュの表示制御（ズーム19以上でのみ表示）
  if (mesh20Layer) {
    if (z >= 19) {
      map.addLayer(mesh20Layer);
    } else {
      map.removeLayer(mesh20Layer);
    }
  }

  // ★ 赤ラインの更新（後述の crosshair 用）
  updateCrosshair();
});
document.getElementById('disp-zoom').textContent = map.getZoom();


/* 地図ドラッグでGPS追尾OFF */
map.on('dragstart', function () {
  if (gpsState.following) {
    gpsState.following = false;
    const btn = document.getElementById('btn-follow');
    btn.classList.remove('active');
    btn.textContent = '🔒';
  }
});

/* デバイスコンパス */
if (typeof DeviceOrientationEvent !== 'undefined') {
  window.addEventListener('deviceorientation', function (e) {
    if (e.alpha !== null) updateCompass(e.alpha);
  }, true);
}

/* ---- ボタンイベント ---- */

/* 現在地へ移動 */
document.getElementById('btn-locate')
  .addEventListener('click', function () {
    if (!navigator.geolocation) {
      showToast('⚠ GPS非対応ブラウザです'); return;
    }
    showToast('📍 現在地を取得中...');
    navigator.geolocation.getCurrentPosition(
      pos => {
        map.flyTo(
          [pos.coords.latitude, pos.coords.longitude], 16,
          { animate: true, duration: 1.0 }
        );
        showToast('📍 現在地取得完了');
        startGpsWatch();
      },
      () => showToast('⚠ 現在地を取得できません'),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  });

/* GPS追尾 ON/OFF */
document.getElementById('btn-follow')
  .addEventListener('click', function () {
    gpsState.following = !gpsState.following;
    if (gpsState.following) {
      this.classList.add('active');
      this.textContent = '🔓';
      showToast('🔒 GPS追尾: ON');
      startGpsWatch();
      if (gpsState.lastPosition) {
        map.flyTo(
          [gpsState.lastPosition.coords.latitude,
           gpsState.lastPosition.coords.longitude],
          map.getZoom(), { animate: true, duration: 0.5 }
        );
      }
    } else {
      this.classList.remove('active');
      this.textContent = '🔒';
      showToast('🔓 GPS追尾: OFF');
    }
  });

document.getElementById('btn-track-start')
  .addEventListener('click', startTracking);
document.getElementById('btn-track-stop')
  .addEventListener('click', stopTracking);
document.getElementById('btn-poi')
  .addEventListener('click', openPoiModal);
document.getElementById('btn-export')
  .addEventListener('click', exportGeoJSON);
document.getElementById('btn-layers')
  .addEventListener('click', openLayerPanel);
document.getElementById('btn-close-panel')
  .addEventListener('click', closeLayerPanel);
document.getElementById('panel-overlay')
  .addEventListener('click', closeLayerPanel);
document.getElementById('btn-poi-ok')
  .addEventListener('click', registerPoi);
document.getElementById('btn-poi-cancel')
  .addEventListener('click', () => {
    document.getElementById('poi-modal').classList.remove('show');
  });
document.getElementById('poi-name')
  .addEventListener('keydown', e => {
    if (e.key === 'Enter') registerPoi();
  });

/* =========================================================================
   K. 架線集材シミュレーション & DEM縦断面図機能
   ========================================================================= */

let demRaster = null;
let demWidth = 1000;
let demHeight = 750;
let demData = null;

const demBounds = {
  sw: [36.5806468, 136.7643842],
  ne: [36.5942384, 136.7866666]
};

/**
 * 07HD811_DEM.tif 標高データの読み込み (JSグローバル ➔ GeoTIFF ➔ fetchJson の順)
 */
async function loadDemTiff() {
  // 1. window.demData (data/dem_data.js) からの即時ロード
  if (typeof window !== 'undefined' && window.demData) {
    demData = window.demData;
    demWidth = demData.width || 1000;
    demHeight = demData.height || 750;
    console.log('Loaded DEM from window.demData');
    showToast(`⛰ 07HD811_DEM.tif 標高データ読み込み完了 (${demWidth}x${demHeight})`);
    return;
  }

  // 2. 07HD811_DEM.tif の直接バイナリ読み込み
  const candidates = [
    'data/07HD811_DEM.tif',
    './data/07HD811_DEM.tif',
    '07HD811_DEM.tif'
  ];

  for (const url of candidates) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const arrayBuffer = await res.arrayBuffer();

      if (typeof GeoTIFF !== 'undefined') {
        const tiff = await GeoTIFF.fromArrayBuffer(arrayBuffer);
        const image = await tiff.getImage();
        demWidth = image.getWidth();
        demHeight = image.getHeight();
        const rasters = await image.readRasters();
        demRaster = rasters[0];
        console.log(`07HD811_DEM.tif 読み込み成功 (${demWidth}x${demHeight})`);
        showToast(`⛰ 07HD811_DEM.tif 標高データ読み込み完了 (${demWidth}x${demHeight})`);
        return;
      }
    } catch (e) {
      console.warn(`URL ${url} からの 07HD811_DEM.tif 取得失敗:`, e);
    }
  }

  // 3. フォールバック: JSONの非同期取得
  try {
    demData = await fetchJson(['data/dem_data.json', './data/dem_data.json']);
    demWidth = demData.width || 1000;
    demHeight = demData.height || 750;
    showToast(`⛰ 07HD811_DEM.tif 標高データ読み込み完了 (${demWidth}x${demHeight})`);
  } catch (e) {
    console.warn('DEMデータの取得に失敗しました:', e);
  }
}

loadDemTiff();

/**
 * 緯度経度から 07HD811_DEM.tif の標高(m)を即座にサンプリング取得する
 */
function sampleElevation(lat, lng) {
  // グローバル window.demData 参照
  const activeDemData = demData || (typeof window !== 'undefined' ? window.demData : null);

  const sw = demBounds.sw;
  const ne = demBounds.ne;

  // 0.0 ~ 1.0 にクランプして正規化
  let normX = (lng - sw[1]) / (ne[1] - sw[1]);
  let normY = (ne[0] - lat) / (ne[0] - sw[0]);

  normX = Math.min(Math.max(normX, 0), 1);
  normY = Math.min(Math.max(normY, 0), 1);

  const curWidth = (activeDemData && activeDemData.width) ? activeDemData.width : demWidth;
  const curHeight = (activeDemData && activeDemData.height) ? activeDemData.height : demHeight;

  const col = Math.min(Math.max(Math.floor(normX * curWidth), 0), curWidth - 1);
  const row = Math.min(Math.max(Math.floor(normY * curHeight), 0), curHeight - 1);

  if (activeDemData && activeDemData.grid && activeDemData.grid[row]) {
    const val = activeDemData.grid[row][col];
    if (val !== undefined && val !== null && !isNaN(val)) return val;
  }

  if (demRaster) {
    const val = demRaster[row * curWidth + col];
    if (val !== undefined && val !== null && !isNaN(val) && val > -999) {
      return val;
    }
  }

  return 120.0;
}

const cableState = {
  active: false,
  startLatLng: null,
  endLatLng: null,
  startMarker: null,
  endMarker: null,
  polyline: null,
  bufferLayer: null,
  exportData: null,
};

const cableLayer = L.layerGroup().addTo(map);

/**
 * 始点・終点から左右20m(計40m幅)のバッファーポリゴン頂点を生成 (WGS84)
 */
function createCableBufferPolygon(p1, p2, bufferMeter = 20) {
  const avgLat = (p1.lat + p2.lat) / 2;
  const radLat = (avgLat * Math.PI) / 180;
  const metersPerDegLat = 111000;
  const metersPerDegLng = 111000 * Math.cos(radLat);

  const dx = (p2.lng - p1.lng) * metersPerDegLng;
  const dy = (p2.lat - p1.lat) * metersPerDegLat;
  const len = Math.sqrt(dx * dx + dy * dy);

  if (len === 0) return null;

  // 法線ベクトル (20m)
  const nx = (-dy / len) * bufferMeter;
  const ny = (dx / len) * bufferMeter;

  const dLng = nx / metersPerDegLng;
  const dLat = ny / metersPerDegLat;

  const c1 = [p1.lat + dLat, p1.lng + dLng];
  const c2 = [p2.lat + dLat, p2.lng + dLng];
  const c3 = [p2.lat - dLat, p2.lng - dLng];
  const c4 = [p1.lat - dLat, p1.lng - dLng];

  return [c1, c2, c3, c4, c1];
}

/**
 * 点 [lat, lng] が 多角形 [[lat, lng], ...] 内部にあるか判定 (Ray Casting)
 */
function isPointInPoly(pt, poly) {
  const x = pt[0], y = pt[1];
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1];
    const xj = poly[j][0], yj = poly[j][1];
    const intersect = ((yi > y) !== (yj > y))
        && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

/* 架線モード切り替えボタン */
document.getElementById('btn-cable').addEventListener('click', function () {
  cableState.active = !cableState.active;
  if (cableState.active) {
    this.classList.add('active');
    showToast('📐 架線シミュレーションモード: オン\n地図上の始点(元木)と終点(先木)をタップして下さい');
    updateStatusText('📐 始点（元木/集材機）をタップ指定して下さい');
    resetCableState(false);
  } else {
    this.classList.remove('active');
    showToast('📐 架線シミュレーションモード: オフ');
    updateStatusText('待機中');
  }
});

/* 地図クリックイベント */
map.on('click', function (e) {
  if (!cableState.active) return;

  if (!cableState.startLatLng) {
    // 1タップ目: 始点 (元木)
    cableState.startLatLng = e.latlng;
    const ele = sampleElevation(e.latlng.lat, e.latlng.lng);

    cableState.startMarker = L.marker(e.latlng, {
      icon: L.divIcon({
        className: '',
        html: `<div style="background:#d84315;color:#fff;padding:4px 8px;border-radius:12px;border:2px solid #fff;font-weight:bold;font-size:12px;white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,0.6);">🔴 始点(元木) ${ele ? Math.round(ele) + 'm' : ''}</div>`,
        iconAnchor: [30, 15]
      })
    }).addTo(cableLayer);

    showToast('🔴 始点(元木)を設定しました。次に終点(先木)をタップして下さい');
    updateStatusText('📐 終点（先木/伐採地）をタップ指定して下さい');
  } else if (!cableState.endLatLng) {
    // 2タップ目: 終点 (先木)
    cableState.endLatLng = e.latlng;
    const ele = sampleElevation(e.latlng.lat, e.latlng.lng);

    cableState.endMarker = L.marker(e.latlng, {
      icon: L.divIcon({
        className: '',
        html: `<div style="background:#0288d1;color:#fff;padding:4px 8px;border-radius:12px;border:2px solid #fff;font-weight:bold;font-size:12px;white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,0.6);">🔵 終点(先木) ${ele ? Math.round(ele) + 'm' : ''}</div>`,
        iconAnchor: [30, 15]
      })
    }).addTo(cableLayer);

    cableState.polyline = L.polyline([cableState.startLatLng, cableState.endLatLng], {
      color: '#ff6e40',
      weight: 4,
      dashArray: '8, 8',
      opacity: 0.95
    }).addTo(cableLayer);

    calculateAndShowCableProfile();
  } else {
    // 3タップ目以降: リセットして新しい始点
    resetCableState(false);
    cableState.startLatLng = e.latlng;
    const ele = sampleElevation(e.latlng.lat, e.latlng.lng);

    cableState.startMarker = L.marker(e.latlng, {
      icon: L.divIcon({
        className: '',
        html: `<div style="background:#d84315;color:#fff;padding:4px 8px;border-radius:12px;border:2px solid #fff;font-weight:bold;font-size:12px;white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,0.6);">🔴 始点(元木) ${ele ? Math.round(ele) + 'm' : ''}</div>`,
        iconAnchor: [30, 15]
      })
    }).addTo(cableLayer);

    showToast('🔴 新しい始点(元木)を設定しました');
    updateStatusText('📐 終点（先木/伐採地）をタップ指定して下さい');
  }
});

function resetCableState(clearActive = true) {
  if (clearActive) cableState.active = false;
  cableState.startLatLng = null;
  cableState.endLatLng = null;
  cableState.exportData = null;
  cableLayer.clearLayers();
}

/**
 * 架線縦断面図プロファイルの計算・集材収穫量計算およびモーダル描画
 */
function calculateAndShowCableProfile() {
  const p1 = cableState.startLatLng;
  const p2 = cableState.endLatLng;

  const totalHorizDist = map.distance(p1, p2); // 水平距離 (メートル)
  const STEPS = 80;

  const profilePoints = [];
  let minEle = Infinity;
  let maxEle = -Infinity;

  for (let i = 0; i <= STEPS; i++) {
    const ratio = i / STEPS;
    const lat = p1.lat + (p2.lat - p1.lat) * ratio;
    const lng = p1.lng + (p2.lng - p1.lng) * ratio;

    const dist = totalHorizDist * ratio;
    let ele = sampleElevation(lat, lng);

    if (ele === null) {
      ele = profilePoints.length > 0 ? profilePoints[profilePoints.length - 1].ele : 100;
    }

    if (ele < minEle) minEle = ele;
    if (ele > maxEle) maxEle = ele;

    profilePoints.push({ dist, ele, lat, lng });
  }

  const startGroundEle = profilePoints[0].ele;
  const endGroundEle = profilePoints[profilePoints.length - 1].ele;

  // 元柱・先柱ともに地上10m高に設定
  const SPAR_HEIGHT = 10.0;
  const startCableEle = startGroundEle + SPAR_HEIGHT;
  const endCableEle = endGroundEle + SPAR_HEIGHT;
  const diffEle = endCableEle - startCableEle; // 標高差 (m)
  const slopeDist = Math.sqrt(totalHorizDist * totalHorizDist + diffEle * diffEle);
  const avgSlopeRad = Math.atan2(Math.abs(diffEle), totalHorizDist);
  const avgSlopeDeg = (avgSlopeRad * 180 / Math.PI);
  const avgSlopePct = (Math.abs(diffEle) / totalHorizDist) * 100;

  // -------------------------------------------------------------------------
  // 主索たわみ計算 (集中荷重 P = 1.5t = 14.715 kN, 水平張力 H = 30.0 kN)
  // -------------------------------------------------------------------------
  const LOAD_P_KN = 14.715; // 1.5t
  const TENSION_H_KN = 30.0; // 3.0t 緊張力

  const maxSagMeter = (LOAD_P_KN * totalHorizDist) / (4 * TENSION_H_KN); // スパン中央最大たわみ (m)

  // 各地点での無荷重直線索標高・2t荷重時索標高・クリアランス判定
  let isFeasible = true;
  let minClearance = Infinity;

  profilePoints.forEach(p => {
    const ratio = p.dist / totalHorizDist;
    const straightCableEle = startCableEle + (endCableEle - startCableEle) * ratio;
    
    // 位置 dist におけるたわみ量 δ(x) = (P * x * (L - x)) / (H * L)
    const sag = (LOAD_P_KN * p.dist * (totalHorizDist - p.dist)) / (TENSION_H_KN * totalHorizDist);
    const loadedCableEle = straightCableEle - sag;
    const clearance = loadedCableEle - p.ele; // 地盤標高との隙間

    p.straightCableEle = straightCableEle;
    p.loadedCableEle = loadedCableEle;
    p.sag = sag;
    p.clearance = clearance;

    if (clearance < minClearance) minClearance = clearance;
    if (clearance <= 0) isFeasible = false;
  });

  // 集材範囲（左右20m = 幅40m）バッファーポリゴンの計算
  const bufferPolyCoords = createCableBufferPolygon(p1, p2, 20);

  // 地図上に集材バッファー範囲をオーバーレイ描画
  if (bufferPolyCoords) {
    cableState.bufferLayer = L.polygon(bufferPolyCoords, {
      color: '#ff9800',
      weight: 2,
      dashArray: '6, 6',
      fillColor: '#ff9800',
      fillOpacity: 0.25
    }).addTo(cableLayer);
  }

  // 集材範囲内の樹木抽出 & 収穫量集計
  let harvestedTreeCount = 0;
  let grossStandingVol = 0.0;

  const treeGeoData = (typeof window !== 'undefined' && window.treesGeoJsonData) ? window.treesGeoJsonData : null;

  if (bufferPolyCoords && treeGeoData && treeGeoData.features) {
    treeGeoData.features.forEach(feat => {
      if (feat.geometry && feat.geometry.type === 'Point' && feat.geometry.coordinates) {
        const lng = feat.geometry.coordinates[0];
        const lat = feat.geometry.coordinates[1];
        if (isPointInPoly([lat, lng], bufferPolyCoords)) {
          harvestedTreeCount++;
          const vol = (feat.properties && feat.properties.TANBOKUZAISEKI) ? parseFloat(feat.properties.TANBOKUZAISEKI) : 0;
          grossStandingVol += (isNaN(vol) ? 0 : vol);
        }
      }
    });
  }

  const harvestedNetVol = grossStandingVol * 0.80; // 搬出材積 80%

  // エクスポート用データ保持
  cableState.exportData = {
    headSpar: {
      lat: p1.lat, lng: p1.lng,
      groundEle: startGroundEle,
      sparEle: startCableEle,
      sparHeight: SPAR_HEIGHT
    },
    tailSpar: {
      lat: p2.lat, lng: p2.lng,
      groundEle: endGroundEle,
      sparEle: endCableEle,
      sparHeight: SPAR_HEIGHT
    },
    line: {
      horizDist: totalHorizDist,
      slopeDist: slopeDist,
      diffEle: diffEle,
      avgSlopeDeg: avgSlopeDeg,
      avgSlopePct: avgSlopePct,
      maxSagMeter: maxSagMeter,
      minClearanceMeter: minClearance,
      isFeasible: isFeasible
    },
    harvest: {
      bufferWidthM: 40.0,
      treeCount: harvestedTreeCount,
      grossVolM3: grossStandingVol,
      harvestedVolM3: harvestedNetVol,
      bufferPolyCoords: bufferPolyCoords
    }
  };

  // DOM反映
  document.getElementById('cable-start-ele').textContent = `${startCableEle.toFixed(1)} m (地盤 ${startGroundEle.toFixed(1)}m)`;
  document.getElementById('cable-end-ele').textContent = `${endCableEle.toFixed(1)} m (地盤 ${endGroundEle.toFixed(1)}m)`;
  document.getElementById('cable-diff-ele').textContent = `${diffEle > 0 ? '+' : ''}${diffEle.toFixed(1)} m`;
  document.getElementById('cable-dist-horiz').textContent = `${totalHorizDist.toFixed(1)} m / ${slopeDist.toFixed(1)} m`;
  document.getElementById('cable-max-sag').textContent = `${maxSagMeter.toFixed(2)} m`;

  const feasibilityEl = document.getElementById('cable-feasibility-status');
  if (isFeasible) {
    feasibilityEl.textContent = `⭕ 可能 (最小地上高 ${minClearance.toFixed(1)}m)`;
    feasibilityEl.style.color = '#00e676';
  } else {
    feasibilityEl.textContent = `⚠️ 不可 (地面接触 接触${Math.abs(minClearance).toFixed(1)}m)`;
    feasibilityEl.style.color = '#ff1744';
  }

  // 収穫量DOM反映
  document.getElementById('harvest-tree-count').textContent = `${harvestedTreeCount} 本`;
  document.getElementById('harvest-gross-vol').textContent = `${grossStandingVol.toFixed(2)} m³`;
  document.getElementById('harvest-net-vol').textContent = `${harvestedNetVol.toFixed(2)} m³`;

  // モーダル表示
  document.getElementById('cable-modal').classList.add('show');

  // Canvasプロット描画
  renderProfileCanvas(profilePoints, totalHorizDist, minEle, maxEle, SPAR_HEIGHT);
}

/**
 * Canvasに縦断面図（プロファイルチャート）をレンダリング
 */
function renderProfileCanvas(points, totalDist, minEle, maxEle, sparHeight = 10.0) {
  const canvas = document.getElementById('cable-profile-canvas');
  const ctx = canvas.getContext('2d');

  const width = canvas.width;
  const height = canvas.height;

  ctx.clearRect(0, 0, width, height);

  // パディング定義
  const padL = 50;
  const padR = 25;
  const padT = 30;
  const padB = 40;

  const chartW = width - padL - padR;
  const chartH = height - padT - padB;

  // Y軸スケール（標高）余白 (10m 柱高＋余白を考慮)
  const maxCableEle = Math.max(maxEle + sparHeight, points[0].ele + sparHeight, points[points.length - 1].ele + sparHeight);
  const eleSpan = Math.max(maxCableEle - minEle, 15);
  const yMin = Math.floor(minEle - eleSpan * 0.08);
  const yMax = Math.ceil(maxCableEle + eleSpan * 0.12);

  const getX = d => padL + (d / totalDist) * chartW;
  const getY = e => padT + chartH - ((e - yMin) / (yMax - yMin)) * chartH;

  // 1. 背景グリッド
  ctx.strokeStyle = '#333333';
  ctx.lineWidth = 1;

  const yStep = Math.ceil((yMax - yMin) / 5);
  ctx.fillStyle = '#888888';
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'right';

  for (let e = yMin; e <= yMax; e += yStep) {
    const y = getY(e);
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(width - padR, y);
    ctx.stroke();
    ctx.fillText(`${e}m`, padL - 6, y + 4);
  }

  // X軸目盛
  ctx.textAlign = 'center';
  const xStep = totalDist / 5;
  for (let i = 0; i <= 5; i++) {
    const d = xStep * i;
    const x = getX(d);
    ctx.beginPath();
    ctx.moveTo(x, padT);
    ctx.lineTo(x, padT + chartH);
    ctx.stroke();
    ctx.fillText(`${Math.round(d)}m`, x, height - padB + 16);
  }

  // 2. 地盤高塗りつぶし（緑〜褐色グラデーション）
  const grad = ctx.createLinearGradient(0, padT, 0, padT + chartH);
  grad.addColorStop(0, 'rgba(76, 175, 80, 0.6)');
  grad.addColorStop(1, 'rgba(46, 125, 50, 0.25)');

  ctx.beginPath();
  ctx.moveTo(getX(0), padT + chartH);

  points.forEach(p => {
    ctx.lineTo(getX(p.dist), getY(p.ele));
  });

  ctx.lineTo(getX(totalDist), padT + chartH);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // 3. 地盤プロファイルライン
  ctx.beginPath();
  points.forEach((p, idx) => {
    const x = getX(p.dist);
    const y = getY(p.ele);
    if (idx === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = '#4caf50';
  ctx.lineWidth = 2.5;
  ctx.stroke();

  // 4. 元柱 (始点) および 先柱 (終点) の支柱描画 (地上10m)
  const startGroundY = getY(points[0].ele);
  const startTopY = getY(points[0].ele + sparHeight);
  const endGroundY = getY(points[points.length - 1].ele);
  const endTopY = getY(points[points.length - 1].ele + sparHeight);
  const startX = getX(0);
  const endX = getX(totalDist);

  // 柱の棒 (ブラウン/グレー)
  ctx.strokeStyle = '#8d6e63';
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';

  // 元柱
  ctx.beginPath();
  ctx.moveTo(startX, startGroundY);
  ctx.lineTo(startX, startTopY);
  ctx.stroke();

  // 先柱
  ctx.beginPath();
  ctx.moveTo(endX, endGroundY);
  ctx.lineTo(endX, endTopY);
  ctx.stroke();
  ctx.lineCap = 'butt';

  // 5. 無荷重主索直線ライン（薄オレンジ点線）
  ctx.beginPath();
  ctx.setLineDash([4, 4]);
  ctx.moveTo(startX, startTopY);
  ctx.lineTo(endX, endTopY);
  ctx.strokeStyle = 'rgba(255, 152, 0, 0.6)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.setLineDash([]); // 点線リセット

  // 6. 2t荷重時 主索たわみ垂下ライン（朱色〜赤色実線）
  ctx.beginPath();
  points.forEach((p, idx) => {
    const x = getX(p.dist);
    const y = getY(p.loadedCableEle !== undefined ? p.loadedCableEle : p.straightCableEle);
    if (idx === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = '#ff1744';
  ctx.lineWidth = 2.5;
  ctx.stroke();

  // 7. 始点・終点の元柱・先柱頂部マーカー
  ctx.fillStyle = '#d84315';
  ctx.beginPath();
  ctx.arc(startX, startTopY, 5.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.fillStyle = '#0288d1';
  ctx.beginPath();
  ctx.arc(endX, endTopY, 5.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // 凡例表示（Canvas右上の凡例ガイド）
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'right';
  ctx.fillStyle = '#4caf50';
  ctx.fillText('― 地盤標高', width - padR - 10, padT + 12);
  ctx.fillStyle = '#ff1744';
  ctx.fillText('― 1.5t荷重主索たわみ線', width - padR - 10, padT + 26);

  // 軸ラベル
  ctx.fillStyle = '#aaa';
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('水平距離 (m)', padL + chartW / 2, height - 6);
}

// モーダル閉じるボタン
document.getElementById('btn-close-cable-modal').addEventListener('click', () => {
  document.getElementById('cable-modal').classList.remove('show');
});

// 架線集材レイヤー 表示/非表示切り替え
const toggleCableDataEl = document.getElementById('toggle-cable-data');
if (toggleCableDataEl) {
  toggleCableDataEl.addEventListener('change', function () {
    this.checked ? map.addLayer(cableLayer) : map.removeLayer(cableLayer);
  });
}

// レイヤーパネルのエクスポートボタンイベント
const btnPanelExportCable = document.getElementById('btn-panel-export-cable');
if (btnPanelExportCable) {
  btnPanelExportCable.addEventListener('click', exportCableGeoJSON);
}

/* 架線シミュレーション GeoJSON エクスポート処理 */
function exportCableGeoJSON() {
  const d = cableState.exportData;
  if (!d) {
    showToast('⚠ エクスポート可能な架線シミュレーションデータがありません。\n架線集材モード(📐)で始点と終点を指定して下さい。');
    return;
  }

  // 1. 元柱 (始点) ポイント
  const headPointFeature = {
    type: 'Feature',
    properties: {
      type: 'HeadSpar',
      name: '元柱 (始点)',
      lat: roundNum(d.headSpar.lat, 7),
      lng: roundNum(d.headSpar.lng, 7),
      ground_elevation_m: roundNum(d.headSpar.groundEle, 2),
      spar_elevation_m: roundNum(d.headSpar.sparEle, 2),
      spar_height_m: d.headSpar.sparHeight
    },
    geometry: {
      type: 'Point',
      coordinates: [roundNum(d.headSpar.lng, 7), roundNum(d.headSpar.lat, 7)]
    }
  };

  // 2. 先柱 (終点) ポイント
  const tailPointFeature = {
    type: 'Feature',
    properties: {
      type: 'TailSpar',
      name: '先柱 (終点)',
      lat: roundNum(d.tailSpar.lat, 7),
      lng: roundNum(d.tailSpar.lng, 7),
      ground_elevation_m: roundNum(d.tailSpar.groundEle, 2),
      spar_elevation_m: roundNum(d.tailSpar.sparEle, 2),
      spar_height_m: d.tailSpar.sparHeight
    },
    geometry: {
      type: 'Point',
      coordinates: [roundNum(d.tailSpar.lng, 7), roundNum(d.tailSpar.lat, 7)]
    }
  };

  // 3. 架線ライン (LineString)
  const lineFeature = {
    type: 'Feature',
    properties: {
      type: 'MainCableLine',
      horizontal_distance_m: roundNum(d.line.horizDist, 2),
      slope_distance_m: roundNum(d.line.slopeDist, 2),
      elevation_diff_m: roundNum(d.line.diffEle, 2),
      avg_slope_deg: roundNum(d.line.avgSlopeDeg, 2),
      avg_slope_pct: roundNum(d.line.avgSlopePct, 2)
    },
    geometry: {
      type: 'LineString',
      coordinates: [
        [roundNum(d.headSpar.lng, 7), roundNum(d.headSpar.lat, 7)],
        [roundNum(d.tailSpar.lng, 7), roundNum(d.tailSpar.lat, 7)]
      ]
    }
  };

  // 4. 集材範囲バッファー (Polygon)
  let polyCoordsGeoJSON = [];
  if (d.harvest.bufferPolyCoords) {
    polyCoordsGeoJSON = d.harvest.bufferPolyCoords.map(pt => [roundNum(pt[1], 7), roundNum(pt[0], 7)]);
  }

  const bufferFeature = {
    type: 'Feature',
    properties: {
      type: 'HarvestBufferZone',
      buffer_width_m: d.harvest.bufferWidthM,
      tree_count: d.harvest.treeCount,
      gross_standing_volume_m3: roundNum(d.harvest.grossVolM3, 3),
      harvested_volume_m3: roundNum(d.harvest.harvestedVolM3, 3)
    },
    geometry: {
      type: 'Polygon',
      coordinates: [polyCoordsGeoJSON]
    }
  };

  const featureCollection = {
    type: 'FeatureCollection',
    name: 'TimberCal_Cable_Simulation',
    features: [headPointFeature, tailPointFeature, lineFeature, bufferFeature]
  };

  // ダウンロード実行
  const jsonStr = JSON.stringify(featureCollection, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  a.href = url;
  a.download = `cable_simulation_${timestamp}.geojson`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showToast('💾 架線シミュレーション GeoJSONファイルをダウンロードしました');
}

function roundNum(val, decimals = 2) {
  return parseFloat(Number(val).toFixed(decimals));
}

/* 操作説明＆公共測量データ表記モーダルの開閉 */
const btnInfoEl = document.getElementById('btn-info');
const infoModalEl = document.getElementById('info-modal');
const btnCloseInfoModalEl = document.getElementById('btn-close-info-modal');

if (btnInfoEl && infoModalEl) {
  btnInfoEl.addEventListener('click', () => {
    infoModalEl.classList.add('show');
  });
}

if (btnCloseInfoModalEl && infoModalEl) {
  btnCloseInfoModalEl.addEventListener('click', () => {
    infoModalEl.classList.remove('show');
  });
}

/* 起動完了メッセージ */
showToast('🌲 林業試験場 現地調査アプリ 起動完了', 3000);
updateStatusText('待機中 - 📍で現在地取得');
