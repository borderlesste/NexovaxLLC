export const WELCOME_BADGE_WIDTH = 1200;
export const WELCOME_BADGE_HEIGHT = 1600;
export const WELCOME_BADGE_LOGO = '/brand/nexovax-mark@2x.png';
export const WELCOME_BADGE_PHOTO = { left: 362, top: 186, diameter: 476 } as const;

// Match the public brand tokens in app/globals.css for this downloadable artwork.
const NAVY = '#0b2450';
const BLUE = '#0a6cf5';
const ORANGE = '#f5901a';
const WHITE = '#ffffff';
const LIGHT_BLUE = '#d9e8ff';
const CENTER = WELCOME_BADGE_WIDTH / 2;

export interface WelcomeBadgeCrop {
  zoom: number;
  x: number;
  y: number;
}

interface WelcomeBadgeArtwork {
  publicName: string;
  crop: WelcomeBadgeCrop;
  photo: HTMLImageElement | null;
  logo: HTMLImageElement;
  fontFamily?: string;
}

/** A cover crop whose endpoints still fill the photo at every zoom and position. */
export function welcomeBadgeCropFrame(imageWidth: number, imageHeight: number, { zoom, x, y }: WelcomeBadgeCrop, diameter: number = WELCOME_BADGE_PHOTO.diameter) {
  const scale = diameter / Math.min(imageWidth, imageHeight) * Math.max(1, Math.min(3, zoom));
  const width = imageWidth * scale;
  const height = imageHeight * scale;
  const paddingX = Math.max(0, (width - diameter) / 2);
  const paddingY = Math.max(0, (height - diameter) / 2);
  return {
    left: (Math.max(-1, Math.min(1, x)) - 1) * paddingX,
    top: (Math.max(-1, Math.min(1, y)) - 1) * paddingY,
    width,
    height,
    paddingX,
    paddingY,
  };
}

type Point = [number, number];
type Ctx = CanvasRenderingContext2D;

const NAVY_DEEP = '#061636';
const GLOW_BLUE = '#2f8bff';
const ORANGE_LIGHT = '#ffc04a';
const ORANGE_DARK = '#f07400';

function fillPolygon(ctx: Ctx, color: string | CanvasGradient, [start, ...points]: Point[]) {
  ctx.beginPath();
  ctx.moveTo(...start);
  for (const point of points) ctx.lineTo(...point);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

/** Upper edge of the navy body: rises from the left, dips behind the portrait and sweeps up to the right. */
function wavePath(ctx: Ctx) {
  ctx.moveTo(0, 342);
  ctx.bezierCurveTo(150, 252, 320, 192, 470, 196);
  ctx.bezierCurveTo(620, 200, 700, 290, 830, 284);
  ctx.bezierCurveTo(980, 276, 1100, 205, 1200, 140);
}

/** Horizontal lens flare: a bright core that fades into a coloured streak. */
function flare(ctx: Ctx, x: number, y: number, width: number, color: string, height = 10) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const streak = ctx.createLinearGradient(x - width / 2, 0, x + width / 2, 0);
  streak.addColorStop(0, 'rgba(255,255,255,0)');
  streak.addColorStop(0.5, color);
  streak.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = streak;
  ctx.fillRect(x - width / 2, y - 1.5, width, 3);
  ctx.translate(x, y);
  ctx.scale(width / 2 / height, 1);
  const core = ctx.createRadialGradient(0, 0, 0, 0, 0, height);
  core.addColorStop(0, 'rgba(255,255,255,0.95)');
  core.addColorStop(0.35, color);
  core.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(0, 0, height, 0, 2 * Math.PI);
  ctx.fill();
  ctx.restore();
}

