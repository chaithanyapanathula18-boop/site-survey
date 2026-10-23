// Hand a generated file to the person: the share sheet where it works, otherwise a download.

export function safeFileName(name, ext) {
  const base = String(name || 'site')
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60) || 'site';
  return `${base}.${ext}`;
}

export function canShareFile(blob, filename) {
  try {
    const file = new File([blob], filename, { type: blob.type });
    return !!(navigator.canShare && navigator.canShare({ files: [file] }));
  } catch {
    return false;
  }
}

export async function shareFile(blob, filename, title) {
  const file = new File([blob], filename, { type: blob.type });
  try {
    await navigator.share({ files: [file], title: title || filename });
    return 'shared';
  } catch (e) {
    if (e && e.name === 'AbortError') return 'cancelled';
    throw e;
  }
}

export function downloadFile(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return 'downloaded';
}
