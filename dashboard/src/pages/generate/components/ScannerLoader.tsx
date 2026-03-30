import { useState, useEffect, useRef } from "react";

interface ScannerLoaderProps {
  messages: string[];
  /** Milliseconds between message rotations (default 2500) */
  interval?: number;
}

interface Particle {
  x: number;
  y: number;
  life: number;
  maxLife: number;
  size: number;
  hue: number;
  hueShift: number;       // degrees per frame — each particle drifts color
  orbit: number;
  orbitAccel: number;      // orbit speed changes over time
  dist: number;
  angle: number;
  trail: { x: number; y: number; alpha: number }[];
  type: "swirl" | "spark" | "floater";
  pulsePhase: number;
  blur: number;
  squish: number;       // 0 = no squish, 0.08–0.2 = amount of deformation
  squishSpeed: number;  // how fast the squish oscillates
  squishAngle: number;  // rotation of the squish axis
  satPulse: number;     // 0 = no sat pulse, 8–20 = range of saturation variation
  satSpeed: number;     // oscillation rate for saturation
  litPulse: number;     // 0 = no brightness pulse, 5–15 = range of lightness variation
  litSpeed: number;     // oscillation rate for brightness
}

interface RingWave {
  radius: number;
  maxRadius: number;
  alpha: number;
  hue: number;
  width: number;
  speed: number;
}

