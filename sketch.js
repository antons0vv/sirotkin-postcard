const PASTVU_API = 'https://pastvu.com/api2';
const NOMINATIM  = 'https://nominatim.openstreetmap.org/search';
const PASTVU_IMG = 'https://img.pastvu.com/h/';

const CORS_PROXY = 'https://corsproxy.io/?url=';


const PDF_H = 105;

const CNV_W = 1748;
const CNV_H = 1240;

const FONT_SIZE    = 9;
const CHAR_W_RATIO = 0.58;
const LINE_RATIO   = 1.08;
const TITLE_SIZE   = 110;

let customFont;
let chars = [];
let pendingRender = null;
let pInst;

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
    const { img, city, yearFrom, yearTo, photo } = pendingRender;
    pendingRender = null;

    img.resize(CNV_W, CNV_H);
    p.colorMode(p.RGB, 255);
    img.loadPixels();

    p.background(255);
    p.textFont(customFont);
    p.textSize(FONT_SIZE);
    p.textAlign(p.LEFT, p.TOP);
    p.noStroke();

    const charW = FONT_SIZE * CHAR_W_RATIO;
    const lineH = FONT_SIZE * LINE_RATIO;
    const iw    = img.width;

    let ci = 0;
    for (let y = 0; y < CNV_H; y += lineH) {
      for (let x = 0; x < CNV_W; x += charW) {
        const px = Math.min(Math.floor(x), iw - 1);
        const py = Math.min(Math.floor(y), img.height - 1);
        const pi = (py * iw + px) * 4;
        p.fill(img.pixels[pi], img.pixels[pi + 1], img.pixels[pi + 2]);
        p.text(chars[ci % chars.length], x, y);
        ci++;
      }
    }

    const yearLabel = yearFrom === yearTo ? String(yearFrom) : `${yearFrom} — ${yearTo}`;

    p.fill(0, 0, 0, 200);
    p.rect(0, CNV_H - TITLE_SIZE * 2.2, CNV_W, TITLE_SIZE * 2.2);

    p.fill(255);
    p.textAlign(p.CENTER, p.BASELINE);
    p.textSize(TITLE_SIZE);
    p.text(city.toUpperCase(), CNV_W / 2, CNV_H - TITLE_SIZE * 0.9);

    p.textSize(TITLE_SIZE * 0.4);
    p.text(yearLabel, CNV_W / 2, CNV_H - TITLE_SIZE * 0.25);

    p.fill(160);
    p.textSize(TITLE_SIZE * 0.18);
    p.textAlign(p.LEFT, p.BASELINE);
    if (photo.title) p.text(photo.title, 16, CNV_H - 14);
    p.textAlign(p.RIGHT, p.BASELINE);
    p.text('Неистовый тур', CNV_W - 16, CNV_H - 14);

    const dataUrl = document.querySelector('#hidden-canvas canvas').toDataURL('image/jpeg', 0.92);
    exportPDF(dataUrl, city, yearFrom, yearTo);

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

  if (!city)             { setStatus('Введите название города'); return; }
  if (yearFrom > yearTo) { setStatus('Проверьте диапазон лет');  return; }

  const btn = document.getElementById('search-btn');
  btn.disabled = true;

  setStatus('Геокодирование...');
  let geo;
  try {
    geo = await geocodeCity(city);
  } catch {
    setStatus('Город не найден'); btn.disabled = false; return;
  }

  setStatus('Поиск фотографий...');
  let photos;
  try {
    photos = await fetchPhotos(geo.lat, geo.lon, yearFrom, yearTo);
  } catch (err) {
    setStatus('Ошибка Pastvu: ' + err.message); btn.disabled = false; return;
  }

  if (!photos.length) {
    setStatus('Фотографий не найдено — расширьте диапазон'); btn.disabled = false; return;
  }

  const pool  = photos.slice(0, Math.min(5, photos.length));
  const photo = pool[Math.floor(Math.random() * pool.length)];
  const rawUrl = PASTVU_IMG + photo.file.replace(/^\//, '');
  const imgUrl = CORS_PROXY + encodeURIComponent(rawUrl);

  setStatus('Загрузка фото...');
  pInst.loadImage(
    imgUrl,
    (img) => {
      setStatus('Рендеринг...');
      pendingRender = { img, city, yearFrom, yearTo, photo };
      setTimeout(() => pInst.redraw(), 30);
    },
    () => {
      setStatus('Не удалось загрузить фото (CORS)');
      btn.disabled = false;
    }
  );
}

function exportPDF(imgData, city, yearFrom, yearTo) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a6' });
  doc.addImage(imgData, 'JPEG', 0, 0, PDF_W, PDF_H);
  const slug = city.toLowerCase().replace(/\s+/g, '-').replace(/[^a-zа-яёА-ЯЁ0-9-]/g, '') || 'postcard';
  doc.save(`${slug}_${yearFrom}-${yearTo}.pdf`);
}

async function geocodeCity(name) {
  const res  = await fetch(`${NOMINATIM}?q=${encodeURIComponent(name)}&format=json&limit=1`, {
    headers: { 'Accept-Language': 'ru,en' }
  });
  const data = await res.json();
  if (!data.length) throw new Error('not found');
  return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
}

async function fetchPhotos(lat, lon, yearFrom, yearTo) {
  const params = encodeURIComponent(JSON.stringify({
    geo: [lat, lon], limit: 20, year: yearFrom, year2: yearTo
  }));
  const res  = await fetch(`${PASTVU_API}?method=photo.giveNearestPhotos&params=${params}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.result?.photos ?? [];
}

function setStatus(msg) {
  document.getElementById('status').textContent = msg;
}
