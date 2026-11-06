export const texturedCardCorners = [
  { x: 170, y: 100 }, { x: 500, y: 120 },
  { x: 540, y: 370 }, { x: 90, y: 345 },
];
const grain = Array.from({ length: 45 }, (_, index) =>
  `<path d="M0 ${index * 11} Q210 ${index * 11 + 8} 640 ${index * 11 - 5}" stroke="#78583b" stroke-width="2" fill="none"/>`,
).join("");
export const texturedCardContent = `<rect width="640" height="480" fill="#b18c65"/>${grain}
  <polygon points="${texturedCardCorners.map((p) => `${p.x},${p.y}`).join(" ")}" fill="#bdd9e9"/>
  <path d="M220 185L450 198 M210 218L460 232 M200 255L470 270" stroke="#26343e" stroke-width="5"/>`;
export const texturedCardSvg = `<svg width="640" height="480" xmlns="http://www.w3.org/2000/svg">${texturedCardContent}</svg>`;