function drawBackground(ctx: Ctx) {
  const W = WELCOME_BADGE_WIDTH;
  const H = WELCOME_BADGE_HEIGHT;

  // Light sky with soft highlights.
  const sky = ctx.createLinearGradient(0, 0, 0, 380);
  sky.addColorStop(0, '#f4f8ff');
  sky.addColorStop(1, '#c9dcff');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, 420);
  for (const [x, y, r] of [[260, 120, 420], [980, 60, 360]] as const) {
    const light = ctx.createRadialGradient(x, y, 0, x, y, r);
    light.addColorStop(0, 'rgba(255,255,255,0.95)');
    light.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = light;
    ctx.fillRect(0, 0, W, 420);
  }

  // Navy body with a lighter centre and dark corners.
  ctx.save();
  ctx.beginPath();
  wavePath(ctx);
  ctx.lineTo(W, H);
  ctx.lineTo(0, H);
  ctx.closePath();
  const body = ctx.createRadialGradient(CENTER, 720, 80, CENTER, 760, 980);
  body.addColorStop(0, '#13408f');
  body.addColorStop(0.5, NAVY);
  body.addColorStop(1, NAVY_DEEP);
  ctx.fillStyle = body;
  ctx.fill();
  ctx.clip();
  // Blue rim inside the wave edge, brightest on the left.
  const rim = ctx.createLinearGradient(0, 0, 900, 0);
  rim.addColorStop(0, 'rgba(70,150,255,0.95)');
  rim.addColorStop(0.55, 'rgba(47,120,240,0.55)');
  rim.addColorStop(1, 'rgba(47,120,240,0)');
  ctx.beginPath();
  wavePath(ctx);
  ctx.strokeStyle = rim;
  ctx.lineWidth = 54;
  ctx.filter = 'blur(14px)';
  ctx.stroke();
  ctx.filter = 'none';
  // Faint specks for depth.
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 70; i++) {
    const x = (i * 467.3) % W;
    const y = 300 + ((i * 811.7) % 1050);
    ctx.fillStyle = `rgba(150,195,255,${0.08 + (i % 5) * 0.035})`;
    ctx.beginPath();
    ctx.arc(x, y, 1 + (i % 3) * 0.7, 0, 2 * Math.PI);
    ctx.fill();
  }
  ctx.restore();

  // White highlight line along the wave edge.
  const edge = ctx.createLinearGradient(0, 0, 760, 0);
  edge.addColorStop(0, 'rgba(255,255,255,1)');
  edge.addColorStop(0.7, 'rgba(200,225,255,0.6)');
  edge.addColorStop(1, 'rgba(200,225,255,0)');
  ctx.save();
  ctx.beginPath();
  wavePath(ctx);
  ctx.strokeStyle = edge;
  ctx.lineWidth = 3;
  ctx.shadowColor = '#bcd6ff';
  ctx.shadowBlur = 20;
  ctx.stroke();
  ctx.restore();

  // Orange ribbon on the upper right, widening towards the corner.
  const ribbon = ctx.createLinearGradient(740, 0, 1200, 0);
  ribbon.addColorStop(0, 'rgba(245,144,26,0)');
  ribbon.addColorStop(0.3, ORANGE_DARK);
  ribbon.addColorStop(1, ORANGE_LIGHT);
  ctx.beginPath();
  ctx.moveTo(740, 286);
  ctx.bezierCurveTo(930, 268, 1090, 160, 1200, 40);
  ctx.lineTo(1200, 140);
  ctx.bezierCurveTo(1100, 205, 980, 276, 830, 284);
  ctx.closePath();
  ctx.fillStyle = ribbon;
  ctx.fill();
  const ribbonShine = ctx.createLinearGradient(820, 0, 1200, 0);
  ribbonShine.addColorStop(0, 'rgba(255,230,170,0)');
  ribbonShine.addColorStop(1, 'rgba(255,236,190,0.9)');
  ctx.beginPath();
  ctx.moveTo(760, 285);
  ctx.bezierCurveTo(940, 266, 1092, 162, 1200, 44);
  ctx.strokeStyle = ribbonShine;
  ctx.lineWidth = 4;
  ctx.stroke();

  // Particle mesh wave along the bottom: rows of dots that spread out with perspective.
  const top = (x: number) => 1486 + 82 * Math.cos(Math.PI * (x - 600) / 520);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let row = 0; row < 22; row++) {
    const depth = row / 21;
    for (let x = -10; x <= W + 10; x += 7 + depth * 3) {
      const y = top(x) + row * (6 + row * 0.55) + 14 * depth * Math.sin(x / 150 + row * 0.35);
      if (y > H + 4) continue;
      const fade = 0.4 + 0.6 * Math.abs(Math.cos(Math.PI * (x - 600) / 1040));
      ctx.fillStyle = `rgba(${60 + (1 - depth) * 90},${150 + (1 - depth) * 70},255,${Math.min(1, (1.1 - depth * 0.75) * fade)})`;
      ctx.beginPath();
      ctx.arc(x, y, 2.6 - depth * 1.2, 0, 2 * Math.PI);
      ctx.fill();
    }
  }
  ctx.beginPath();
  for (let x = 0; x <= W; x += 5) {
    if (x === 0) ctx.moveTo(x, top(x)); else ctx.lineTo(x, top(x));
  }
  ctx.strokeStyle = 'rgba(140,200,255,0.9)';
  ctx.lineWidth = 2;
  ctx.shadowColor = GLOW_BLUE;
  ctx.shadowBlur = 22;
  ctx.stroke();
  ctx.restore();

  // Bottom-right orange swoosh with a pale highlight band.
  const swoosh = ctx.createLinearGradient(840, H, W, 1330);
  swoosh.addColorStop(0, ORANGE_DARK);
  swoosh.addColorStop(1, ORANGE_LIGHT);
  ctx.beginPath();
  ctx.moveTo(830, H);
  ctx.bezierCurveTo(970, 1525, 1090, 1430, W, 1330);
  ctx.lineTo(W, H);
  ctx.closePath();
  ctx.fillStyle = swoosh;
  ctx.fill();
  const band = ctx.createLinearGradient(900, 0, W, 0);
  band.addColorStop(0, 'rgba(255,224,150,0)');
  band.addColorStop(0.5, 'rgba(255,224,150,0.75)');
  band.addColorStop(1, 'rgba(255,240,200,0.9)');
  ctx.beginPath();
  ctx.moveTo(900, H);
  ctx.bezierCurveTo(1010, 1550, 1110, 1480, W, 1420);
  ctx.lineTo(W, 1460);
  ctx.bezierCurveTo(1120, 1510, 1030, 1570, 960, H);
  ctx.closePath();
  ctx.fillStyle = band;
  ctx.fill();
}

