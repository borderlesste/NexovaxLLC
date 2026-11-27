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

function fillPolygon(ctx: CanvasRenderingContext2D, color: string, [start, ...points]: Point[]) {
  ctx.beginPath();
  ctx.moveTo(...start);
  for (const point of points) ctx.lineTo(...point);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function fillPill(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, radius: number, color: string) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, radius);
  ctx.fillStyle = color;
  ctx.fill();
}

function drawPhoto(ctx: CanvasRenderingContext2D, photo: HTMLImageElement | null, crop: WelcomeBadgeCrop) {
  const { left, top, diameter } = WELCOME_BADGE_PHOTO;
  const radius = diameter / 2;
  ctx.save();
  ctx.beginPath();
  ctx.arc(left + radius, top + radius, radius, 0, 2 * Math.PI);
  ctx.clip();
  ctx.fillStyle = LIGHT_BLUE;
  ctx.fillRect(left, top, diameter, diameter);
  if (photo?.naturalWidth && photo.naturalHeight) {
    const frame = welcomeBadgeCropFrame(photo.naturalWidth, photo.naturalHeight, crop);
    ctx.drawImage(photo, left + frame.left, top + frame.top, frame.width, frame.height);
  }
  ctx.restore();
  ctx.strokeStyle = WHITE;
  ctx.lineWidth = 10;
  ctx.stroke();
}

/** The preview canvas is also the export source, including font metrics and cropping. */
export function drawWelcomeBadge(ctx: CanvasRenderingContext2D, { publicName, crop, photo, logo, fontFamily = 'system-ui, sans-serif' }: WelcomeBadgeArtwork) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.textBaseline = 'middle';
  ctx.direction = 'ltr';

  const font = (weight: number, size: number) => { ctx.font = `${weight} ${size}px ${fontFamily}`; };
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

  ctx.fillStyle = WHITE;
  ctx.fillRect(0, 0, WELCOME_BADGE_WIDTH, WELCOME_BADGE_HEIGHT);
  fillPolygon(ctx, BLUE, [[0, 522], [1200, 222], [1200, 1600], [0, 1600]]);
  fillPolygon(ctx, NAVY, [[0, 600], [1200, 282], [1200, 1409], [762, 1600], [0, 1600]]);

  const markSize = 236;
  font(900, 132);
  const wordWidth = ctx.measureText('NEXOVA').width + ctx.measureText('X').width;
  const gap = 10;
  const markLeft = (WELCOME_BADGE_WIDTH - markSize - gap - wordWidth) / 2;
  ctx.drawImage(logo, markLeft, 26, markSize, markSize);
  runs([['NEXOVA', NAVY], ['X', ORANGE]], markLeft + markSize + gap, 139);

  drawPhoto(ctx, photo, crop);

  fillPill(ctx, 315, 808, 570, 97, 30, NAVY);
  ctx.lineWidth = 5;
  ctx.strokeStyle = ORANGE;
  ctx.stroke();
  const star = Array.from({ length: 10 }, (_, index): Point => {
    const angle = -Math.PI / 2 + index * Math.PI / 5;
    const radius = index % 2 === 0 ? 37 : 16;
    return [385 + Math.cos(angle) * radius, 858 + Math.sin(angle) * radius];
  });
  fillPolygon(ctx, ORANGE, star);
  font(850, 52);
  runs([['NEW MEMBER', WHITE]], 449, 859);

  const name = publicName.trim().replace(/\s+/g, ' ');
  font(850, 70);
  if (ctx.measureText(name).width <= 1040) {
    text(name, 978, 850, 99, WHITE, 1040);
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
    text(first, 950, 850, nameSize, WHITE, 1040);
    text(second, 1022, 850, nameSize, WHITE, 1040);
  }

  text('WELCOME TO NEXOVAX!', 1119, 900, 87, WHITE);
  text("We're excited to have you with us.", 1205, 575, 53, LIGHT_BLUE);
  text('Your journey starts here.', 1269, 575, 53, LIGHT_BLUE);

  font(850, 66);
  const tagline: [string, string][] = [['BUY', WHITE], [' • ', ORANGE], ['SELL', WHITE], [' • ', ORANGE], ['EARN', WHITE]];
  const taglineWidth = tagline.reduce((width, [part]) => width + ctx.measureText(part).width, 0);
  runs(tagline, (WELCOME_BADGE_WIDTH - taglineWidth) / 2, 1394);
  fillPill(ctx, 297, 1448, 606, 96, 48, ORANGE);
  text('nexovax.com', 1499, 850, 64, NAVY, 532);
  ctx.restore();
}
