export function parseTrackId(input: string): string | null {
  const urlRegex = /open\.spotify\.com\/track\/([a-zA-Z0-9]{22})/;
  const uriRegex = /spotify:track:([a-zA-Z0-9]{22})/;
  const idRegex = /^([a-zA-Z0-9]{22})$/;
  const urlMatch = input.match(urlRegex);
  if (urlMatch?.[1]) return urlMatch[1];
  const uriMatch = input.match(uriRegex);
  if (uriMatch?.[1]) return uriMatch[1];
  const idMatch = input.match(idRegex);
  if (idMatch?.[1]) return idMatch[1];
  return null;
}

export function extractTrackIds(text: string): string[] {
  const ids = [
    ...[...text.matchAll(/spotify:track:([a-zA-Z0-9]{22})/g)].map((m) => m[1] as string),
    ...[...text.matchAll(/open\.spotify\.com\/track\/([a-zA-Z0-9]{22})/g)].map((m) => m[1] as string),
    ...[...text.matchAll(/"uri":"spotify:track:([a-zA-Z0-9]{22})"/g)].map((m) => m[1] as string),
  ];
  return [...new Set(ids)];
}