function drawPhoto(ctx: Ctx, photo: HTMLImageElement | null, crop: WelcomeBadgeCrop) {
  const { left, top, diameter } = WELCOME_BADGE_PHOTO;
  const radius = diameter / 2;
  const cx = left + radius;
  const cy = top + radius;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius + 7, 0, 2 * Math.PI);
  ctx.fillStyle = WHITE;
  ctx.shadowColor = 'rgba(6,22,54,0.6)';
  ctx.shadowBlur = 44;
  ctx.shadowOffsetY = 14;
  ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius + 9, 0, 2 * Math.PI);
  ctx.strokeStyle = 'rgba(190,215,255,0.7)';
  ctx.lineWidth = 3;
  ctx.shadowColor = '#cfe2ff';
  ctx.shadowBlur = 18;
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
  ctx.clip();
  ctx.fillStyle = LIGHT_BLUE;
  ctx.fillRect(left, top, diameter, diameter);
  if (photo?.naturalWidth && photo.naturalHeight) {
    const frame = welcomeBadgeCropFrame(photo.naturalWidth, photo.naturalHeight, crop);
    ctx.drawImage(photo, left + frame.left, top + frame.top, frame.width, frame.height);
  }
  ctx.restore();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
  ctx.strokeStyle = WHITE;
  ctx.lineWidth = 9;
  ctx.stroke();
}

/** Dark plate with a glowing double outline, used by the member tag and the tagline. */
function glowPlate(ctx: Ctx, outer: () => void, inner: () => void, stroke: string, glow: string) {
  ctx.save();
  outer();
  const fill = ctx.createLinearGradient(0, 0, 0, WELCOME_BADGE_HEIGHT);
  fill.addColorStop(0, 'rgba(8,28,70,0.94)');
  fill.addColorStop(1, 'rgba(6,20,52,0.94)');
  ctx.fillStyle = fill;
  ctx.shadowColor = glow;
  ctx.shadowBlur = 40;
  ctx.fill();
  ctx.restore();
  ctx.save();
  outer();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 5;
  ctx.shadowColor = glow;
  ctx.shadowBlur = 24;
  ctx.stroke();
  ctx.stroke();
  ctx.restore();
  ctx.save();
  inner();
  ctx.globalAlpha = 0.55;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}

