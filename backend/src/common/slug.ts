export function slugify(s: string, max = 80): string {
  const base = s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '');
  return base || 'item';
}

export function codeify(s: string): string {
  return slugify(s, 40).replace(/-/g, '_') || 'value';
}
