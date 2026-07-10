const apiBase = import.meta.env.VITE_API_BASE_URL || `${window.location.protocol}//${window.location.hostname}:8787`;

export function apiUrl(path) {
  return `${apiBase}${path}`;
}
