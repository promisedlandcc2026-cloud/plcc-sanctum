import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Copy, Languages, Loader2, Type, X } from 'lucide-react';
import {
  loadBooks,
  loadChapter,
  loadTranslations,
  pairedTranslation,
  selectionLabel,
  type BibleBookInfo,
  type BibleChapterText,
  type BibleTranslationInfo,
} from '../../lib/bibleClient';

const SAVED_KEY = 'plcc_sanctum_bible_v1';
const SIZES = ['text-[15px]', 'text-[17px]', 'text-[19px]'] as const;

type Saved = { t?: string; b?: string; c?: number; compare?: string | null; size?: number };

function readSaved(): Saved {
  try {
    return JSON.parse(localStorage.getItem(SAVED_KEY) || '{}') as Saved;
  } catch {
    return {};
  }
}
function writeSaved(next: Saved) {
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify({ ...readSaved(), ...next }));
  } catch {
    /* private mode: fine */
  }
}

type BiblePosition = { t: string; b: string; c: number };
export const BibleReader: React.FC = () => {
  const saved = useMemo(readSaved, []);
  const passage = useRef<HTMLElement>(null);

  const [translations, setTranslations] = useState<BibleTranslationInfo[]>([]);
  const [defaults, setDefaults] = useState<{ english: string | null; luganda: string | null }>({ english: null, luganda: null });
  const [bookCatalog, setBookCatalog] = useState<{ translation: string; books: BibleBookInfo[] } | null>(null);
  const [chapter, setChapter] = useState<BibleChapterText | null>(null);
  const [second, setSecond] = useState<BibleChapterText | null>(null);
  const [retry, setRetry] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<number[]>([]);
  const [flash, setFlash] = useState<string | null>(null);
  const [size, setSize] = useState<number>(saved.size ?? 0);
  const [pos, setPos] = useState<BiblePosition>({ t: saved.t || '', b: (saved.b || 'JHN').toUpperCase(), c: saved.c || 1 });
  const [compareId, setCompareId] = useState<string | null | undefined>(saved.compare);
  const { t, b, c } = pos;

  const main = translations.find((x) => x.id === t);
  const books = bookCatalog?.translation === t ? bookCatalog.books : [];
  const book = books.find((x) => x.id === b);
  const compare = compareId === undefined ? pairedTranslation(main, defaults) : compareId;
  const compareInfo = translations.find((x) => x.id === compare);

  const go = (next: Partial<BiblePosition>) => {
    setPos((cur) => ({ ...cur, ...next }));
    setSelected([]);
    setFlash(null);
  };

  const turnPage = (next: Pick<BiblePosition, 'b' | 'c'>) => {
    go(next);
    passage.current?.closest('[role="region"]')?.scrollTo({ top: 0 });
  };

  useEffect(() => {
    let live = true;
    setError(null);
    loadTranslations()
      .then((data) => {
        if (!live) return;
        setTranslations(data.translations);
        setDefaults(data.defaults);
        if (!data.translations.some((x) => x.id === t)) {
          const start = data.defaults.english || data.translations[0]?.id;
          if (start) go({ t: start });
          else setError('No Bible translations are available right now.');
        }
      })
      .catch((err: Error) => live && setError(err.message));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retry]);

  useEffect(() => {
    if (!main) return;
    let live = true;
    setBookCatalog(null);
    setLoading(true);
    setChapter(null);
    setError(null);
    loadBooks(main.id)
      .then((list) => {
        if (!live) return;
        setBookCatalog({ translation: main.id, books: list });
        if (!list.length) {
          setError('No books are available for this translation.');
          return;
        }
        const current = list.find((x) => x.id === b);
        if (!current) go({ b: list.find((x) => x.id === 'JHN')?.id || list[0]?.id || 'GEN', c: 1 });
        else if (c > current.numberOfChapters) go({ c: 1 });
      })
      .catch((err: Error) => live && setError(err.message));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [main?.id, retry]);

  useEffect(() => {
    if (!main || !book || c > book.numberOfChapters) return;
    let live = true;
    setLoading(true);
    setChapter(null);
    setError(null);
    writeSaved({ t: main.id, b: book.id, c });
    loadChapter(main.id, book.id, c)
      .then((data) => live && setChapter(data))
      .catch((err: Error) => live && setError(err.message))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [main, book, c, retry]);

  useEffect(() => {
    setSecond(null);
    if (!compare || !book || c > book.numberOfChapters || compare === main?.id) return;
    let live = true;
    loadChapter(compare, book.id, c)
      .then((data) => live && setSecond(data))
      .catch(() => live && setSecond(null));
    return () => {
      live = false;
    };
  }, [compare, book, c, main?.id, retry]);

  const languages = useMemo(() => {
    const seen = new Map<string, string>();
    for (const tr of translations) if (!seen.has(tr.language)) seen.set(tr.language, tr.languageLabel);
    return [...seen.entries()];
  }, [translations]);

  const bookIndex = books.findIndex((x) => x.id === b);
  const prev = c > 1 ? { b, c: c - 1 } : bookIndex > 0 ? { b: books[bookIndex - 1].id, c: books[bookIndex - 1].numberOfChapters } : null;
  const next = book && c < book.numberOfChapters ? { b, c: c + 1 } : bookIndex >= 0 && bookIndex < books.length - 1 ? { b: books[bookIndex + 1].id, c: 1 } : null;

  const verses = chapter ? Object.entries(chapter.verses).map(([n, text]) => ({ n: Number(n), text })).sort((x, y) => x.n - y.n) : [];
  const bookName = chapter?.bookName || book?.name || b;
  const label = selectionLabel(bookName, c, selected);
  const toggleVerse = (n: number) => {
    setFlash(null);
    setSelected((cur) => (cur.includes(n) ? cur.filter((x) => x !== n) : [...cur, n]));
  };

  const copySelection = async () => {
    if (!selected.length || !main) return;
    const from = Math.min(...selected);
    const to = Math.max(...selected);
    const text = verses.filter((verse) => verse.n >= from && verse.n <= to).map((verse) => verse.text).join(' ');
    try {
      await navigator.clipboard.writeText(`“${text}”\n— ${label} (${main.shortName || main.name})`);
      setFlash('Copied');
    } catch {
      setFlash('Could not copy');
    }
  };

  const selectClass =
    'w-full min-w-0 min-h-[44px] rounded-xl border border-gray-200 bg-white px-2.5 text-[14px] font-semibold text-[#16251f] focus:outline-none focus:ring-2 focus:ring-[#0f3d2c]/30';

  const picker = (
    <section className="space-y-2" aria-label="Choose a passage">
      <div className="grid grid-cols-2 gap-2">
        <label className="block min-w-0">
          <span className="mb-1 block text-xs font-bold text-gray-500">Language</span>
          <select
            className={selectClass}
            value={main?.language || ''}
            onChange={(e) => {
              const lang = e.target.value;
              const preferred = lang === 'lug' ? defaults.luganda : lang === 'eng' ? defaults.english : null;
              const pick = translations.find((x) => x.id === preferred) || translations.find((x) => x.language === lang);
              if (pick) go({ t: pick.id });
            }}
          >
            {languages.map(([code, name]) => (
              <option key={code} value={code}>{name}</option>
            ))}
          </select>
        </label>
        <label className="block min-w-0">
          <span className="mb-1 block text-xs font-bold text-gray-500">Bible</span>
          <select className={selectClass} value={t} onChange={(e) => go({ t: e.target.value })}>
            {translations.filter((x) => x.language === main?.language).map((tr) => (
              <option key={tr.id} value={tr.id}>{tr.name}</option>
            ))}
          </select>
        </label>
        <label className="block min-w-0">
          <span className="mb-1 block text-xs font-bold text-gray-500">Book</span>
          <select className={selectClass} value={b} onChange={(e) => go({ b: e.target.value, c: 1 })}>
            {books.map((bk) => (
              <option key={bk.id} value={bk.id}>{bk.name}</option>
            ))}
          </select>
        </label>
        <label className="block min-w-0">
          <span className="mb-1 block text-xs font-bold text-gray-500">Chapter</span>
          <select className={selectClass} value={c} onChange={(e) => go({ c: Number(e.target.value) })}>
            {Array.from({ length: book?.numberOfChapters || 1 }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="flex items-center gap-2">
        <label className="flex min-h-[40px] min-w-0 flex-1 items-center gap-2 rounded-xl bg-[#f4ecdb] px-3 text-sm font-semibold text-[#16251f]">
          <Languages size={16} className="shrink-0 text-[#7a5a1c]" aria-hidden />
          <span className="shrink-0">Under:</span>
          <select
            className="min-w-0 flex-1 bg-transparent font-bold focus:outline-none"
            value={compare || ''}
            onChange={(e) => {
              const v = e.target.value || null;
              setCompareId(v);
              writeSaved({ compare: v });
            }}
            aria-label="Second language under each verse"
          >
            <option value="">Nothing</option>
            {translations.filter((x) => x.id !== t).map((tr) => (
              <option key={tr.id} value={tr.id}>{tr.languageLabel} · {tr.name}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => {
            const s = (size + 1) % SIZES.length;
            setSize(s);
            writeSaved({ size: s });
          }}
          className="inline-flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 text-sm font-bold text-[#0f3d2c]"
          aria-label="Change text size"
        >
          <Type size={16} aria-hidden /> Aa
        </button>
      </div>
    </section>
  );

  const bar = selected.length ? (
    <div className="sticky bottom-0 z-10 -mx-3 mt-3 border-t border-[#d9b45e]/40 bg-[#0f3d2c] px-3 py-2.5 text-white">
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 truncate text-sm font-bold">{flash || label}</p>
        <button
          type="button"
          onClick={() => void copySelection()}
          aria-label="Copy"
          className="inline-flex min-h-[40px] min-w-[40px] items-center justify-center gap-1.5 rounded-xl bg-white/10 px-2.5 text-sm font-bold"
        >
          <Copy size={16} aria-hidden />
        </button>
        <button type="button" onClick={() => setSelected([])} className="inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-xl bg-white/10" aria-label="Clear selection">
          <X size={18} aria-hidden />
        </button>
      </div>
    </div>
  ) : null;

  return (
    <div className="flex min-h-0 select-text flex-col">
      {picker}

      <article
        ref={passage}
        className="mt-3"
        dir={main?.textDirection || 'ltr'}
        lang={main?.language === 'lug' ? 'lg' : undefined}
      >
        <h2 className="font-serif text-[22px] font-bold leading-tight text-[#16251f]">
          {bookName} {c}
        </h2>
        {main ? <p className="mb-2 font-serif text-[13px] italic text-[#0f3d2c]">{main.name}</p> : null}

        {error ? (
          <div className="rounded-xl bg-red-50 px-3 py-3 text-sm font-semibold text-red-800">
            <p role="alert">{error}</p>
            <button type="button" onClick={() => setRetry((attempt) => attempt + 1)} className="mt-2 min-h-[44px] underline">Try again</button>
          </div>
        ) : loading && !verses.length ? (
          <p className="flex items-center gap-2 py-10 text-gray-500" role="status">
            <Loader2 className="animate-spin text-[#0f3d2c]" size={20} aria-hidden /> Loading…
          </p>
        ) : (
          <ol className={`space-y-1 ${loading ? 'opacity-60' : ''}`}>
            {verses.map((v) => {
              const on = selected.includes(v.n);
              const other = second?.verses[String(v.n)];
              return (
                <li key={v.n}>
                  <button
                    type="button"
                    onClick={() => toggleVerse(v.n)}
                    aria-pressed={on}
                    className={`w-full rounded-xl px-2 py-1.5 text-left transition-colors ${on ? 'bg-[#d9b45e]/20 ring-1 ring-[#d9b45e]' : 'hover:bg-[#f4ecdb]/60'}`}
                  >
                    <span className={`font-serif leading-relaxed text-[#16251f] ${SIZES[size] ?? SIZES[0]}`}>
                      <sup className="mr-1.5 font-sans text-[12px] font-bold text-[#7a5a1c]">{v.n}</sup>
                      {v.text}
                    </span>
                    {other ? (
                      <span
                        className="mt-1 block border-l-2 border-[#d9b45e] pl-3 text-[13.5px] leading-relaxed text-gray-600"
                        lang={compareInfo?.language === 'lug' ? 'lg' : undefined}
                        dir={compareInfo?.textDirection || 'ltr'}
                      >
                        {other}
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ol>
        )}

        <nav className="mt-4 flex items-center justify-between gap-2 border-t border-gray-100 pt-3" aria-label="Chapters">
          <button
            type="button"
            disabled={!prev}
            onClick={() => prev && turnPage(prev)}
            className="inline-flex min-h-[42px] items-center gap-1 rounded-xl border border-gray-200 px-3 text-sm font-bold text-[#0f3d2c] disabled:opacity-40"
          >
            <ChevronLeft size={18} aria-hidden /> Previous
          </button>
          <button
            type="button"
            disabled={!next}
            onClick={() => next && turnPage(next)}
            className="inline-flex min-h-[42px] items-center gap-1 rounded-xl bg-[#0f3d2c] px-4 text-sm font-bold text-white disabled:opacity-40"
          >
            Next <ChevronRight size={18} aria-hidden />
          </button>
        </nav>

        {main ? (
          <p className="mt-4 text-[11px] leading-relaxed text-gray-500">
            {main.licenseNotice ? `${main.licenseNotice} ` : ''}
            Text courtesy of {main.source ? main.source.name : 'the Free Use Bible API'}.
            {compareInfo && compareInfo.licenseNotice ? ` ${compareInfo.licenseNotice}` : ''}
          </p>
        ) : null}
      </article>

      {!selected.length && verses.length ? (
        <p className="mt-2 text-center text-xs text-gray-500">Tap a verse to select it for copying.</p>
      ) : null}
      {bar}
    </div>
  );
};
