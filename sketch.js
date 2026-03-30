const PASTVU_API = 'https://pastvu.com/api2';
const NOMINATIM  = 'https://nominatim.openstreetmap.org/search';
const PASTVU_IMG = 'https://img.pastvu.com/h/';

const CORS_PROXY = 'https://images.weserv.nl/?url=';

const PDF_W = 148;
const PDF_H = 105;

const CNV_W      = 1748;
const CNV_H      = 1240;
const TITLE_SIZE = 110;

let customFont;
let chars = [];
let pendingRender = null;
let pInst;

// random focus position per postcard
let focusX = CNV_W * 0.5;
let focusY = CNV_H * 0.35;

const sketch = (p) => {
  pInst = p;

  p.preload = () => {
    customFont = p.loadFont('JRN55.otf');
    p.loadStrings('text.txt', (lines) => {
      chars = lines.join(' ').split('');
    });
  };

  p.setup = () => {
    const cnv = p.createCanvas(CNV_W, CNV_H);
    cnv.parent('hidden-canvas');
    p.colorMode(p.RGB, 255);
    p.textFont(customFont);
    p.noLoop();
  };

  p.draw = () => {
    if (!pendingRender) return;
    const { img, city, photo } = pendingRender;
    pendingRender = null;

    p.colorMode(p.RGB, 255);
    p.background(255);
    p.textFont(customFont);
    p.noStroke();

    const TITLE_PAD_Y  = 36;
    const TITLE_AREA_H = TITLE_SIZE + TITLE_PAD_Y * 2;
    const IMAGE_AREA_H = CNV_H - TITLE_AREA_H;

    // crop image to fill postcard image area
    const imgAspect  = img.width / img.height;
    const areaAspect = CNV_W / IMAGE_AREA_H;

    let sx = 0;
    let sy = 0;
    let sw = img.width;
    let sh = img.height;

    if (imgAspect > areaAspect) {
      sw = img.height * areaAspect;
      sx = (img.width - sw) / 2;
    } else {
      sh = img.width / areaAspect;
      sy = (img.height - sh) / 2;
    }

    const cropped = img.get(sx, sy, sw, sh);
    cropped.resize(CNV_W, IMAGE_AREA_H);
    cropped.loadPixels();

    // one random focus point for each generated postcard
    focusX = p.random(CNV_W * 0.18, CNV_W * 0.82);
    focusY = p.random(IMAGE_AREA_H * 0.15, IMAGE_AREA_H * 0.85);

    const FONT_SIZE    = 18;
    const CHAR_W_RATIO = 0.58;
    const LINE_RATIO   = 1.08;
    const charW = FONT_SIZE * CHAR_W_RATIO;
    const lineH = FONT_SIZE * LINE_RATIO;
    const iw    = cropped.width;

    p.textAlign(p.LEFT, p.TOP);

    let ci = 0;
    for (let y = 0; y < IMAGE_AREA_H; y += lineH) {
      for (let x = 0; x < CNV_W; x += charW) {
        const px = Math.min(Math.floor(x), iw - 1);
        const py = Math.min(Math.floor(y), cropped.height - 1);
        const pi = (py * iw + px) * 4;

        const r = cropped.pixels[pi];
        const g = cropped.pixels[pi + 1];
        const b = cropped.pixels[pi + 2];
        const brightness = (r + g + b) / 3;

        const ch = chars[ci % chars.length];
        ci++;

        // focus area: center = 0, outside = 1
        const d = p.dist(x, y, focusX, focusY);
        let focusAmt = p.constrain(p.map(d, 0, 380, 0, 1), 0, 1);
        focusAmt = Math.pow(focusAmt, 1.4);

        const n = p.noise(x * 0.01, y * 0.01, 0.5);

        // reversed behavior:
        // smaller text in focus, bigger outside
        let s = p.lerp(FONT_SIZE * 0.45, FONT_SIZE * 1.15, focusAmt);
        s += p.map(n, 0, 1, -1.2, 1.2);

        // more drift near focus
        const driftX = p.map(n, 0, 1, -7, 7) * (1.0 - focusAmt);
        const driftY = p.map(
          p.noise(x * 0.01 + 100, y * 0.01 + 100, 0.5),
          0, 1, -7, 7
        ) * (1.0 - focusAmt);

        // lighter in focus, stronger outside
        let a = p.lerp(70, 255, focusAmt);
        a *= p.map(brightness, 0, 255, 0.84, 1.0);

        p.fill(r, g, b, a);
        p.textSize(s);
        p.text(ch, x + driftX, y + driftY);
      }
    }

    // white title block
    p.fill(255);
    p.rect(0, IMAGE_AREA_H, CNV_W, TITLE_AREA_H);

    const photoYear = photo?.year || photo?.yearFrom || photo?.yearTo || '';
    const label = photoYear ? `${city}. ${photoYear}.` : `${city}.`;

    p.fill(0);
    p.textFont(customFont);
    p.textSize(TITLE_SIZE);
    p.textAlign(p.CENTER, p.CENTER);
    p.text(label, CNV_W / 2, IMAGE_AREA_H + TITLE_AREA_H / 2 + TITLE_SIZE * 0.08);

    const dataUrl = document.querySelector('#hidden-canvas canvas').toDataURL('image/jpeg', 0.92);
    exportPDF(dataUrl, city, photoYear || 'unknown');

    setStatus('');
    document.getElementById('search-btn').disabled = false;
  };
};

