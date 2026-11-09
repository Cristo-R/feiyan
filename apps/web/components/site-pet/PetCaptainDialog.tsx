import { useEffect, useRef, useState } from 'react';
import type { PetCaptain } from './petTypes';

type Props = {
  captains: PetCaptain[];
  selectedId: number | null;
  loading: boolean;
  error: boolean;
  onSelect: (captain: PetCaptain) => void;
  onClose: () => void;
  onRetry: () => void;
};

export default function PetCaptainDialog({ captains, selectedId, loading, error, onSelect, onClose, onRetry }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState('');
  const filtered = captains.filter(captain => captain.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));

  useEffect(() => {
    const dialog = dialogRef.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="pet-captain-title"
      aria-describedby="pet-captain-description"
      onCancel={onClose}
      className="pointer-events-auto m-auto max-h-[80dvh] w-[min(92vw,420px)] rounded-2xl border border-gray-200 bg-white p-5 text-[#333] shadow-2xl backdrop:bg-black/45"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 id="pet-captain-title" className="text-lg font-semibold">你是哪位舰长？</h2>
        <button type="button" aria-label="关闭舰长选择" onClick={onClose} className="rounded-lg px-2 py-1 text-xl text-gray-500 hover:bg-gray-100">×</button>
      </div>
      <p id="pet-captain-description" className="mt-2 text-sm leading-relaxed text-gray-500">选一下，下次见面就能叫出你的名字，也帮你看看排班。仅记在当前浏览器，随时可以切换。</p>
      <label htmlFor="pet-captain-search" className="sr-only">搜索舰长名称</label>
      <input
        id="pet-captain-search"
        type="search"
        value={query}
        onChange={event => setQuery(event.target.value)}
        placeholder="搜索舰长名称"
        className="mt-4 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm outline-none focus:border-[#E8B84B] focus:ring-2 focus:ring-[#E8B84B]/20"
      />
      <div className="mt-3 max-h-[42dvh] space-y-1 overflow-y-auto" aria-busy={loading}>
        {loading ? (
          <p role="status" className="py-8 text-center text-sm text-gray-500">正在找舰长们……</p>
        ) : error ? (
          <div role="alert" className="py-6 text-center text-sm text-gray-500">
            <p>舰长列表暂时没加载出来。</p>
            <button type="button" onClick={onRetry} className="mt-3 rounded-lg bg-[#0A0E14] px-4 py-2 text-[#E8B84B]">再试一次</button>
          </div>
        ) : filtered.length ? filtered.map(captain => (
          <button
            key={captain.id}
            type="button"
            aria-pressed={captain.id === selectedId}
            onClick={() => onSelect(captain)}
            className="flex w-full items-center justify-between gap-3 rounded-lg border border-transparent px-3 py-3 text-left text-sm transition hover:border-[#E8B84B]/40 hover:bg-[#E8B84B]/10 focus-visible:outline-[#E8B84B] aria-pressed:bg-[#E8B84B]/15"
          >
            <span className="min-w-0 break-words font-medium">{captain.name}</span>
            <span className="shrink-0 text-xs text-gray-400">{captain.id === selectedId ? '当前舰长 ✓' : '是我 →'}</span>
          </button>
        )) : (
          <p role="status" className="py-8 text-center text-sm text-gray-500">{captains.length ? '没找到这位舰长，换个名字试试？' : '还没有舰长档案，等名单更新后再来看看吧。'}</p>
        )}
      </div>
      <button type="button" onClick={onClose} className="mt-4 w-full rounded-lg border border-gray-200 py-2.5 text-sm text-gray-500 hover:bg-gray-50">先逛逛，稍后再选</button>
    </dialog>
  );
}
