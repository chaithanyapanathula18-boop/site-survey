// Photo handling: shrink for storage, thumbnails, and GPS from EXIF when present.

const MAX_BYTES = 800 * 1024; // keeps each photo inside one cloud document

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve({ img, url });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('This image format could not be opened.'));
    };
    img.src = url;
  });
}

function drawScaled(img, maxSide) {
  const w0 = img.naturalWidth || img.width;
  const h0 = img.naturalHeight || img.height;
  const s = Math.min(1, maxSide / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * s));
  const h = Math.max(1, Math.round(h0 * s));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);
  return canvas;
}

function canvasToBlob(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not save the photo.'))), 'image/jpeg', quality);
  });
}

export async function processPhoto(file) {
  const exifGps = await readExifGps(file).catch(() => null);
  const { img, url } = await loadImage(file);
  try {
    let blob = null;
    let canvas = null;
    for (const [side, q] of [
      [1600, 0.72],
      [1280, 0.62],
      [1024, 0.55],
      [800, 0.5],
    ]) {
      canvas = drawScaled(img, side);
      blob = await canvasToBlob(canvas, q);
      if (blob.size <= MAX_BYTES) break;
    }
    const thumbCanvas = drawScaled(img, 200);
    const thumb = thumbCanvas.toDataURL('image/jpeg', 0.6);
    return { blob, thumb, w: canvas.width, h: canvas.height, exifGps };
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Minimal EXIF reader for the GPS position in a JPEG.
export async function readExifGps(file) {
  const head = await file.slice(0, 256 * 1024).arrayBuffer();
  const v = new DataView(head);
  if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return null;
  let off = 2;
  while (off + 4 <= v.byteLength) {
    const marker = v.getUint16(off);
    if ((marker & 0xff00) !== 0xff00) return null;
    const size = v.getUint16(off + 2);
    if (marker === 0xffe1 && off + 10 <= v.byteLength && v.getUint32(off + 4) === 0x45786966) {
      return parseTiffGps(v, off + 10);
    }
    if (marker === 0xffda) return null; // start of image data
    off += 2 + size;
  }
  return null;
}

function parseTiffGps(v, tiff) {
  const little = v.getUint16(tiff) === 0x4949;
  const u16 = (o) => v.getUint16(o, little);
  const u32 = (o) => v.getUint32(o, little);
  if (u16(tiff + 2) !== 42) return null;
  const ifd0 = tiff + u32(tiff + 4);
  let gpsIfd = null;
  const count0 = u16(ifd0);
  for (let i = 0; i < count0; i++) {
    const e = ifd0 + 2 + i * 12;
    if (u16(e) === 0x8825) gpsIfd = tiff + u32(e + 8);
  }
  if (!gpsIfd || gpsIfd + 2 > v.byteLength) return null;
  const tags = {};
  const n = u16(gpsIfd);
  for (let i = 0; i < n; i++) {
    const e = gpsIfd + 2 + i * 12;
    if (e + 12 > v.byteLength) break;
    const tag = u16(e);
    const type = u16(e + 2);
    const count = u32(e + 4);
    const valOff = e + 8;
    if (type === 2) {
      tags[tag] = String.fromCharCode(v.getUint8(valOff));
    } else if (type === 5) {
      const p = tiff + u32(valOff);
      const vals = [];
      for (let k = 0; k < count && p + k * 8 + 8 <= v.byteLength; k++) {
        const den = u32(p + k * 8 + 4);
        vals.push(den ? u32(p + k * 8) / den : 0);
      }
      tags[tag] = vals;
    }
  }
  const dms = (a) => (a && a.length >= 3 ? a[0] + a[1] / 60 + a[2] / 3600 : null);
  let lat = dms(tags[2]);
  let lng = dms(tags[4]);
  if (lat == null || lng == null) return null;
  if (tags[1] === 'S') lat = -lat;
  if (tags[3] === 'W') lng = -lng;
  const acc = Array.isArray(tags[0x1f]) ? tags[0x1f][0] : null;
  if (!isFinite(lat) || !isFinite(lng) || (lat === 0 && lng === 0)) return null;
  return { lat, lng, acc: acc && isFinite(acc) ? acc : null };
}

export function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export function dataURLToBlob(dataUrl) {
  const [head, b64] = dataUrl.split(',');
  const type = (head.match(/data:([^;]+)/) || [])[1] || 'application/octet-stream';
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new Blob([u8], { type });
}
