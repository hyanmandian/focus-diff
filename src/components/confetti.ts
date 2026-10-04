const COUNT = 120;
const DURATION_MS = 2200;
const GRAVITY = 1400;
const DRAG = 1.6;
/** The theme's colours, as the panel reads them. */
const COLORS = ['--fd-add', '--fd-accent', '--fd-attention', '--fd-done', '--fd-del'];

interface Piece {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  rotation: number;
  spin: number;
  flutter: number;
  color: string;
}

/**
 * A burst of confetti from a point on the screen, drawn on a canvas that removes itself when it's done. Nothing happens
 * for readers who prefer reduced motion.
 */
export const confetti = (parent: HTMLElement, from: { x: number; y: number }): void => {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const styles = getComputedStyle(parent);
  const colors = COLORS.map((name) => styles.getPropertyValue(name).trim()).filter(Boolean);
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:-1';
  const scale = devicePixelRatio || 1;
  canvas.width = Math.round(innerWidth * scale);
  canvas.height = Math.round(innerHeight * scale);
  // Behind the panel, so it bursts out from under it.
  parent.append(canvas);
  const context = canvas.getContext('2d');
  if (!context) return canvas.remove();
  context.scale(scale, scale);

  // Thrown up and out in a fan, so it rises over the page before it falls.
  const pieces: Piece[] = Array.from({ length: COUNT }, (_, index) => {
    const angle = (-90 + (Math.random() - 0.5) * 110) * (Math.PI / 180);
    const speed = 500 + Math.random() * 650;
    return {
      x: from.x,
      y: from.y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: 6 + Math.random() * 5,
      rotation: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 12,
      flutter: Math.random() * Math.PI * 2,
      color: colors[index % colors.length] ?? '#2da44e',
    };
  });

  const started = performance.now();
  let last = started;
  const frame = (now: number) => {
    const elapsed = now - started;
    if (elapsed > DURATION_MS || !canvas.isConnected) return canvas.remove();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    context.clearRect(0, 0, innerWidth, innerHeight);
    // Fades out over the last third.
    context.globalAlpha = Math.min(1, ((DURATION_MS - elapsed) / DURATION_MS) * 3);
    for (const piece of pieces) {
      piece.vx -= piece.vx * DRAG * dt;
      piece.vy += (GRAVITY - piece.vy * DRAG) * dt;
      piece.x += piece.vx * dt;
      piece.y += piece.vy * dt;
      piece.rotation += piece.spin * dt;
      piece.flutter += 10 * dt;
      context.save();
      context.translate(piece.x, piece.y);
      context.rotate(piece.rotation);
      // Turning over as it falls: the piece narrows and widens like paper.
      context.scale(1, Math.cos(piece.flutter));
      context.fillStyle = piece.color;
      context.fillRect(-piece.size / 2, -piece.size / 4, piece.size, piece.size / 2);
      context.restore();
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
};
