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
      showBubble('舰长大人恕罪，排班暂时没查出来，劳烦您稍后再试一下……', 8000);
    } else {
      showBubble(captain ? captainGreeting(captain, true) : '舰长大人，您来啦……恕小的眼拙，能告诉小的该怎么称呼您吗？', 8000);
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
      + (remembered ? '' : ' 小的没能在浏览器里记住您，下次还得劳烦您再选一下……'), 10000);
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
  const welcome = returning ? `${captain.name}舰长大人，您回来啦～` : `${captain.name}舰长大人，小的记住您了～`;
  if (!captain.nextDate) return `${welcome}小的看过了，暂时还没有您的排班。您先歇着，有事尽管吩咐。`;
  const [year, month, day] = captain.nextDate.split('-');
  return `${welcome}小的查过了，${year}年${Number(month)}月${Number(day)}日有您的排班。到时候赏脸来一下呀。`;
}
