const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const INNER_RADIUS = 0.075;
const OUTER_RADIUS = 0.5;
const RADIAL_SPAN = OUTER_RADIUS - INNER_RADIUS;
const PARTICLE_COLORS = [
  [154, 248, 184], // mint
  [111, 232, 221], // aqua
  [115, 198, 255], // sky
  [165, 157, 255], // soft violet
  [207, 177, 255], // lilac
  [173, 250, 215], // pale jade
];
const PHASE_COLOR_OFFSET = { inhale: 0, hold: 0.8, exhale: 1.65, rest: 0.45, ambient: 0.45 };
const FRAME_INTERVAL = 1000 / 60; // Aim for at most one paint per 60 Hz frame.
const smoothStep = (edge0, edge1, value) => {
  const delta = edge1 - edge0;
  const t = clamp((value - edge0) / (Math.abs(delta) < 0.000001 ? 0.000001 : delta), 0, 1);
  return t * t * (3 - 2 * t);
};
const phaseFlowDirection = phase => phase === 'inhale' ? -1 : phase === 'exhale' ? 1 : 0;
const phaseColorTarget = phase => PHASE_COLOR_OFFSET[phase] ?? PHASE_COLOR_OFFSET.rest;
function circularColorDelta(from, to) {
  const count = PARTICLE_COLORS.length;
  let delta = (to - from) % count;
  if (delta > count / 2) delta -= count;
  if (delta < -count / 2) delta += count;
  return delta;
}

/** Smooth color drift for particles; returns an RGB triplet for Canvas rgba(). */
export function getParticleColor(elapsedSeconds, colorOffset = 0, phase = 'rest') {
  const offset = PHASE_COLOR_OFFSET[phase] ?? PHASE_COLOR_OFFSET.rest;
  const position = (((Math.max(0, Number(elapsedSeconds) || 0) / 6.5) + colorOffset + offset) % PARTICLE_COLORS.length + PARTICLE_COLORS.length) % PARTICLE_COLORS.length;
  const index = Math.floor(position);
  const next = (index + 1) % PARTICLE_COLORS.length;
  const fraction = position - index;
  const blend = fraction * fraction * (3 - 2 * fraction);
  return PARTICLE_COLORS[index].map((component, channel) => Math.round(component + (PARTICLE_COLORS[next][channel] - component) * blend)).join(',');
}

/** Pure radial movement helper. Canvas particle radii use normalized coordinates. */
export function advanceParticleRadius(radius, phase, normalizedSpeed, dt) {
  const distance = Math.max(0, normalizedSpeed) * Math.max(0, dt);
  if (phase === 'inhale') return Math.max(INNER_RADIUS, radius - distance);
  if (phase === 'exhale') return Math.min(OUTER_RADIUS, radius + distance);
  return clamp(radius, INNER_RADIUS, OUTER_RADIUS);
}

/**
 * Animated canvas scene for the breathing sphere.
 * On inhale, glowing motes stream from the outer halo toward the core.
 * On exhale, the same particles fan outward; during a pause they collect at
 * the boundary and shimmer. No external libraries or image assets are used.
 */
