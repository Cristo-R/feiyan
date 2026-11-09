export type DragPart = 'head' | 'hand' | 'leg' | 'body';

export type PetMood =
  | 'idle'
  | 'talk'
  | 'pat'
  | 'tease'
  | 'scold'
  | 'dragHead'
  | 'dragHand'
  | 'dragLeg'
  | 'dragBody'
  | 'fall'
  | 'sleep'
  | 'live'
  | 'glitch';

export type PetBehavior = 'idle' | 'live' | 'sleep' | 'action' | 'fall' | 'drag' | 'glitch';

export type PetFrame = {
  col: number;
  row: number;
};

export type PetActionDef = {
  frames: PetFrame[];
  fps: number;
  src?: string;
  cols?: number;
  rows?: number;
  loop?: boolean;
  aspectRatio?: string;
};

export type IdleVariant = 'look' | 'sleepy';

export type PetCaptain = {
  id: number;
  name: string;
  nextDate: string | null;
};

