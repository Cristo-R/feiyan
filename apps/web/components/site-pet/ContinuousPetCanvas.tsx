'use client';

import { useEffect, useRef } from 'react';
import type { MutableRefObject } from 'react';
import type { PetMood } from './petTypes';
import { createCharacter, loadAssets, REST_GESTURE } from './continuousCharacter.js';
import { createEffects } from './continuousEffects.js';

export type DragVisual = { part: 'head' | 'hand' | 'leg' | 'body'; side?: 'left' | 'right'; dx: number; dy: number; active: boolean } | null;
type Props = { mood: PetMood; actionKey: number; dragVisual?: DragVisual; visible?: boolean; hitTestRef: MutableRefObject<((x: number, y: number) => boolean) | null>; onReady: () => void };
type Pose = { raise: number; close: number; lift: number; energy: number; seat: number; sleeve: number };

type Gesture = typeof REST_GESTURE;

const IDLE: Pose = { raise: 1, close: 1, lift: 1, energy: 1, seat: 1, sleeve: 1 };
const CANVAS_SIZE = 512;
const FRAME_INTERVAL = 1000 / 30;
const ACTION_LENGTH: Record<string, number> = { pat: 4.2, tease: 2.5, scold: 3.6, fall: 2.1, sleep: 5.2, dragHead: 2.4, dragHand: 2.4, dragLeg: 2.4, dragBody: 2.4, talk: 1.5 };