new p5(sketch);

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('search-btn').addEventListener('click', handlePrint);
});

async function handlePrint() {
  const city     = document.getElementById('city').value.trim();
  const yearFrom = parseInt(document.getElementById('year-from').value) || 1900;
  const yearTo   = parseInt(document.getElementById('year-to').value)   || 1980;

  if (!city) {
    setStatus('Введите название города');
    return;
  }

  if (yearFrom > yearTo) {
    setStatus('Проверьте диапазон лет');
    return;
  }

  const btn = document.getElementById('search-btn');
  btn.disabled = true;

  setStatus('Геокодирование...');
  let geo;
  try {
    geo = await geocodeCity(city);
  } catch {
    setStatus('Город не найден');
    btn.disabled = false;
    return;
  }

  setStatus('Поиск фотографий...');
  let photos;
  try {
    photos = await fetchPhotos(geo.lat, geo.lon, yearFrom, yearTo);
  } catch (err) {
    setStatus('Ошибка Pastvu: ' + err.message);
    btn.disabled = false;
    return;
  }

  if (!photos.length) {
    setStatus('Фотографий не найдено — расширьте диапазон');
    btn.disabled = false;
    return;
  }

  const photo  = photos[0];
  const rawUrl = (PASTVU_IMG + photo.file.replace(/^\//, '')).replace('https://', '');
  const imgUrl = CORS_PROXY + encodeURIComponent(rawUrl);

  setStatus('Загрузка фото...');
  pInst.loadImage(
    imgUrl,
    (img) => {
      setStatus('Рендеринг...');
      pendingRender = { img, city, photo };
      setTimeout(() => pInst.redraw(), 30);
    },
    () => {
      setStatus('Не удалось загрузить фото (CORS)');
      btn.disabled = false;
    }
  );
}

function exportPDF(imgData, city, photoYear) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a6' });
  doc.addImage(imgData, 'JPEG', 0, 0, PDF_W, PDF_H);

  const slug = city
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-zа-яёА-ЯЁ0-9-]/g, '') || 'postcard';

  doc.save(`${slug}_${photoYear}.pdf`);
}

async function geocodeCity(name) {
  const res = await fetch(
    `${NOMINATIM}?q=${encodeURIComponent(name)}&format=json&limit=1`,
    { headers: { 'Accept-Language': 'ru,en' } }
  );

  const data = await res.json();
  if (!data.length) throw new Error('not found');

  return {
    lat: parseFloat(data[0].lat),
    lon: parseFloat(data[0].lon)
  };
}

async function fetchPhotos(lat, lon, yearFrom, yearTo) {
  const params = encodeURIComponent(JSON.stringify({
    geo: [lat, lon],
    limit: 20,
    year: yearFrom,
    year2: yearTo
  }));

  const res = await fetch(`${PASTVU_API}?method=photo.giveNearestPhotos&params=${params}`);
  const data = await res.json();

  if (data.error) throw new Error(data.error.message);
  return data.result?.photos ?? [];
}

function setStatus(msg) {
  document.getElementById('status').textContent = msg;
}