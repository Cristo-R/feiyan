export function createEffects(back, front) {
  const ring = makeRingTexture();
  return {
    draw(state, time, enabled = true) {
      drawEffects(back, false, state, time, ring, enabled);
      drawEffects(front, true, state, time, ring, enabled);
    },
  };
}

function drawEffects(ctx, foreground, state, time, ringTexture, enabled) {
  ctx.clearRect(0, 0, 1024, 1024);
  if (!enabled || state.energy < .001) return;
  const strength = state.energy;
  if (!foreground) {
    ctx.save();
    ctx.globalAlpha = strength * .88;
    ctx.translate(512, 920);
    ctx.scale(1, .2);
    ctx.rotate(time * .16);
    ctx.drawImage(ringTexture, -512, -512);
    ctx.restore();
  }
  for (let stream = 0; stream < 3; stream++) {
    ctx.beginPath();
    let connected = false;
    for (let i = 0; i <= 80; i++) {
      const point = energyPoint(i / 80, time, stream);
      if (point.front !== foreground) { connected = false; continue; }
      if (connected) ctx.lineTo(point.x, point.y);
      else ctx.moveTo(point.x, point.y);
      connected = true;
    }
    ctx.strokeStyle = `rgba(${stream === 1 ? '195,158,245' : '133,219,255'},${strength * .16})`;
    ctx.lineWidth = 6;
    ctx.shadowColor = stream === 1 ? '#c4a1f2' : '#9ee4ff';
    ctx.shadowBlur = 12;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.lineWidth = 1.25;
    ctx.strokeStyle = `rgba(224,245,255,${strength * .55})`;
    ctx.stroke();
  }
  ctx.beginPath();
  for (let i = 0; i < 32; i++) {
    const t = (time * .18 + i * .618034) % 1;
    const point = energyPoint(t, time, i % 3);
    if (point.front !== foreground) continue;
    const radius = (i % 5 === 0 ? 2.1 : 1.1) * Math.sin(t * Math.PI);
    ctx.moveTo(point.x + radius, point.y);
    ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
  }
  ctx.fillStyle = `rgba(223,236,255,${strength * .75})`;
  ctx.shadowColor = '#b6e1ff'; ctx.shadowBlur = 7; ctx.fill();
  ctx.shadowBlur = 0;
  if (foreground) {
    const x = 511, y = 560 + state.seat * 40 - state.lift * 17;
    const pulse = 1 + Math.sin(time * 3) * .12;
    const glow = ctx.createRadialGradient(x, y, 2, x, y, 52 * pulse);
    glow.addColorStop(0, `rgba(245,232,255,${strength * .8})`);
    glow.addColorStop(.25, `rgba(197,163,248,${strength * .35})`);
    glow.addColorStop(1, 'rgba(161,183,255,0)');
    ctx.fillStyle = glow; ctx.fillRect(x - 65, y - 65, 130, 130);
  }
}

function makeRingTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1024;
  const ctx = canvas.getContext('2d');
  ctx.translate(512, 512);
  ctx.strokeStyle = '#edca8e';
  ctx.shadowColor = '#f0be70';
  ctx.shadowBlur = 14;
  ctx.beginPath();
  for (const radius of [218, 229, 277, 291, 354, 365, 395, 405]) {
    ctx.moveTo(radius, 0); ctx.arc(0, 0, radius, 0, Math.PI * 2);
  }
  ctx.lineWidth = 1.7; ctx.stroke(); ctx.stroke();
  ctx.beginPath();
  for (let i = 0; i < 36; i++) {
    ctx.save(); ctx.rotate(i * Math.PI / 18);
    ctx.moveTo(300, -5); ctx.lineTo(315, -5); ctx.lineTo(315, -18);
    ctx.moveTo(305, 8); ctx.lineTo(335, 8); ctx.lineTo(335, -6);
    if (i % 3 === 0) { ctx.moveTo(327, -22); ctx.lineTo(348, 0); ctx.lineTo(327, 22); }
    ctx.moveTo(370, 0); ctx.lineTo(i % 3 ? 382 : 397, 0);
    ctx.restore();
  }
  ctx.lineWidth = 1.6; ctx.stroke();
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    for (let j = 0; j <= 6; j++) {
      const angle = j * Math.PI / 3 + i * .07;
      const x = Math.cos(angle) * (130 + i * 9), y = Math.sin(angle) * (130 + i * 9);
      if (j === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
  }
  ctx.lineWidth = .9; ctx.stroke();
  return canvas;
}

function energyPoint(t, time, stream) {
  const angle = t * 8.5 + time * .55 + stream * Math.PI * 2 / 3;
  const radius = 340 * Math.pow(1 - t, .75) + 6;
  return { x: 512 + Math.cos(angle) * radius, y: 916 - t * 335 + Math.sin(angle) * 24 * (1 - t), front: Math.sin(angle) > 0 };
}
