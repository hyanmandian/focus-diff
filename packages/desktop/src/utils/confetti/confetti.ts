const COUNT = 120;
const DURATION_MS = 2200;
const GRAVITY = 1400;
const DRAG = 1.6;
const COLORS = ["--success", "--primary", "--warning", "--violet", "--destructive"];

type Piece = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  rotation: number;
  spin: number;
  flutter: number;
  color: string;
};

export function confetti(from: { x: number; y: number }) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const styles = getComputedStyle(document.documentElement);
  const colors = COLORS.map((name) => styles.getPropertyValue(name).trim()).filter(Boolean);
  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  canvas.style.cssText = "position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:100";
  const scale = Math.max(1, devicePixelRatio);
  canvas.width = Math.round(innerWidth * scale);
  canvas.height = Math.round(innerHeight * scale);
  const context = canvas.getContext("2d");
  if (!context) return;
  document.body.append(canvas);
  context.scale(scale, scale);
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
      color: colors[index % colors.length] ?? "#34c759",
    };
  });
  const started = performance.now();
  let last = started;
  const frame = (now: number) => {
    const elapsed = now - started;
    if (elapsed > DURATION_MS || !canvas.isConnected) {
      canvas.remove();
      return;
    }
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    context.clearRect(0, 0, innerWidth, innerHeight);
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
      context.scale(1, Math.cos(piece.flutter));
      context.fillStyle = piece.color;
      context.fillRect(-piece.size / 2, -piece.size / 4, piece.size, piece.size / 2);
      context.restore();
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