export default function ScannerLoader({ messages, interval = 2500 }: ScannerLoaderProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [msgIndex, setMsgIndex] = useState(0);

  // Rotate messages
  useEffect(() => {
    if (messages.length <= 1) return;
    const timer = setInterval(() => {
      setMsgIndex((prev) => (prev + 1) % messages.length);
    }, interval);
    return () => clearInterval(timer);
  }, [messages, interval]);

  // Canvas animation
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const size = 400;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.scale(dpr, dpr);

    const cx = size / 2;
    const cy = size / 2;
    const particles: Particle[] = [];
    const rings: RingWave[] = [];
    let frame = 0;
    let animId: number;

    const hues = [210, 240, 270, 190, 300, 175];

    // Global heartbeat — all particles feel this rhythm
    const heartbeat = (t: number) => {
      const fast = Math.sin(t * 1.8) * 0.5 + 0.5;          // main pulse
      const slow = Math.sin(t * 0.4) * 0.3 + 0.7;          // slow swell
      return fast * 0.6 + slow * 0.4;                        // blend
    };

    // Spawn particles
    const spawn = (type: Particle["type"]) => {
      const angle = Math.random() * Math.PI * 2;
      const hue = hues[Math.floor(Math.random() * hues.length)];
      // Each particle gets its own hue drift rate (-0.3 to +0.3 deg/frame)
      const hueShift = (Math.random() - 0.5) * 0.6;

      // ~40% of swirls and ~30% of sparks get a rubbery squish
      const willSquish = type === "swirl" ? Math.random() < 0.4
        : type === "spark" ? Math.random() < 0.3
        : false;
      const squish = willSquish ? 0.08 + Math.random() * 0.14 : 0;       // 8–22% deformation
      const squishSpeed = 1.5 + Math.random() * 3;                        // varied oscillation rates
      const squishAngle = Math.random() * Math.PI;                        // random squish axis

      // ~35% get saturation pulsing, ~30% get brightness pulsing (independent rolls)
      const satPulse = Math.random() < 0.35 ? 8 + Math.random() * 12 : 0;   // ±8–20% sat range
      const satSpeed = 0.8 + Math.random() * 2.2;                            // moderate oscillation
      const litPulse = Math.random() < 0.30 ? 5 + Math.random() * 10 : 0;   // ±5–15% lightness range
      const litSpeed = 0.6 + Math.random() * 2.4;                            // slightly different rates

      if (type === "swirl") {
        const dist = 3 + Math.random() * 12;
        particles.push({
          x: cx + Math.cos(angle) * dist,
          y: cy + Math.sin(angle) * dist,
          life: 0,
          maxLife: 120 + Math.random() * 180,
          size: 1.0 + Math.random() * 2.8,
          hue,
          hueShift,
          orbit: (0.008 + Math.random() * 0.02) * (Math.random() > 0.5 ? 1 : -1),
          orbitAccel: (Math.random() - 0.5) * 0.0002,
          dist,
          angle,
          trail: [],
          type,
          pulsePhase: Math.random() * Math.PI * 2,
          blur: 0,
          squish, squishSpeed, squishAngle,
          satPulse, satSpeed, litPulse, litSpeed,
        });
      } else if (type === "spark") {
        const dist = 10 + Math.random() * 20;
        particles.push({
          x: cx + Math.cos(angle) * dist,
          y: cy + Math.sin(angle) * dist,
          life: 0,
          maxLife: 35 + Math.random() * 45,
          size: 0.5 + Math.random() * 1.4,
          hue: hue + Math.random() * 30,
          hueShift: hueShift * 2,   // sparks shift color faster
          orbit: (0.02 + Math.random() * 0.04) * (Math.random() > 0.5 ? 1 : -1),
          orbitAccel: (Math.random() - 0.5) * 0.0005,
          dist,
          angle,
          trail: [],
          type,
          pulsePhase: Math.random() * Math.PI * 2,
          blur: 0,
          squish, squishSpeed, squishAngle,
          satPulse, satSpeed, litPulse, litSpeed,
        });
      } else {
        const dist = 30 + Math.random() * 60;
        particles.push({
          x: cx + Math.cos(angle) * dist,
          y: cy + Math.sin(angle) * dist,
          life: 0,
          maxLife: 200 + Math.random() * 250,
          size: 10 + Math.random() * 20,
          hue,
          hueShift: hueShift * 0.5,  // floaters drift color slowly
          orbit: (0.002 + Math.random() * 0.005) * (Math.random() > 0.5 ? 1 : -1),
          orbitAccel: (Math.random() - 0.5) * 0.00005,
          dist,
          angle,
          trail: [],
          type,
          pulsePhase: Math.random() * Math.PI * 2,
          blur: 5 + Math.random() * 10,
          squish: 0, squishSpeed: 0, squishAngle: 0,
          satPulse, satSpeed, litPulse, litSpeed,
        });
      }
    };

    // Spawn a ring wave from the core
    const spawnRing = () => {
      rings.push({
        radius: 6 + Math.random() * 4,
        maxRadius: 100 + Math.random() * 80,
        alpha: 0.18 + Math.random() * 0.08,
        hue: hues[Math.floor(Math.random() * hues.length)],
        width: 1.5 + Math.random() * 2,
        speed: 0.3 + Math.random() * 1.2,   // some crawl, some shoot
      });
    };

    const draw = () => {
      frame++;
      const t = frame * 0.005;
      const hb = heartbeat(t);   // 0..1 global pulse

      ctx.clearRect(0, 0, size, size);

      // ── Layer 1: Deep ambient nebula ──
      for (let i = 0; i < 5; i++) {
        const offset = (i * Math.PI * 2) / 5;
        const bx = cx + Math.cos(t * 0.3 + offset) * (35 + i * 14);
        const by = cy + Math.sin(t * 0.4 + offset) * (35 + i * 14);
        const radius = 75 + Math.sin(t * 0.8 + i * 1.5) * 20;
        const hue = 215 + i * 22 + Math.sin(t * 0.25 + i) * 15;
        const alpha = (0.06 + Math.sin(t * 0.5 + i * 2) * 0.02) * (0.8 + hb * 0.2);

        const grad = ctx.createRadialGradient(bx, by, 0, bx, by, radius);
        grad.addColorStop(0, `hsla(${hue},70%,60%,${alpha})`);
        grad.addColorStop(0.4, `hsla(${hue},60%,50%,${alpha * 0.4})`);
        grad.addColorStop(1, `hsla(${hue},50%,40%,0)`);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, size, size);
      }

      // ── Layer 2: Morphing plasma blobs ──
      for (let i = 0; i < 6; i++) {
        const offset = (i * Math.PI * 2) / 6;
        const bx = cx + Math.cos(t * (0.6 + i * 0.12) + offset) * (25 + i * 7);
        const by = cy + Math.sin(t * (0.8 + i * 0.1) + offset) * (25 + i * 7);
        const radius = (28 + i * 8 + Math.sin(t * 1.2 + i) * 6) * (0.9 + hb * 0.1);

        const blobHues = [210, 245, 275, 195, 305, 230];
        const hue = blobHues[i] + Math.sin(t * 0.4 + i) * 25;
        const alpha = 0.12 - i * 0.012;

        const grad = ctx.createRadialGradient(bx, by, 0, bx, by, radius);
        grad.addColorStop(0, `hsla(${hue},75%,65%,${alpha})`);
        grad.addColorStop(0.35, `hsla(${hue},65%,55%,${alpha * 0.5})`);
        grad.addColorStop(1, `hsla(${hue},55%,45%,0)`);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, size, size);
      }

      // ── Layer 3: Ring waves ──
      if (frame % 90 === 0) spawnRing();
      for (let i = rings.length - 1; i >= 0; i--) {
        const r = rings[i];
        r.radius += r.speed + (r.radius / r.maxRadius) * r.speed * 0.5;
        const progress = r.radius / r.maxRadius;
        if (progress >= 1) { rings.splice(i, 1); continue; }

        const alpha = r.alpha * (1 - progress) * (1 - progress);
        ctx.save();
        ctx.globalCompositeOperation = "screen";
        ctx.beginPath();
        ctx.arc(cx, cy, r.radius, 0, Math.PI * 2);
        ctx.strokeStyle = `hsla(${r.hue + progress * 30},70%,70%,${alpha})`;
        ctx.lineWidth = r.width * (1 - progress * 0.5);
        ctx.stroke();
        ctx.restore();
      }

      // ── Layer 4: Floater particles ──
      if (frame % 18 === 0) spawn("floater");
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        if (p.type !== "floater") continue;
        p.life++;
        if (p.life > p.maxLife) { particles.splice(i, 1); continue; }

        // Hue drift
        p.hue += p.hueShift;

        p.orbit += p.orbitAccel;
        p.angle += p.orbit;
        p.dist += Math.sin(t + p.pulsePhase) * 0.25;
        p.x = cx + Math.cos(p.angle) * p.dist;
        p.y = cy + Math.sin(p.angle) * p.dist;

        const progress = p.life / p.maxLife;
        const fadeIn = Math.min(1, progress / 0.15);
        const fadeOut = Math.max(0, 1 - Math.pow(Math.max(0, (progress - 0.6)) / 0.4, 2));
        const alpha = fadeIn * fadeOut * 0.12 * (0.7 + hb * 0.3);
        const pulseSize = p.size * (1 + Math.sin(t * 2 + p.pulsePhase) * 0.35) * (0.85 + hb * 0.15);

        ctx.save();
        ctx.filter = `blur(${p.blur}px)`;
        const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, pulseSize);
        grad.addColorStop(0, `hsla(${p.hue},70%,70%,${alpha})`);
        grad.addColorStop(0.5, `hsla(${p.hue},60%,55%,${alpha * 0.4})`);
        grad.addColorStop(1, `hsla(${p.hue},50%,50%,0)`);
        ctx.fillStyle = grad;
        ctx.fillRect(p.x - pulseSize, p.y - pulseSize, pulseSize * 2, pulseSize * 2);
        ctx.restore();
      }

      // ── Layer 5: Swirling particles with trails + constellation lines ──
      if (frame % 3 === 0) spawn("swirl");

      // Collect visible swirl positions for constellation lines
      const swirlPositions: { x: number; y: number; hue: number; alpha: number }[] = [];

      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        if (p.type !== "swirl") continue;
        p.life++;
        if (p.life > p.maxLife) { particles.splice(i, 1); continue; }

        // Hue drift
        p.hue += p.hueShift;

        const progress = p.life / p.maxLife;
        const trailAlpha = progress < 0.1
          ? progress / 0.1
          : 1 - Math.pow((progress - 0.1) / 0.9, 0.5);
        p.trail.push({ x: p.x, y: p.y, alpha: trailAlpha });
        if (p.trail.length > 16) p.trail.shift();

        // Accelerating/decelerating orbit
        p.orbit += p.orbitAccel;
        p.angle += p.orbit;
        p.dist += 0.12 + (p.life / p.maxLife) * 0.4;
        const wobble = Math.sin(t * 3 + p.pulsePhase) * 2.5;
        p.x = cx + Math.cos(p.angle) * (p.dist + wobble);
        p.y = cy + Math.sin(p.angle) * (p.dist + wobble);

        // Heartbeat-driven size pulsing
        const sizePulse = 1 + Math.sin(t * 4 + p.pulsePhase) * 0.25;
        const hbSize = 0.85 + hb * 0.15;
        const currentSize = p.size * (1 - progress * 0.2) * sizePulse * hbSize;

        // Brightness boost during heartbeat peak
        const brightnessBoost = hb * 0.15;

        // Per-particle saturation and lightness pulsing
        const satOff = p.satPulse * Math.sin(t * p.satSpeed + p.pulsePhase * 1.7);
        const litOff = p.litPulse * Math.sin(t * p.litSpeed + p.pulsePhase * 2.3);

        // Base values with per-particle variation applied
        const sat = 75 + satOff;       // trail/glow sat (base 70-80 range)
        const satCore = 75 + satOff;   // core sat
        const lit = 65 + litOff;       // trail lightness
        const litGlow = 75 + litOff;   // glow inner lightness
        const litCore = 80 + litOff;   // core lightness

        // Draw trail
        if (p.trail.length > 2) {
          ctx.save();
          ctx.globalCompositeOperation = "screen";
          for (let j = 1; j < p.trail.length; j++) {
            const segAlpha = (j / p.trail.length) * trailAlpha * 0.3;
            const trailHue = p.hue - (p.trail.length - j) * p.hueShift * 2; // trail shows color history
            ctx.beginPath();
            ctx.moveTo(p.trail[j - 1].x, p.trail[j - 1].y);
            ctx.lineTo(p.trail[j].x, p.trail[j].y);
            ctx.strokeStyle = `hsla(${trailHue},${sat - 5}%,${lit + brightnessBoost * 100}%,${segAlpha})`;
            ctx.lineWidth = currentSize * 0.5 * (j / p.trail.length);
            ctx.stroke();
          }
          ctx.restore();
        }

        // Particle glow + core (with optional rubbery squish)
        ctx.save();
        ctx.globalCompositeOperation = "screen";

        // Compute squish deformation: stretches one axis, compresses the other
        const sq = p.squish * Math.sin(t * p.squishSpeed + p.pulsePhase);
        const scaleX = 1 + sq;
        const scaleY = 1 - sq;

        const glowSize = currentSize * 3.5;
        const glowGrad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, glowSize);
        glowGrad.addColorStop(0, `hsla(${p.hue},${sat}%,${litGlow + brightnessBoost * 100}%,${trailAlpha * 0.18})`);
        glowGrad.addColorStop(1, `hsla(${p.hue},${sat}%,60%,0)`);
        ctx.fillStyle = glowGrad;
        ctx.fillRect(p.x - glowSize, p.y - glowSize, glowSize * 2, glowSize * 2);

        // Draw as ellipse when squishing, circle otherwise
        ctx.beginPath();
        if (p.squish > 0) {
          ctx.translate(p.x, p.y);
          ctx.rotate(p.squishAngle);
          ctx.scale(scaleX, scaleY);
          ctx.arc(0, 0, currentSize, 0, Math.PI * 2);
        } else {
          ctx.arc(p.x, p.y, currentSize, 0, Math.PI * 2);
        }
        ctx.fillStyle = `hsla(${p.hue},${satCore}%,${litCore + brightnessBoost * 100}%,${trailAlpha * 0.85})`;
        ctx.fill();
        ctx.restore();

        if (trailAlpha > 0.2) {
          swirlPositions.push({ x: p.x, y: p.y, hue: p.hue, alpha: trailAlpha });
        }
      }

      // Constellation lines between nearby swirl particles
      if (swirlPositions.length > 2) {
        ctx.save();
        ctx.globalCompositeOperation = "screen";
        const maxDist = 50;
        for (let i = 0; i < swirlPositions.length; i++) {
          for (let j = i + 1; j < swirlPositions.length; j++) {
            const a = swirlPositions[i];
            const b = swirlPositions[j];
            const dx = a.x - b.x;
            const dy = a.y - b.y;
            const d = Math.sqrt(dx * dx + dy * dy);
            if (d < maxDist) {
              const lineAlpha = (1 - d / maxDist) * Math.min(a.alpha, b.alpha) * 0.12;
              const avgHue = (a.hue + b.hue) / 2;
              ctx.beginPath();
              ctx.moveTo(a.x, a.y);
              ctx.lineTo(b.x, b.y);
              ctx.strokeStyle = `hsla(${avgHue},60%,70%,${lineAlpha})`;
              ctx.lineWidth = 0.5;
              ctx.stroke();
            }
          }
        }
        ctx.restore();
      }

      // ── Layer 6: Fast sparks ──
      if (frame % 7 === 0) spawn("spark");
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        if (p.type !== "spark") continue;
        p.life++;
        if (p.life > p.maxLife) { particles.splice(i, 1); continue; }

        p.hue += p.hueShift;
        p.orbit += p.orbitAccel;
        p.angle += p.orbit;
        p.dist += 0.9 + Math.random() * 0.5;
        p.x = cx + Math.cos(p.angle) * p.dist;
        p.y = cy + Math.sin(p.angle) * p.dist;

        const progress = p.life / p.maxLife;
        const alpha = (1 - progress) * 0.9 * (0.7 + hb * 0.3);
        const sparkSize = p.size * (1 - progress * 0.5) * (0.8 + hb * 0.2);

        const sparkSatOff = p.satPulse * Math.sin(t * p.satSpeed + p.pulsePhase * 1.7);
        const sparkLitOff = p.litPulse * Math.sin(t * p.litSpeed + p.pulsePhase * 2.3);
        const sparkSat = 85 + sparkSatOff;
        const sparkLit = 85 + sparkLitOff;

        ctx.save();
        ctx.globalCompositeOperation = "screen";
        ctx.beginPath();
        if (p.squish > 0) {
          const sqSpark = p.squish * Math.sin(t * p.squishSpeed + p.pulsePhase);
          ctx.translate(p.x, p.y);
          ctx.rotate(p.squishAngle);
          ctx.scale(1 + sqSpark, 1 - sqSpark);
          ctx.arc(0, 0, sparkSize, 0, Math.PI * 2);
        } else {
          ctx.arc(p.x, p.y, sparkSize, 0, Math.PI * 2);
        }
        ctx.fillStyle = `hsla(${p.hue},${sparkSat}%,${sparkLit}%,${alpha})`;
        ctx.shadowColor = `hsla(${p.hue},${sparkSat + 5}%,${sparkLit - 15}%,${alpha * 0.6})`;
        ctx.shadowBlur = 8;
        ctx.fill();
        ctx.restore();
      }

      // ── Center core: breathing nucleus with hue cycling ──
      const corePhase = frame * 0.025;
      const breathe = hb;
      const coreHue = 220 + Math.sin(t * 0.6) * 25;     // slowly cycles 195-245
      const coreAlpha = 0.5 + breathe * 0.4;
      const coreSize = 10 + breathe * 6;

      // Outer diffuse glow
      const outerGlow = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreSize * 6);
      outerGlow.addColorStop(0, `hsla(${coreHue},80%,85%,${coreAlpha * 0.2})`);
      outerGlow.addColorStop(0.3, `hsla(${coreHue + 25},70%,65%,${coreAlpha * 0.08})`);
      outerGlow.addColorStop(1, `hsla(${coreHue + 30},60%,50%,0)`);
      ctx.fillStyle = outerGlow;
      ctx.fillRect(cx - coreSize * 6, cy - coreSize * 6, coreSize * 12, coreSize * 12);

      // Mid glow ring
      const midGlow = ctx.createRadialGradient(cx, cy, coreSize * 0.8, cx, cy, coreSize * 3);
      midGlow.addColorStop(0, `hsla(${coreHue + 10},75%,80%,${coreAlpha * 0.3})`);
      midGlow.addColorStop(1, `hsla(${coreHue + 20},60%,60%,0)`);
      ctx.fillStyle = midGlow;
      ctx.beginPath();
      ctx.arc(cx, cy, coreSize * 3, 0, Math.PI * 2);
      ctx.fill();

      // Inner core
      const coreGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreSize);
      coreGrad.addColorStop(0, `hsla(${coreHue - 5},60%,97%,${coreAlpha})`);
      coreGrad.addColorStop(0.35, `hsla(${coreHue + 5},70%,80%,${coreAlpha * 0.7})`);
      coreGrad.addColorStop(1, `hsla(${coreHue + 15},60%,60%,0)`);
      ctx.fillStyle = coreGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, coreSize, 0, Math.PI * 2);
      ctx.fill();

      animId = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(animId);
  }, []);

  return (
    <div className="flex flex-col items-center justify-center py-16 select-none">
      <canvas
        ref={canvasRef}
        className="mb-6"
        style={{ width: 400, height: 400 }}
      />
      <p
        key={msgIndex}
        className="text-[13px] text-gen-text-3 tracking-wide"
        style={{ animation: "scanner-msg 0.4s ease both" }}
      >
        {messages[msgIndex]}
      </p>
    </div>
  );
}