function smooth(a: number, b: number, value: number) {
  const t = Math.max(0, Math.min(1, (value - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
function pulse(start: number, peak: number, end: number, time: number) { return smooth(start, peak, time) * (1 - smooth(peak, end, time)); }
function gesture(): Gesture { return { ...REST_GESTURE, left: [0, 0, 0], right: [0, 0, 0], pivot: [516, 650] }; }

function sample(mood: PetMood, time: number): { pose: Pose; gesture: Gesture } {
  if (mood === 'idle') return { pose: IDLE, gesture: gesture() };
  if (mood.startsWith('drag')) {
    const g = gesture();
    g.relaxed = 1;
    const pose = { ...IDLE, raise: .04, close: .08, energy: .08, lift: .2, seat: .35 };
    if (mood === 'dragHead') {
      g.pivot = [516, 180];
      g.body = Math.sin(time * 5) * .08;
      g.left = [-12, 24, 0];
      g.right = [12, 24, 0];
    }
    if (mood === 'dragHand') {
      g.pivot = [400, 500];
      g.body = .16 + Math.sin(time * 3) * .025;
      g.left = [-60, -280, -2];
    }
    if (mood === 'dragLeg') {
      g.pivot = [516, 520];
      g.body = Math.PI + Math.sin(time * 2.8) * .06;
      g.hair = Math.sin(time * 3.5) * 15;
    }
    if (mood === 'dragBody') {
      g.body = Math.sin(time * 4) * .04;
      g.left = [-22, -34, -.2];
      g.right = [22, -34, .2];
    }
    return { pose, gesture: g };
  }
  const duration = ACTION_LENGTH[mood] ?? 2.5;
  const enter = smooth(0, .55, time);
  const leave = 1 - smooth(Math.max(.8, duration - .75), duration, time);
  const active = enter * leave;
  const reaction = smooth(.35, .9, time) * (1 - smooth(Math.max(1.1, duration - .7), duration, time));
  const pose = { ...IDLE, raise: 1 - active * .96, energy: 1 - active * .92, lift: 1 - active * .8, seat: 1 };
  const g = gesture();
  g.relaxed = active;
  g.hair = Math.sin(time * 4.2) * 5 * reaction;
  if (mood === 'pat') { g.head = -.08 * reaction; g.body = -.025 * reaction; g.y = 4 * reaction; g.smile = reaction; pose.close = 1; }
  if (mood === 'tease') { const flinch = pulse(.4, .85, 1.35, time); g.head = -.14 * reaction - flinch * .04; g.x = -13 * reaction; g.right = [14 * reaction, -260 * reaction, 1.8 * reaction]; g.smile = .3 * reaction; }
  if (mood === 'scold') { const flinch = pulse(.45, .8, 1.4, time); g.head = .06 * reaction; g.squash = -flinch; g.y = 10 * flinch; g.left = [15 * reaction, -300 * reaction, -1.8 * reaction]; }
  if (mood === 'talk') { g.head = Math.sin(time * 7) * .035; g.body = Math.sin(time * 8) * .015; g.smile = .35 * reaction; }
  if (mood === 'sleep') { g.head = .13 * reaction; g.body = .025 * reaction; g.y = 7 * reaction; pose.energy = 1 - active * .8; }
  if (mood === 'fall') { const catchStep = pulse(.25, .7, 1.35, time); pose.seat = 1 - active * .8; g.body = .16 * Math.sin(time * 4) * catchStep; g.y = 20 * catchStep; g.squash = -.55 * catchStep; }
  return { pose, gesture: g };
}

export default function ContinuousPetCanvas({ mood, actionKey, dragVisual = null, visible = true, hitTestRef, onReady }: Props) {
  const backRef = useRef<HTMLCanvasElement>(null);
  const characterRef = useRef<HTMLCanvasElement>(null);
  const frontRef = useRef<HTMLCanvasElement>(null);
  const moodRef = useRef(mood);
  const dragVisualRef = useRef<DragVisual>(dragVisual);
  const rafRef = useRef<number>();
  const visibleRef = useRef(visible);
  const syncRenderingRef = useRef<(() => void) | null>(null);
  const startedRef = useRef(performance.now());
  const previousRef = useRef(performance.now());
  const sleeveRef = useRef(1);
  const sleeveVelocityRef = useRef(0);

  useEffect(() => { moodRef.current = mood; startedRef.current = performance.now(); }, [mood]);
  useEffect(() => { startedRef.current = performance.now(); }, [actionKey]);
  useEffect(() => { dragVisualRef.current = dragVisual; }, [dragVisual]);
  useEffect(() => {
    visibleRef.current = visible;
    syncRenderingRef.current?.();
  }, [visible]);

  useEffect(() => {
    let cancelled = false;
    let dispose = () => {};
    void (async () => {
      const images = await loadAssets();
      if (cancelled || !characterRef.current || !backRef.current || !frontRef.current) return;
      const character = characterRef.current;
      const back = backRef.current;
      const front = frontRef.current;
      const renderer = createCharacter(character, images);
      const effects = createEffects(back.getContext('2d')!, front.getContext('2d')!);
      const gl = character.getContext('webgl')!;
      const pixel = new Uint8Array(4);
      let redraw = () => {};
      hitTestRef.current = (x, y) => {
        redraw();
        gl.readPixels(Math.floor(x * gl.drawingBufferWidth), gl.drawingBufferHeight - 1 - Math.floor(y * gl.drawingBufferHeight), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        return pixel[3] > 28;
      };
      const drawFrame = (now: number) => {
        const elapsed = Math.min((now - previousRef.current) / 1000, .1);
        previousRef.current = now;
        const currentMood = moodRef.current;
        const elapsedAction = (now - startedRef.current) / 1000;
        const activeDrag = dragVisualRef.current;
        const duration = ACTION_LENGTH[currentMood] ?? Infinity;
        const time = currentMood === 'idle' || activeDrag?.active ? now / 1000 : Math.min(duration, elapsedAction * 2);
        const current = sample(currentMood, time);
        if (activeDrag?.active) {
          const dx = Math.max(-60, Math.min(60, activeDrag.dx));
          const dy = Math.max(-40, Math.min(40, activeDrag.dy));
          if (activeDrag.part === 'hand') {
            const right = activeDrag.side === 'right';
            current.gesture.pivot = [right ? 632 : 400, 500];
            current.gesture.body *= right ? -1 : 1;
            current.gesture.left = right ? [0, 0, 0] : [-60 + dx, -280 + dy, -2];
            current.gesture.right = right ? [60 + dx, -280 + dy, 2] : [0, 0, 0];
          } else if (activeDrag.part === 'head') {
            current.gesture.head += Math.max(-.26, Math.min(.26, activeDrag.dx / 260));
            current.gesture.y += dy * .08;
          } else if (activeDrag.part === 'leg') {
            current.gesture.body += Math.max(-.18, Math.min(.18, activeDrag.dx / 760));
            current.gesture.y += dy * .12;
          } else {
            current.gesture.body += Math.max(-.14, Math.min(.14, activeDrag.dx / 900));
          }
        }
        if (activeDrag?.active || currentMood === 'idle') {
          sleeveRef.current = current.pose.raise;
          sleeveVelocityRef.current = 0;
        }
        const count = Math.max(1, Math.ceil(Math.min(elapsed * 2, .04) / .008));
        const step = Math.min(elapsed * 2, .04) / count;
        for (let i = 0; i < count; i++) {
          sleeveVelocityRef.current += ((current.pose.raise - sleeveRef.current) * 160 - sleeveVelocityRef.current * 21) * step;
          sleeveRef.current += sleeveVelocityRef.current * step;
        }
        current.pose.sleeve = sleeveRef.current;
        const effectTime = currentMood === 'idle' ? now / 1000 : elapsedAction * 2;
        effects.draw(current.pose, effectTime, currentMood !== 'talk');
        redraw = () => renderer.draw(current.pose, effectTime, current.gesture);
        redraw();
      };
      let lastFrame = 0;
      const animate = (now: number) => {
        if (now - lastFrame >= FRAME_INTERVAL - 1) {
          lastFrame = now;
          drawFrame(now);
        }
        rafRef.current = requestAnimationFrame(animate);
      };
      const stop = () => {
        if (rafRef.current !== undefined) cancelAnimationFrame(rafRef.current);
        rafRef.current = undefined;
      };
      const syncRendering = () => {
        stop();
        if (!visibleRef.current) return;
        previousRef.current = performance.now();
        lastFrame = 0;
        rafRef.current = requestAnimationFrame(animate);
      };
      syncRenderingRef.current = syncRendering;
      dispose = () => {
        stop();
        renderer.dispose();
        effects.dispose();
        character.width = character.height = 0;
        back.width = back.height = 0;
        front.width = front.height = 0;
      };
      syncRendering();
      onReady();
    })().catch(error => console.error('Continuous pet failed to initialize', error));
    return () => {
      cancelled = true;
      hitTestRef.current = null;
      syncRenderingRef.current = null;
      dispose();
    };
  }, [hitTestRef, onReady]);

  return <span className="site-pet__rig" style={{ visibility: visible ? 'visible' : 'hidden' }} aria-hidden="true">
    <canvas ref={backRef} width={CANVAS_SIZE} height={CANVAS_SIZE} />
    <canvas ref={characterRef} width={CANVAS_SIZE} height={CANVAS_SIZE} />
    <canvas ref={frontRef} width={CANVAS_SIZE} height={CANVAS_SIZE} />
  </span>;
}
