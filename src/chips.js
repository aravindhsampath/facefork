// Suggestion chips. Single-node chips are full prompts; a stable random 5 are shown per node.
export const SINGLE = [
  'What if I had a mustache?', 'Give me round glasses', 'Put a fedora on me', 'What if I had a full beard?',
  'Dye my hair electric blue', 'Make me 10 years older', 'Make me 10 years younger', 'Turn me into a Pixar character',
  '80s yearbook photo', 'Passport photo, neutral background', 'Leather jacket, film noir lighting', 'Put a tiny crown on my head',
  'Superhero suit, dramatic sky', 'Paint me as a Renaissance portrait', 'Make it pour rain', 'Astronaut suit, helmet off',
  'Give me a bowl cut', 'Sunglasses, neon city at night', 'Turn me into a LEGO minifigure', 'Viking braids and war paint',
  'Make me a 1920s gangster', 'Cyberpunk implants and neon', 'Cover me in glitter', 'Put me on a magazine cover',
];
export const SAME_SEED = ['Combine all of these looks', 'Merge these into one outfit', 'Keep the best of each'];
export const CROSS_SEED = ['Swap our outfits', 'Put us in the same photo', 'Make us look like siblings', 'Swap our hairstyles'];

// Stable pseudo-random 5 chips for a node id.
export function chipsFor(id, n = 5) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const start = h % SINGLE.length;
  return Array.from({ length: n }, (_, i) => SINGLE[(start + i * 7) % SINGLE.length]);
}
