import type { DragPart, IdleVariant, PetActionDef, PetFrame, PetMood } from './petTypes';
import { petAssetUrl } from './petAssets';

export const PET_SHEET_SRC = petAssetUrl('pet-assets/feiyan-pet-spritesheet.webp');
export const PET_IDLE_SRC = petAssetUrl('pet-assets/kling-idle/idle-kling-fullbody-60-256.webp');
export const PET_LIVE_SRC = petAssetUrl('pet-assets/live-status/live-delta-playing-60-384x216-30x2.webp');
export const PET_SHEET_W = 1536;
export const PET_SHEET_H = 1024;
export const PET_SHEET_COLS = 3;
export const PET_SHEET_ROWS = 2;

const IDLE_ACTION_FRAMES = 60;
const LIVE_ACTION_FRAMES = 60;
const LIVE_ACTION_COLS = 30;
const TEASE_ACTION_FRAMES = 20;

export const PET_INTERACTION_ASSETS = [
  PET_SHEET_SRC,
  petAssetUrl('pet-assets/drag-generated/drag-hang-poses-4.webp'),
  petAssetUrl('pet-assets/kling-pat/pat-kling-47-256.webp'),
  petAssetUrl('pet-assets/tease-generated/tease-poke-chin-20-512.webp'),
  petAssetUrl('pet-assets/fall-generated/fall-rise-8-512.webp'),
];

function frameRange(length: number, mapFrame: (index: number) => PetFrame = col => ({ col, row: 0 })) {
  return Array.from({ length }, (_, index) => mapFrame(index));
}

export const moodFrames: Record<PetMood, PetFrame> = {
  idle: { col: 0, row: 0 },
  talk: { col: 1, row: 0 },
  pat: { col: 2, row: 0 },
  tease: { col: 0, row: 1 },
  scold: { col: 1, row: 1 },
  dragHead: { col: 0, row: 0 },
  dragHand: { col: 1, row: 0 },
  dragLeg: { col: 2, row: 0 },
  dragBody: { col: 3, row: 0 },
  fall: { col: 0, row: 0 },
  sleep: { col: 2, row: 1 },
  live: { col: 1, row: 0 },
  glitch: { col: 1, row: 1 },
};

export const petActions: Record<PetMood, PetActionDef> = {
  idle: {
    src: PET_IDLE_SRC,
    cols: IDLE_ACTION_FRAMES,
    rows: 1,
    fps: 12,
    frames: frameRange(IDLE_ACTION_FRAMES),
  },
  talk: {
    src: PET_IDLE_SRC,
    cols: IDLE_ACTION_FRAMES,
    rows: 1,
    fps: 24,
    loop: false,
    frames: frameRange(25, index => ({ col: index + 18, row: 0 })),
  },
  pat: {
    src: petAssetUrl('pet-assets/kling-pat/pat-kling-47-256.webp'),
    cols: 47,
    rows: 1,
    fps: 12,
    loop: false,
    frames: frameRange(47),
  },
  tease: {
    src: petAssetUrl('pet-assets/tease-generated/tease-poke-chin-20-512.webp'),
    cols: TEASE_ACTION_FRAMES,
    rows: 1,
    fps: 13,
    loop: false,
    frames: frameRange(TEASE_ACTION_FRAMES),
  },
  scold: {
    fps: 10,
    frames: [moodFrames.idle, moodFrames.scold, moodFrames.tease, moodFrames.scold, moodFrames.talk, moodFrames.idle],
  },
  dragHead: {
    src: petAssetUrl('pet-assets/drag-generated/drag-hang-poses-4.webp'),
    cols: 4,
    rows: 1,
    fps: 1,
    loop: false,
    frames: [moodFrames.dragHead],
  },
  dragHand: {
    src: petAssetUrl('pet-assets/drag-generated/drag-hang-poses-4.webp'),
    cols: 4,
    rows: 1,
    fps: 1,
    loop: false,
    frames: [moodFrames.dragHand],
  },
  dragLeg: {
    src: petAssetUrl('pet-assets/drag-generated/drag-hang-poses-4.webp'),
    cols: 4,
    rows: 1,
    fps: 1,
    loop: false,
    frames: [moodFrames.dragLeg],
  },
  dragBody: {
    src: petAssetUrl('pet-assets/drag-generated/drag-hang-poses-4.webp'),
    cols: 4,
    rows: 1,
    fps: 1,
    loop: false,
    frames: [moodFrames.dragBody],
  },
  fall: {
    src: petAssetUrl('pet-assets/fall-generated/fall-rise-8-512.webp'),
    cols: 8,
    rows: 1,
    fps: 8,
    loop: false,
    frames: [
      { col: 0, row: 0 },
      { col: 0, row: 0 },
      { col: 1, row: 0 },
      { col: 2, row: 0 },
      { col: 3, row: 0 },
      { col: 4, row: 0 },
      { col: 5, row: 0 },
      { col: 6, row: 0 },
      { col: 7, row: 0 },
    ],
  },
  sleep: {
    fps: 1,
    loop: false,
    frames: [moodFrames.sleep],
  },
  live: {
    src: PET_LIVE_SRC,
    cols: LIVE_ACTION_COLS,
    rows: 2,
    fps: 12,
    aspectRatio: '16 / 9',
    frames: frameRange(LIVE_ACTION_FRAMES, index => ({ col: index % LIVE_ACTION_COLS, row: Math.floor(index / LIVE_ACTION_COLS) })),
  },
  glitch: {
    fps: 13,
    frames: [moodFrames.scold, moodFrames.tease, moodFrames.talk, moodFrames.scold],
  },
};

export const idleActions: Record<IdleVariant, PetActionDef> = {
  look: petActions.idle,
  sleepy: {
    src: PET_IDLE_SRC,
    cols: IDLE_ACTION_FRAMES,
    rows: 1,
    fps: 12,
    frames: frameRange(IDLE_ACTION_FRAMES),
  },
};

export const dragMoodByPart: Record<DragPart, PetMood> = {
  head: 'dragHead',
  hand: 'dragHand',
  leg: 'dragLeg',
  body: 'dragBody',
};
