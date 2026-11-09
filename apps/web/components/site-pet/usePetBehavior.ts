import { useCallback, useRef } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { PetBehavior, PetMood } from './petTypes';

type DragGuard = {
  moved: boolean;
};

type UsePetBehaviorOptions = {
  liveActive: boolean;
  dragRef: MutableRefObject<DragGuard | null>;
  hideTimerRef: MutableRefObject<number | null>;
  bubbleTimerRef: MutableRefObject<number | null>;
  setMood: Dispatch<SetStateAction<PetMood>>;
  setMessage: Dispatch<SetStateAction<string>>;
  setBubbleVisible: Dispatch<SetStateAction<boolean>>;
  setMenuOpen: Dispatch<SetStateAction<boolean>>;
  setActionKey: Dispatch<SetStateAction<number>>;
};

const PET_BEHAVIOR_PRIORITY: Record<PetBehavior, number> = {
  idle: 0,
  live: 10,
  sleep: 20,
  action: 40,
  fall: 55,
  glitch: 65,
  drag: 90,
};

export function usePetBehavior({
  liveActive,
  dragRef,
  hideTimerRef,
  bubbleTimerRef,
  setMood,
  setMessage,
  setBubbleVisible,
  setMenuOpen,
  setActionKey,
}: UsePetBehaviorOptions) {
  const behaviorRef = useRef<PetBehavior>('idle');

  const setPetBehavior = useCallback((
    nextBehavior: PetBehavior,
    nextMood: PetMood,
    options: { message?: string; bubble?: boolean; bumpAction?: boolean; force?: boolean } = {},
  ) => {
    const currentBehavior = behaviorRef.current;
    if (!options.force && PET_BEHAVIOR_PRIORITY[nextBehavior] < PET_BEHAVIOR_PRIORITY[currentBehavior]) return false;
    behaviorRef.current = nextBehavior;
    setMood(nextMood);
    if (options.message !== undefined) setMessage(options.message);
    if (options.bubble !== undefined) setBubbleVisible(options.bubble);
    if (options.bumpAction) setActionKey(k => k + 1);
    return true;
  }, [setActionKey, setBubbleVisible, setMessage, setMood]);

  const returnToBaseBehavior = useCallback((force = false) => {
    if (!force && dragRef.current?.moved) return;
    const baseBehavior: PetBehavior = liveActive ? 'live' : 'idle';
    behaviorRef.current = baseBehavior;
    setMood(liveActive ? 'live' : 'idle');
    setMenuOpen(false);
  }, [dragRef, liveActive, setMenuOpen, setMood]);

  const showBubble = useCallback((nextMessage: string, duration = 3200) => {
    if (bubbleTimerRef.current) window.clearTimeout(bubbleTimerRef.current);
    setMessage(nextMessage);
    setBubbleVisible(true);
    bubbleTimerRef.current = window.setTimeout(() => setBubbleVisible(false), duration);
  }, [bubbleTimerRef, setBubbleVisible, setMessage]);

  const say = useCallback((
    nextMood: PetMood,
    nextMessage: string,
    duration = 3600,
    behavior: PetBehavior = 'action',
    force = false,
  ) => {
    if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    if (!setPetBehavior(behavior, nextMood, {
      bumpAction: true,
      force: force || behavior === 'fall' || behavior === 'glitch',
    })) return;
    showBubble(nextMessage);
    hideTimerRef.current = window.setTimeout(() => {
      if (behaviorRef.current !== behavior) return;
      returnToBaseBehavior();
    }, duration);
  }, [hideTimerRef, returnToBaseBehavior, setPetBehavior, showBubble]);

  return {
    behaviorRef,
    setPetBehavior,
    returnToBaseBehavior,
    say,
    showBubble,
  };
}

