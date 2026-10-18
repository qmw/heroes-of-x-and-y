// English plural of a creature / unit name ("Pikeman" -> "Pikemen", "Serpent Fly" -> "Serpent Flies").
// Shared by data (building descriptions) and UI texts.
export function pluralize(name) {
  const s = String(name ?? '');
  if (/man$/i.test(s)) return s.replace(/man$/i, (m) => (m[0] === 'M' ? 'Men' : 'men'));
  if (/[^aeiou]y$/i.test(s)) return `${s.slice(0, -1)}ies`;
  if (/(s|x|ch|sh)$/i.test(s)) return `${s}es`;
  if (/f$/i.test(s) && !/ff$/i.test(s)) return `${s.slice(0, -1)}ves`;
  return `${s}s`;
}
