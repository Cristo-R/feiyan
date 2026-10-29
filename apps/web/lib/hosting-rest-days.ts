/**
 * 每周固休：以「周几」为规则存储，读取时按需展开成具体日期
 *
 * 不写入 hosting_leave_dates —— 固休是规则、请假是具体某天的事件，
 * 两者语义与前台样式都需要区分，混在一张表里无法还原。
 */

/** ISO 星期：1=周一 … 7=周日（与看板「周一至周日」展示顺序一致） */
export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** site_settings JSON 中的存储 key */
export const REST_SETTING_KEY = 'hosting_weekly_rest_days';

export const WEEKDAY_OPTIONS: { value: IsoWeekday; label: string }[] = [
  { value: 1, label: '周一' },
  { value: 2, label: '周二' },
  { value: 3, label: '周三' },
  { value: 4, label: '周四' },
  { value: 5, label: '周五' },
  { value: 6, label: '周六' },
  { value: 7, label: '周日' },
];

export const WEEKDAY_LABEL: Record<IsoWeekday, string> = {
  1: '周一',
  2: '周二',
  3: '周三',
  4: '周四',
  5: '周五',
  6: '周六',
  7: '周日',
};

function isIsoWeekday(n: number): n is IsoWeekday {
  return Number.isInteger(n) && n >= 1 && n <= 7;
}

/** 宽松解析：非法值丢弃、去重、升序。坏数据回退 [] 而非抛错 */
export function parseWeeklyRestDays(raw: unknown): IsoWeekday[] {
  if (!Array.isArray(raw)) return [];
  const out = new Set<IsoWeekday>();
  for (const v of raw) {
    const n = Number(v);
    if (isIsoWeekday(n)) out.add(n);
  }
  return Array.from(out).sort((a, b) => a - b);
}

/**
 * ISO 日期 → ISO 星期编号
 * 口径与 hosting-week-utils 的 weekdayLabel / mondayIsoOfWeekContaining 一致（本地日历）
 */
export function isoWeekdayOf(iso: string): IsoWeekday {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  return (((dt.getDay() + 6) % 7) + 1) as IsoWeekday;
}

export function isWeeklyRestDate(iso: string, restDays: IsoWeekday[]): boolean {
  if (restDays.length === 0) return false;
  return restDays.includes(isoWeekdayOf(iso));
}

/** 取 dates 中命中固休规则的日期（保持入参顺序） */
export function filterRestDates(dates: string[], restDays: IsoWeekday[]): string[] {
  if (restDays.length === 0) return [];
  return dates.filter(d => isWeeklyRestDate(d, restDays));
}

export function formatRestDaysLabel(restDays: IsoWeekday[]): string {
  if (restDays.length === 0) return '未设置';
  return restDays.map(d => WEEKDAY_LABEL[d]).join('、');
}
