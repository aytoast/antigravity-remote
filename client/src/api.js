const apiBase = import.meta.env.VITE_API_BASE_URL || `${window.location.protocol}//${window.location.hostname}:8787`;

export function apiUrl(path) {
  return `${apiBase}${path}`;
}

export async function requestApi(path, options, fallbackError) {
  const response = await fetch(apiUrl(path), options);
  const data = await response.json();

  if (!response.ok || !data.success) {
    throw new Error(data.error || fallbackError);
  }

  return data.data;
}
