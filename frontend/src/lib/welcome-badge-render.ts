export const WELCOME_BADGE_WIDTH = 1200;
export const WELCOME_BADGE_HEIGHT = 1600;
export const WELCOME_BADGE_LOGO = '/brand/nexovax-mark@2x.png';
export const WELCOME_BADGE_PHOTO = { left: 326, top: 224, diameter: 548 } as const;

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

const NAVY_DEEP = '#061738';
const GLOW_BLUE = '#2f8bff';
const ORANGE_LIGHT = '#ffb238';
const ORANGE_DARK = '#f07a00';

function fillPolygon(ctx: CanvasRenderingContext2D, color: string | CanvasGradient, [start, ...points]: Point[]) {
  ctx.beginPath();
  ctx.moveTo(...start);
  for (const point of points) ctx.lineTo(...point);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

/** Upper edge of the navy body: a soft S-curve that climbs towards the top-right corner. */
function wavePath(ctx: CanvasRenderingContext2D, offset = 0) {
  ctx.moveTo(0, 360 + offset);
  ctx.bezierCurveTo(360, 230 + offset, 820, 380 + offset, 1200, 200 + offset);
}

function drawBackground(ctx: CanvasRenderingContext2D) {
  const W = WELCOME_BADGE_WIDTH;
  const H = WELCOME_BADGE_HEIGHT;
  const sky = ctx.createLinearGradient(0, 0, 0, 420);
  sky.addColorStop(0, WHITE);
  sky.addColorStop(1, '#d6e5ff');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  // Orange ribbon between the light top and the navy body, fading out towards the left.
  const ribbon = ctx.createLinearGradient(520, 0, 1100, 0);
  ribbon.addColorStop(0, 'rgba(245,144,26,0)');
  ribbon.addColorStop(0.55, ORANGE);
  ribbon.addColorStop(1, ORANGE_LIGHT);
  ctx.beginPath();
  wavePath(ctx, -52);
  ctx.lineTo(W, H);
  ctx.lineTo(0, H);
  ctx.closePath();
  ctx.fillStyle = ribbon;
  ctx.fill();

  const body = ctx.createLinearGradient(0, 200, 0, H);
  body.addColorStop(0, '#0f2f6e');
  body.addColorStop(0.45, NAVY);
  body.addColorStop(1, NAVY_DEEP);
  ctx.beginPath();
  wavePath(ctx);
  ctx.lineTo(W, H);
  ctx.lineTo(0, H);
  ctx.closePath();
  ctx.fillStyle = body;
  ctx.fill();

  // Soft light behind the portrait and the welcome text.
  ctx.save();
  ctx.clip();
  const halo = ctx.createRadialGradient(CENTER, 560, 40, CENTER, 620, 720);
  halo.addColorStop(0, 'rgba(47,139,255,0.35)');
  halo.addColorStop(1, 'rgba(47,139,255,0)');
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();

  // Glowing light edge along the wave.
  const edge = ctx.createLinearGradient(0, 0, 900, 0);
  edge.addColorStop(0, 'rgba(255,255,255,0.95)');
  edge.addColorStop(0.6, 'rgba(160,200,255,0.55)');
  edge.addColorStop(1, 'rgba(160,200,255,0)');
  ctx.save();
  ctx.beginPath();
  wavePath(ctx);
  ctx.strokeStyle = edge;
  ctx.lineWidth = 5;
  ctx.shadowColor = '#9cc3ff';
  ctx.shadowBlur = 28;
  ctx.stroke();
  ctx.restore();

  // Bottom-right orange swoosh.
  const swoosh = ctx.createLinearGradient(760, 1600, 1200, 1460);
  swoosh.addColorStop(0, ORANGE_DARK);
  swoosh.addColorStop(1, ORANGE_LIGHT);
  ctx.beginPath();
  ctx.moveTo(720, H);
  ctx.bezierCurveTo(900, 1580, 1080, 1530, W, 1440);
  ctx.lineTo(W, H);
  ctx.closePath();
  ctx.fillStyle = swoosh;
  ctx.fill();

  // Dotted particle wave along the bottom.
  for (let row = 0; row < 12; row++) {
    for (let x = 0; x <= W; x += 9) {
      const y = 1566 + row * 7 + 26 * Math.sin(x / 190 + row * 0.18) - 18 * Math.sin(x / 470);
      if (y > H) continue;
      ctx.fillStyle = `rgba(70,150,255,${(0.9 - row * 0.065) * (0.35 + 0.65 * Math.sin(Math.PI * x / W))})`;
      ctx.beginPath();
      ctx.arc(x, y, row === 0 ? 2.4 : 1.8, 0, 2 * Math.PI);
      ctx.fill();
    }
  }
  ctx.save();
  ctx.beginPath();
  for (let x = 0; x <= W; x += 6) {
    const y = 1566 + 26 * Math.sin(x / 190) - 18 * Math.sin(x / 470);
    if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = 'rgba(120,180,255,0.8)';
  ctx.lineWidth = 2;
  ctx.shadowColor = GLOW_BLUE;
  ctx.shadowBlur = 18;
  ctx.stroke();
  ctx.restore();
}

function drawPhoto(ctx: CanvasRenderingContext2D, photo: HTMLImageElement | null, crop: WelcomeBadgeCrop) {
  const { left, top, diameter } = WELCOME_BADGE_PHOTO;
  const radius = diameter / 2;
  const cx = left + radius;
  const cy = top + radius;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius + 6, 0, 2 * Math.PI);
  ctx.fillStyle = WHITE;
  ctx.shadowColor = 'rgba(6,23,56,0.55)';
  ctx.shadowBlur = 40;
  ctx.shadowOffsetY = 12;
  ctx.fill();
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
  ctx.lineWidth = 10;
  ctx.stroke();
}

/** Navy plate with a glowing outline, used by the member tag and the tagline. */
function glowPlate(ctx: CanvasRenderingContext2D, path: () => void, stroke: string, glow: string) {
  ctx.save();
  path();
  ctx.fillStyle = 'rgba(6,23,56,0.88)';
  ctx.shadowColor = glow;
  ctx.shadowBlur = 34;
  ctx.fill();
  ctx.restore();
  ctx.save();
  path();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 5;
  ctx.shadowColor = glow;
  ctx.shadowBlur = 22;
  ctx.stroke();
  ctx.stroke();
  ctx.restore();
}

/** The preview canvas is also the export source, including font metrics and cropping. */
export function drawWelcomeBadge(ctx: CanvasRenderingContext2D, { publicName, crop, photo, logo, fontFamily = 'system-ui, sans-serif' }: WelcomeBadgeArtwork) {
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

  drawBackground(ctx);

  const markSize = 210;
  font(900, 124);
  const wordWidth = ctx.measureText('NEXOVA').width + ctx.measureText('X').width;
  const gap = 14;
  const markLeft = (WELCOME_BADGE_WIDTH - markSize - gap - wordWidth) / 2;
  ctx.drawImage(logo, markLeft, 22, markSize, markSize);
  runs([['NEXOVA', NAVY], ['X', ORANGE]], markLeft + markSize + gap, 128);

  drawPhoto(ctx, photo, crop);

  // "NEW MEMBER" tag with pointed ends and an orange glow.
  glowPlate(ctx, () => {
    ctx.beginPath();
    ctx.moveTo(300, 856);
    ctx.lineTo(338, 810);
    ctx.lineTo(862, 810);
    ctx.lineTo(900, 856);
    ctx.lineTo(862, 902);
    ctx.lineTo(338, 902);
    ctx.closePath();
  }, ORANGE, ORANGE);
  const tagShine = ctx.createLinearGradient(380, 0, 820, 0);
  tagShine.addColorStop(0, 'rgba(255,178,56,0)');
  tagShine.addColorStop(0.5, 'rgba(255,220,150,0.95)');
  tagShine.addColorStop(1, 'rgba(255,178,56,0)');
  ctx.fillStyle = tagShine;
  ctx.fillRect(380, 900, 440, 4);
  const star = Array.from({ length: 10 }, (_, index): Point => {
    const angle = -Math.PI / 2 + index * Math.PI / 5;
    const radius = index % 2 === 0 ? 34 : 15;
    return [392 + Math.cos(angle) * radius, 858 + Math.sin(angle) * radius];
  });
  fillPolygon(ctx, ORANGE, star);
  font(850, 50);
  runs([['NEW MEMBER', WHITE]], 450, 858);

  const name = publicName.trim().replace(/\s+/g, ' ');
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 12;
  ctx.shadowOffsetY = 4;
  font(850, 70);
  if (ctx.measureText(name).width <= 1040) {
    text(name, 982, 850, 99, WHITE, 1040);
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
    const nameSize = Math.min(68, 70 * 1040 / Math.max(ctx.measureText(first).width, ctx.measureText(second).width));
    text(first, 952, 850, nameSize, WHITE, 1040);
    text(second, 1024, 850, nameSize, WHITE, 1040);
  }

  font(900, 92, true);
  const welcome: [string, string][] = [['WELCOME TO ', WHITE], ['NEXOVAX', ORANGE], ['!', WHITE]];
  const welcomeWidth = welcome.reduce((sum, [part]) => sum + ctx.measureText(part).width, 0);
  if (welcomeWidth > 1120) font(900, 92 * 1120 / welcomeWidth, true);
  centeredRuns(welcome, 1120);
  ctx.restore();

  text("We're excited to have you with us.", 1204, 575, 52, LIGHT_BLUE);
  text('Your journey starts here.', 1266, 575, 52, LIGHT_BLUE);

  // Tagline plate with light streaks on both sides.
  const taglineY = 1360;
  for (const [from, to] of [[90, 236], [1110, 964]] as const) {
    const streak = ctx.createLinearGradient(from, 0, to, 0);
    streak.addColorStop(0, 'rgba(120,180,255,0)');
    streak.addColorStop(1, 'rgba(160,205,255,0.95)');
    ctx.fillStyle = streak;
    ctx.fillRect(Math.min(from, to), taglineY - 2, Math.abs(to - from), 4);
  }
  glowPlate(ctx, () => {
    ctx.beginPath();
    ctx.roundRect(236, taglineY - 47, 728, 94, 47);
  }, '#4da0ff', GLOW_BLUE);
  font(850, 62);
  centeredRuns([['BUY', WHITE], ['  •  ', ORANGE], ['SELL', WHITE], ['  •  ', ORANGE], ['EARN', WHITE]], taglineY + 2);

  // Glossy orange call to action.
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(290, 1434, 620, 96, 48);
  const button = ctx.createLinearGradient(0, 1434, 0, 1530);
  button.addColorStop(0, ORANGE_LIGHT);
  button.addColorStop(1, ORANGE_DARK);
  ctx.fillStyle = button;
  ctx.shadowColor = ORANGE;
  ctx.shadowBlur = 40;
  ctx.fill();
  ctx.restore();
  ctx.beginPath();
  ctx.roundRect(330, 1441, 540, 30, 15);
  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  ctx.fill();
  text('nexovax.com', 1484, 850, 64, NAVY_DEEP, 540);
  ctx.restore();
}
