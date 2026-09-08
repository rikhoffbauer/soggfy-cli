export function parseTrackId(input: string): string | null {
  const urlMatch = input.match(/open\.spotify\.com\/track\/([a-zA-Z0-9]{22})/);
  if (urlMatch?.[1]) return urlMatch[1];

  const uriMatch = input.match(/spotify:track:([a-zA-Z0-9]{22})/);
  if (uriMatch?.[1]) return uriMatch[1];

  const idMatch = input.match(/^([a-zA-Z0-9]{22})$/);
  if (idMatch?.[1]) return idMatch[1];

  return null;
}

export function extractTrackIds(text: string): string[] {
  const ids = [
    ...[...text.matchAll(/spotify:track:([a-zA-Z0-9]{22})/g)].map((m) => m[1]),
    ...[...text.matchAll(/open\.spotify\.com\/track\/([a-zA-Z0-9]{22})/g)].map((m) => m[1]),
    ...[...text.matchAll(/"uri":"spotify:track:([a-zA-Z0-9]{22})"/g)].map((m) => m[1]),
  ];
  return [...new Set(ids)];
}

export function parsePlaylistId(input: string): string | null {
  const urlMatch = input.match(/open\.spotify\.com\/playlist\/([a-zA-Z0-9]{22})/);
  if (urlMatch?.[1]) return urlMatch[1];
  const uriMatch = input.match(/spotify:playlist:([a-zA-Z0-9]{22})/);
  return uriMatch?.[1] ?? null;
}

export function parseAlbumId(input: string): string | null {
  const urlMatch = input.match(/open\.spotify\.com\/album\/([a-zA-Z0-9]{22})/);
  if (urlMatch?.[1]) return urlMatch[1];
  const uriMatch = input.match(/spotify:album:([a-zA-Z0-9]{22})/);
  return uriMatch?.[1] ?? null;
}
