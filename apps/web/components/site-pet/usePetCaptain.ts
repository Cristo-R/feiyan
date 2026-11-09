import { useCallback, useEffect, useRef, useState } from 'react';
import type { PetCaptain } from './petTypes';

const CAPTAIN_STORAGE_KEY = 'feiyan:pet:captain-id';

export function usePetCaptain(ready: boolean, showBubble: (message: string, duration?: number) => void) {
  const [captains, setCaptains] = useState<PetCaptain[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const greetedRef = useRef(false);
  const askTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(false);
    setSelectedId(readCaptainId());
    void fetch('/api/site/pet-captains', { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('Captain list unavailable');
        return response.json() as Promise<{ data: PetCaptain[] }>;
      })
      .then(body => setCaptains(body.data))
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [reloadKey]);

  const openDialog = useCallback(() => {
    if (askTimerRef.current) window.clearTimeout(askTimerRef.current);
    setDialogOpen(true);
  }, []);

  useEffect(() => {
    if (!ready || loading || greetedRef.current) return;
    greetedRef.current = true;
    const captain = captains.find(item => item.id === selectedId);
    if (error) {
      showBubble('舰长，欢迎来玩！排班暂时没查到，稍后再试试。', 8000);
    } else {
      showBubble(captain ? captainGreeting(captain, true) : '舰长，你是哪一位？选一下，下次我就记得你啦。', 8000);
    }
    if (!captain && (!error || selectedId === null)) {
      askTimerRef.current = window.setTimeout(openDialog, 1400);
    }
  }, [captains, error, loading, openDialog, ready, selectedId, showBubble]);

  useEffect(() => () => {
    if (askTimerRef.current) window.clearTimeout(askTimerRef.current);
  }, []);

  const selectCaptain = useCallback((captain: PetCaptain) => {
    let remembered = true;
    try {
      window.localStorage.setItem(CAPTAIN_STORAGE_KEY, String(captain.id));
    } catch {
      remembered = false;
    }
    setSelectedId(captain.id);
    setDialogOpen(false);
    showBubble(captainGreeting(captain, false)
      + (remembered ? '' : ' 浏览器未能保存身份，下次需要重新选择。'), 10000);
  }, [showBubble]);

  return {
    captains,
    selectedCaptain: captains.find(captain => captain.id === selectedId) ?? null,
    loading,
    error,
    dialogOpen,
    openDialog,
    closeDialog: () => setDialogOpen(false),
    reload: () => setReloadKey(key => key + 1),
    selectCaptain,
  };
}

function readCaptainId(): number | null {
  try {
    const id = Number(window.localStorage.getItem(CAPTAIN_STORAGE_KEY));
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  } catch {
    return null;
  }
}

function captainGreeting(captain: PetCaptain, returning: boolean) {
  const welcome = returning ? `欢迎回来，${captain.name}舰长！` : `${captain.name}舰长，认出你啦！`;
  if (!captain.nextDate) return `${welcome}目前还没有你的排班，有安排了再告诉你。`;
  const [year, month, day] = captain.nextDate.split('-');
  return `${welcome}你最近一次排班在 ${year}年${Number(month)}月${Number(day)}日，记得来哦。`;
}