export function createBreathVisual(canvas, { ambient = false } = {}) {
  const ctx = canvas?.getContext?.('2d', { alpha: true });
  if (!canvas || !ctx) return { setPhase() {}, destroy() {} };

  const motionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const reducedMotion = () => !!motionQuery?.matches;
  let destroyed = false;
  let manuallyPaused = false;
  let raf = 0;
  let width = 1;
  let height = 1;
  let dpr = 1;
  let lastFrame = 0;
  let outerGlowGradients = Object.create(null);
  let coreGlowGradients = Object.create(null);
  let elapsed = 0;
  let phase = canvas.dataset.phase || (ambient ? 'ambient' : 'rest');
  let phaseDuration = Math.max(1, Number(canvas.dataset.phaseDuration) || 4);
  let flowDirection = phaseFlowDirection(phase);
  let flowDirectionTarget = flowDirection;
  let phaseColorShift = phaseColorTarget(phase);
  let phaseColorTargetShift = phaseColorShift;
  const count = Math.min(132, Math.max(64, Math.round((canvas.clientWidth || 280) * (ambient ? 0.27 : 0.36)))); 
  const particles = Array.from({ length: count }, (_, index) => {
    const angle = Math.random() * Math.PI * 2;
    const radius = INNER_RADIUS + Math.random() * RADIAL_SPAN;
    return {
      index,
      angle,
      radius,
      idleAnchorRadius: radius,
      lastMode: phase,
      previousAngle: angle,
      previousRadius: radius,
      speed: 0.62 + Math.random() * 0.78,
      size: index % 13 === 0 ? 1.4 + Math.random() * 1.1 : 0.45 + Math.random() * 0.85,
      alpha: 0.24 + Math.random() * 0.59,
      spin: (Math.random() - 0.5) * 0.3,
      twinkle: Math.random() * Math.PI * 2,
      colorOffset: Math.random() * 1.3 + (index / count) * 0.75,
      glowIndex: index % PARTICLE_COLORS.length,
      depth: 0.68 + Math.random() * 0.55,
      seed: Math.random() * Math.PI * 2,
      wander: 0.35 + Math.random() * 1.15,
      flowRate: 0.72 + Math.random() * 0.58,
      respawnFade: 0,
    };
  });

  // Build tiny glow sprites once. Repeated per-particle shadowBlur is expensive
  // on mobile GPUs; cached gradients give particles a soft halo at a fraction
  // of the cost. If offscreen canvas is unavailable, use crisp dots as fallback.
  const glowSprites = [];
  if (typeof document.createElement === 'function' && typeof ctx.drawImage === 'function') {
    for (const [r, g, b] of PARTICLE_COLORS) {
      const spriteCanvas = document.createElement('canvas');
      spriteCanvas.width = 48; spriteCanvas.height = 48;
      const spriteContext = spriteCanvas.getContext?.('2d');
      if (!spriteContext) { glowSprites.push(null); continue; }
      const gradient = spriteContext.createRadialGradient(24, 24, 0, 24, 24, 24);
      gradient.addColorStop(0, `rgba(${r},${g},${b},.62)`);
      gradient.addColorStop(.22, `rgba(${r},${g},${b},.30)`);
      gradient.addColorStop(.62, `rgba(${r},${g},${b},.08)`);
      gradient.addColorStop(1, `rgba(${r},${g},${b},0)`);
      spriteContext.fillStyle = gradient;
      spriteContext.fillRect(0, 0, 48, 48);
      glowSprites.push(spriteCanvas);
    }
  }

  function motionState() {
    if (!ambient || phase !== 'ambient') return { phase, duration: phaseDuration };
    const cycle = elapsed % 10.5;
    if (cycle < 4.2) return { phase: 'inhale', duration: 4.2 };
    if (cycle < 4.8) return { phase: 'hold', duration: 0.6 };
    return { phase: 'exhale', duration: 5.7 };
  }

  // Gradients depend only on the canvas geometry and phase, so build them once
  // per resize instead of allocating two CanvasGradient objects on every frame.
  function rebuildGradients() {
    const cx = width / 2;
    const cy = height / 2;
    const radius = Math.min(width, height) * 0.47;
    const states = {
      inhale: { energy: 1, outer: 'rgba(178,255,145,.21)', core: ['rgba(144,255,211,.30)', 'rgba(69,220,181,.13)'], coreRadius: 0.61 },
      exhale: { energy: 0.88, outer: 'rgba(125,255,174,.12)', core: ['rgba(113,236,255,.28)', 'rgba(83,160,242,.12)'], coreRadius: 0.54 },
      hold: { energy: 0.58, outer: 'rgba(117,246,158,.065)', core: ['rgba(193,170,255,.24)', 'rgba(99,124,236,.10)'], coreRadius: 0.54 },
      rest: { energy: 0.34, outer: 'rgba(117,246,158,.065)', core: ['rgba(157,255,205,.19)', 'rgba(57,202,160,.07)'], coreRadius: 0.54 },
    };
    outerGlowGradients = Object.create(null);
    coreGlowGradients = Object.create(null);
    for (const [key, config] of Object.entries(states)) {
      const outer = ctx.createRadialGradient(cx, cy, radius * 0.025, cx, cy, radius * 0.98);
      outer.addColorStop(0, config.outer);
      outer.addColorStop(0.28, `rgba(57,214,139,${0.09 * config.energy})`);
      outer.addColorStop(0.67, 'rgba(26,151,93,.025)');
      outer.addColorStop(1, 'rgba(17,70,51,0)');
      outerGlowGradients[key] = outer;

      const core = ctx.createRadialGradient(cx - radius * 0.12, cy - radius * 0.16, radius * 0.015, cx, cy, radius * config.coreRadius);
      core.addColorStop(0, config.core[0]);
      core.addColorStop(0.42, config.core[1]);
      core.addColorStop(1, 'rgba(19,100,83,0)');
      coreGlowGradients[key] = core;
    }
  }

  function resize() {
    if (destroyed) return;
    const rect = canvas.getBoundingClientRect();
    width = Math.max(1, rect.width || canvas.clientWidth || 280);
    height = Math.max(1, rect.height || canvas.clientHeight || 280);
    // A 1.5 DPR cap keeps the orb crisp on mobile while substantially reducing
    // the pixel workload versus rendering a full 2x/3x Retina bitmap.
    dpr = Math.min(1.5, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    rebuildGradients();
    draw(0, true);
  }

  function drawFilaments(cx, cy, radius, motion, staticFrame) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.globalCompositeOperation = 'lighter';
    const glowAlpha = staticFrame ? 0.045 : (motion === 'inhale' ? 0.11 : motion === 'exhale' ? 0.085 : 0.055);
    for (let filament = 0; filament < 7; filament++) {
      const direction = filament % 2 ? -1 : 1;
      const angle = elapsed * (0.032 + filament * 0.004) * direction + filament * 0.897;
      const orbit = radius * (0.19 + (filament % 4) * 0.085);
      const flatten = 0.48 + (filament % 3) * 0.13;
      ctx.beginPath();
      ctx.ellipse(0, 0, orbit * (1.2 + Math.sin(elapsed * 0.21 + filament) * 0.045), orbit * flatten, angle, 0.14 + filament * 0.04, Math.PI * (1.2 + filament * 0.025));
      ctx.strokeStyle = filament % 2
        ? `rgba(117,242,173,${glowAlpha * 0.85})`
        : `rgba(203,255,163,${glowAlpha})`;
      ctx.lineWidth = filament === 0 ? 1.15 : 0.55;
      ctx.shadowColor = 'rgba(143,255,179,.38)';
      ctx.shadowBlur = 0;
      ctx.stroke();
    }

    // Thin vortex strands subtly curve toward the center on inhale, outward on exhale.
    if (!staticFrame && (motion === 'inhale' || motion === 'exhale')) {
      const inbound = motion === 'inhale';
      const start = inbound ? radius * 0.49 : radius * 0.12;
      const end = inbound ? radius * 0.11 : radius * 0.49;
      for (let strand = 0; strand < 5; strand++) {
        const a = elapsed * (inbound ? 0.055 : -0.045) + strand * (Math.PI * 2 / 5);
        const midRadius = (start + end) * 0.54;
        const x1 = Math.cos(a) * start;
        const y1 = Math.sin(a) * start;
        const x2 = Math.cos(a + (inbound ? 0.42 : -0.36)) * end;
        const y2 = Math.sin(a + (inbound ? 0.42 : -0.36)) * end;
        const cx2 = Math.cos(a + (inbound ? 0.75 : -0.66)) * midRadius;
        const cy2 = Math.sin(a + (inbound ? 0.75 : -0.66)) * midRadius;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.quadraticCurveTo(cx2, cy2, x2, y2);
        ctx.strokeStyle = inbound ? 'rgba(200,255,162,.12)' : 'rgba(141,255,194,.14)';
        ctx.lineWidth = 0.7;
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function draw(dt, staticFrame = false) {
    if (destroyed) return;
    ctx.clearRect(0, 0, width, height);
    const cx = width / 2;
    const cy = height / 2;
    const radius = Math.min(width, height) * 0.47;
    const state = motionState();
    const motion = reducedMotion() || staticFrame ? 'rest' : state.phase;
    const phaseLength = Math.max(0.8, state.duration || phaseDuration);
    const radialSpeed = RADIAL_SPAN / phaseLength;
    flowDirectionTarget = reducedMotion() || staticFrame ? 0 : phaseFlowDirection(motion);
    phaseColorTargetShift = phaseColorTarget(motion);
    if (!staticFrame && dt > 0) {
      const flowEase = 1 - Math.exp(-dt * 3.8);
      flowDirection += (flowDirectionTarget - flowDirection) * flowEase;
      const colorDelta = circularColorDelta(phaseColorShift, phaseColorTargetShift);
      phaseColorShift = (phaseColorShift + colorDelta * (1 - Math.exp(-dt * 1.35)) + PARTICLE_COLORS.length) % PARTICLE_COLORS.length;
    }
    const energy = motion === 'inhale' ? 1 : motion === 'exhale' ? 0.88 : motion === 'hold' ? 0.58 : 0.34;

    // Cached phase-tinted gradients avoid allocating new gradient objects per frame.
    const gradientKey = motion === 'inhale' || motion === 'exhale' || motion === 'hold' ? motion : 'rest';
    const glow = outerGlowGradients[gradientKey];
    const coreGlow = coreGlowGradients[gradientKey];
    if (glow) {
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, width, height);
    }
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = coreGlow;
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.65, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Three breathing ripples gently expand/contract around the core.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let ring = 0; ring < 5; ring++) {
      const wave = reducedMotion() ? 0 : Math.sin(elapsed * (0.72 + ring * 0.11) - ring * 1.4) * 0.014;
      const breathScale = motion === 'inhale' ? 0.012 : motion === 'exhale' ? -0.008 : 0;
      const ringRadius = radius * (0.095 + ring * 0.052 + wave + breathScale);
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(1, ringRadius), 0, Math.PI * 2);
      const ringColor = ring % 2 ? '178,230,255' : '178,255,207';
      ctx.strokeStyle = `rgba(${ringColor},${(0.16 - ring * 0.022) * energy})`;
      ctx.lineWidth = ring === 0 ? 1.3 : 0.65;
      ctx.shadowColor = motion === 'hold' ? 'rgba(172,160,255,.55)' : 'rgba(141,255,204,.58)';
      ctx.shadowBlur = 0;
      ctx.stroke();
    }
    ctx.restore();

    drawFilaments(cx, cy, radius, motion, staticFrame || reducedMotion());
    ctx.globalCompositeOperation = 'lighter';
    for (const particle of particles) {
      if (!staticFrame && !reducedMotion() && dt > 0) {
        particle.previousRadius = particle.radius;
        particle.previousAngle = particle.angle;
        const turbulence = Math.sin(elapsed * (0.37 + particle.wander * 0.19) + particle.seed);
        const counterFlow = Math.cos(elapsed * 0.23 + particle.seed * 1.7);
        particle.angle += (particle.spin + turbulence * 0.055 * particle.wander + counterFlow * 0.018 + flowDirection * 0.045) * dt;
        const speed = radialSpeed * particle.speed;
        const microDrift = Math.sin(elapsed * 0.65 + particle.seed) * 0.006 * dt;
        if (motion === 'inhale' || motion === 'exhale') {
          particle.radius += speed * dt * flowDirection * particle.flowRate + microDrift;
          particle.lastMode = motion;
        } else {
          // Keep idle/hold motes drifting around a stable anchor instead of
          // accumulating a tiny radial delta forever and clumping at an edge.
          if (particle.lastMode === 'inhale' || particle.lastMode === 'exhale' || particle.lastMode !== motion) {
            particle.idleAnchorRadius = particle.radius;
          }
          particle.lastMode = motion;
          particle.radius = particle.idleAnchorRadius
            + Math.sin(elapsed * (0.42 + particle.wander * 0.08) + particle.seed) * 0.009
            + Math.cos(elapsed * 0.27 + particle.seed * 1.6) * 0.004;
        }
        particle.radius = clamp(particle.radius, INNER_RADIUS, OUTER_RADIUS);
        // Respawn at the opposite edge after arrival. The short fade and reset
        // of the previous position avoid drawing a distracting line across the orb.
        if (motion === 'inhale' && particle.radius <= INNER_RADIUS + 0.002 && flowDirection < -0.25) {
          particle.radius = OUTER_RADIUS - Math.random() * 0.055;
          particle.angle += (Math.random() - 0.5) * 0.62;
          particle.respawnFade = 1;
          particle.previousRadius = particle.radius;
          particle.previousAngle = particle.angle;
        } else if (motion === 'exhale' && particle.radius >= OUTER_RADIUS - 0.002 && flowDirection > 0.25) {
          particle.radius = INNER_RADIUS + Math.random() * 0.055;
          particle.angle += (Math.random() - 0.5) * 0.62;
          particle.respawnFade = 1;
          particle.previousRadius = particle.radius;
          particle.previousAngle = particle.angle;
        }
        particle.respawnFade = Math.max(0, particle.respawnFade - dt * 2.6);
      }

      const x = cx + Math.cos(particle.angle) * radius * particle.radius;
      const y = cy + Math.sin(particle.angle) * radius * particle.radius;
      const px = cx + Math.cos(particle.previousAngle) * radius * particle.previousRadius;
      const py = cy + Math.sin(particle.previousAngle) * radius * particle.previousRadius;
      const shimmer = reducedMotion() ? 0.82 : 0.58 + (Math.sin(elapsed * 1.45 + particle.twinkle) + 1) * 0.21;
      const edgeFade = motion === 'inhale'
        ? smoothStep(INNER_RADIUS, INNER_RADIUS + 0.065, particle.radius)
        : motion === 'exhale'
          ? smoothStep(OUTER_RADIUS, OUTER_RADIUS - 0.075, particle.radius)
          : 1;
      const alpha = clamp(particle.alpha * shimmer * particle.depth * edgeFade * (1 - particle.respawnFade), 0, 0.96);
      const particleRgb = getParticleColor(elapsed, particle.colorOffset + phaseColorShift - PHASE_COLOR_OFFSET.rest, 'rest');
      const radialTravel = Math.abs(particle.radius - particle.previousRadius);

      if (!staticFrame && !reducedMotion() && particle.index % 2 === 0 && radialTravel > 0.00005 && (motion === 'inhale' || motion === 'exhale')) {
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(x, y);
        ctx.strokeStyle = `rgba(${particleRgb},${alpha * 0.62})`;
        ctx.lineWidth = Math.min(1.65, particle.size * (0.8 + radialTravel * 28));
        ctx.stroke();
      }

      const glowSprite = glowSprites[particle.glowIndex];
      if (!staticFrame && !reducedMotion() && glowSprite && particle.index % 3 === 0 && typeof ctx.drawImage === 'function') {
        const glowSize = particle.size * (6.0 + energy * 1.25);
        ctx.globalAlpha = alpha * 0.72;
        ctx.drawImage(glowSprite, x - glowSize / 2, y - glowSize / 2, glowSize, glowSize);
        ctx.globalAlpha = 1;
      }
      ctx.beginPath();
      ctx.fillStyle = `rgba(${particleRgb},${alpha})`;
      ctx.arc(x, y, particle.size, 0, Math.PI * 2);
      ctx.fill();
      if (staticFrame) {
        particle.previousRadius = particle.radius;
        particle.previousAngle = particle.angle;
      }
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  function loop(timestamp) {
    if (destroyed || document.hidden || reducedMotion() || manuallyPaused) { raf = 0; return; }
    raf = requestAnimationFrame(loop);
    if (timestamp - lastFrame < FRAME_INTERVAL) return;
    const dt = clamp((timestamp - (lastFrame || timestamp)) / 1000, 0, 1 / 30);
    lastFrame = timestamp;
    elapsed += dt;
    draw(dt);
  }

  function setPhase(nextPhase, duration) {
    phase = ['ambient', 'rest', 'inhale', 'exhale', 'hold'].includes(nextPhase) ? nextPhase : 'rest';
    canvas.dataset.phase = phase;
    phaseDuration = clamp(Number(duration) || 4, 0.8, 12);
    flowDirectionTarget = phaseFlowDirection(phase);
    phaseColorTargetShift = phaseColorTarget(phase);
    if (reducedMotion()) draw(0, true);
  }

  function onVisibility() {
    if (document.hidden) {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      lastFrame = 0;
      return;
    }
    if (!raf && !reducedMotion() && !manuallyPaused) raf = requestAnimationFrame(loop);
  }
  function onMotionChange() {
    if (reducedMotion()) {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      draw(0, true);
    } else if (!raf && !document.hidden && !manuallyPaused) {
      lastFrame = 0;
      raf = requestAnimationFrame(loop);
    }
  }

  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
  observer?.observe(canvas);
  window.addEventListener('resize', resize, { passive: true });
  document.addEventListener('visibilitychange', onVisibility);
  motionQuery?.addEventListener?.('change', onMotionChange);
  resize();
  if (!reducedMotion() && !document.hidden) raf = requestAnimationFrame(loop);

  return {
    setPhase,
    pause() {
      manuallyPaused = true;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      lastFrame = 0;
    },
    resume() {
      manuallyPaused = false;
      if (!raf && !document.hidden && !reducedMotion() && !destroyed) {
        lastFrame = 0;
        raf = requestAnimationFrame(loop);
      }
    },
    destroy() {
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      observer?.disconnect();
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVisibility);
      motionQuery?.removeEventListener?.('change', onMotionChange);
      ctx.clearRect(0, 0, width, height);
    },
  };
}