function tagPath(ctx: Ctx, inset: number) {
  const [l, r, t, b, tip] = [322 + inset, 878 - inset, 676 + inset, 768 - inset, 40 - inset * 0.4];
  const m = (t + b) / 2;
  ctx.beginPath();
  ctx.moveTo(l, m);
  ctx.lineTo(l + tip, t);
  ctx.lineTo(r - tip, t);
  ctx.lineTo(r, m);
  ctx.lineTo(r - tip, b);
  ctx.lineTo(l + tip, b);
  ctx.closePath();
}

/** The preview canvas is also the export source, including font metrics and cropping. */
export function drawWelcomeBadge(ctx: Ctx, { publicName, crop, photo, logo, fontFamily = 'system-ui, sans-serif' }: WelcomeBadgeArtwork) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.textBaseline = 'middle';
  ctx.direction = 'ltr';

  const font = (weight: number, size: number, italic = false) => { ctx.font = `${italic ? 'italic ' : ''}${weight} ${size}px ${fontFamily}`; };
  const text = (value: string, y: number, weight: number, size: number, color: string, maxWidth = 1100) => {
    font(weight, size);
    const width = ctx.measureText(value).width;
    if (width > maxWidth) font(weight, size * maxWidth / width);
    ctx.textAlign = 'center';
    ctx.fillStyle = color;
    ctx.fillText(value, CENTER, y);
  };
  const runs = (segments: [string, string][], x: number, y: number) => {
    ctx.textAlign = 'left';
    for (const [value, color] of segments) {
      ctx.fillStyle = color;
      ctx.fillText(value, x, y);
      x += ctx.measureText(value).width;
    }
  };
  const centeredRuns = (segments: [string, string][], y: number) => {
    const width = segments.reduce((sum, [part]) => sum + ctx.measureText(part).width, 0);
    runs(segments, (WELCOME_BADGE_WIDTH - width) / 2, y);
  };
  const textShadow = () => {
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = 14;
    ctx.shadowOffsetY = 5;
  };

  drawBackground(ctx);

  const markSize = 150;
  font(900, 118);
  const wordWidth = ctx.measureText('NEXOVA').width + ctx.measureText('X').width;
  const gap = 26;
  const markLeft = (WELCOME_BADGE_WIDTH - markSize - gap - wordWidth) / 2;
  ctx.drawImage(logo, markLeft, 22, markSize, markSize);
  runs([['NEXOVA', '#0a1f4a'], ['X', ORANGE]], markLeft + markSize + gap, 100);

  drawPhoto(ctx, photo, crop);

  // "NEW MEMBER" tag with pointed ends, double outline and flares.
  glowPlate(ctx, () => tagPath(ctx, 0), () => tagPath(ctx, 9), ORANGE, ORANGE);
  flare(ctx, CENTER, 676, 420, 'rgba(255,170,60,0.9)', 9);
  flare(ctx, CENTER, 768, 520, 'rgba(255,150,40,0.95)', 12);
  ctx.save();
  ctx.shadowColor = ORANGE;
  ctx.shadowBlur = 16;
  fillPolygon(ctx, ORANGE, Array.from({ length: 10 }, (_, index): Point => {
    const angle = -Math.PI / 2 + index * Math.PI / 5;
    const radius = index % 2 === 0 ? 32 : 14;
    return [405 + Math.cos(angle) * radius, 723 + Math.sin(angle) * radius];
  }));
  ctx.restore();
  font(850, 48);
  runs([['NEW MEMBER', WHITE]], 460, 723);

  const name = publicName.trim().replace(/\s+/g, ' ');
  ctx.save();
  textShadow();
  font(850, 70);
  if (ctx.measureText(name).width <= 1040) {
    text(name, 842, 850, 100, WHITE, 1040);
  } else {
    // Break long names close to their visual midpoint, preferring boundaries between words.
    const characters = typeof Intl.Segmenter === 'function'
      ? Array.from(new Intl.Segmenter().segment(name), (entry) => entry.segment)
      : Array.from(name);
    const midpoint = Math.ceil(characters.length / 2);
    const before = characters.lastIndexOf(' ', midpoint);
    const after = characters.indexOf(' ', midpoint);
    const space = after < 0 || (before >= 0 && midpoint - before <= after - midpoint) ? before : after;
    const split = space > characters.length * 0.25 && space < characters.length * 0.75 ? space : midpoint;
    const first = characters.slice(0, split).join('').trim();
    const second = characters.slice(split).join('').trim();
    const nameSize = Math.min(60, 70 * 1040 / Math.max(ctx.measureText(first).width, ctx.measureText(second).width));
    text(first, 812, 850, nameSize, WHITE, 1040);
    text(second, 874, 850, nameSize, WHITE, 1040);
  }

  font(900, 94, true);
  const welcome: [string, string][] = [['WELCOME TO ', WHITE], ['NEXOVAX', ORANGE], ['!', WHITE]];
  const welcomeWidth = welcome.reduce((sum, [part]) => sum + ctx.measureText(part).width, 0);
  if (welcomeWidth > 1130) font(900, 94 * 1130 / welcomeWidth, true);
  centeredRuns(welcome, 958);
  ctx.restore();

  text('We’re excited to have you with us.', 1030, 560, 50, '#dbe7ff');
  text('Your journey starts here.', 1084, 560, 50, '#dbe7ff');

  // Tagline plate with light streaks on both sides.
  const taglineY = 1196;
  for (const [from, to] of [[70, 222], [1130, 978]] as const) {
    const streak = ctx.createLinearGradient(from, 0, to, 0);
    streak.addColorStop(0, 'rgba(120,180,255,0)');
    streak.addColorStop(1, 'rgba(190,225,255,1)');
    ctx.fillStyle = streak;
    ctx.fillRect(Math.min(from, to), taglineY - 1.5, Math.abs(to - from), 3);
  }
  flare(ctx, 196, taglineY, 120, 'rgba(90,170,255,0.9)', 7);
  flare(ctx, 1004, taglineY, 120, 'rgba(90,170,255,0.9)', 7);
  glowPlate(ctx, () => { ctx.beginPath(); ctx.roundRect(222, taglineY - 50, 756, 100, 50); },
    () => { ctx.beginPath(); ctx.roundRect(231, taglineY - 41, 738, 82, 41); }, '#4aa3ff', GLOW_BLUE);
  flare(ctx, CENTER, taglineY - 50, 360, 'rgba(110,180,255,0.9)', 8);
  flare(ctx, CENTER, taglineY + 50, 480, 'rgba(130,195,255,0.95)', 11);
  font(850, 60);
  const dot = (x: number) => {
    ctx.save();
    ctx.fillStyle = '#ffb020';
    ctx.shadowColor = ORANGE;
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(x, taglineY + 1, 9, 0, 2 * Math.PI);
    ctx.fill();
    ctx.restore();
  };
  const words = ['BUY', 'SELL', 'EARN'];
  const spacing = 84;
  const widths = words.map((word) => ctx.measureText(word).width);
  let x = (WELCOME_BADGE_WIDTH - widths.reduce((a, b) => a + b, 0) - spacing * 2) / 2;
  words.forEach((word, index) => {
    runs([[word, WHITE]], x, taglineY + 2);
    x += widths[index];
    if (index < words.length - 1) { dot(x + spacing / 2); x += spacing; }
  });

  // Glossy orange call to action with a glowing rim and a flare underneath.
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(270, 1290, 660, 112, 56);
  const button = ctx.createLinearGradient(0, 1290, 0, 1402);
  button.addColorStop(0, '#ffc54d');
  button.addColorStop(0.45, '#ff9e1f');
  button.addColorStop(1, ORANGE_DARK);
  ctx.fillStyle = button;
  ctx.shadowColor = ORANGE;
  ctx.shadowBlur = 46;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(255,214,130,0.95)';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.restore();
  ctx.beginPath();
  ctx.roundRect(306, 1298, 588, 36, 18);
  const gloss = ctx.createLinearGradient(0, 1298, 0, 1334);
  gloss.addColorStop(0, 'rgba(255,255,255,0.35)');
  gloss.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gloss;
  ctx.fill();
  flare(ctx, CENTER, 1402, 520, 'rgba(255,170,60,0.95)', 12);
  text('nexovax.com', 1348, 850, 70, '#0a1f4a', 560);
  ctx.restore();
}
