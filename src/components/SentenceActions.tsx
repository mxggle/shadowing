import { BetweenHorizontalStart, Ellipsis, FoldVertical, Languages, PenLine, Repeat, Star } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { useDismiss } from "../hooks/useDismiss";
import { useKeys } from "../hooks/useKeys";
import { t } from "../lib/i18n";
import { useApp } from "../store";
import { BookStar } from "./Book";
import { MicButton } from "./Recorder";
import { MenuItem, MenuSeparator } from "./ui";

/** Room the 「…」 menu needs below its button before it opens upwards instead. */
const MENU_HEIGHT = 160;

const hoverOnly = "text-muted opacity-0 group-hover:opacity-100 hover:bg-hover hover:text-fg focus-visible:opacity-100";
const square = "grid size-[28px] place-items-center rounded-[8px] transition-[opacity,background-color,color,scale] duration-150 active:scale-90";

/**
 * A sentence row's actions on the right, shown while the pointer is over it: 解释, 循环
 * and 录音, and 「…」 for the rest (修改, 合并, 新段, 句子本). One that's on (looping,
 * explained, recorded, in 句子本) stays in sight.
 */
export function SentenceActions({ index, looping, explaining, editing, canSplit, last, inBook, takes, menu, setMenu }: {
  index: number;
  looping: boolean;
  explaining: boolean;
  editing: boolean;
  /** A new section may start here. */
  canSplit: boolean;
  /** The last sentence: nothing after it to join. */
  last: boolean;
  inBook: boolean;
  takes: number;
  /** The 「…」 menu is open (the row lifts above the ones after it). */
  menu: boolean;
  setMenu: (open: boolean) => void;
}) {
  const key = useKeys();
  const { toggleExplain, toggleSentenceLoop, tip } = useApp.getState();
  return (
    <span className="flex h-[30px] items-center">
      <button
        title={explaining ? t("收起解释 ({key})", { key: key("explain") }) : t("解释这一句 ({key})", { key: key("explain") })}
        aria-pressed={explaining}
        onClick={() => toggleExplain(index)}
        className={`${square} ${explaining ? "bg-press text-fg" : hoverOnly}`}
      >
        <Languages size={14} strokeWidth={2.1} />
      </button>
      <button
        title={looping ? t("取消循环 ({key})", { key: key("sentenceLoop") }) : t("循环这一句 ({key})", { key: key("sentenceLoop") })}
        aria-pressed={looping}
        onClick={() => {
          toggleSentenceLoop(index);
          tip("sentenceLoop");
        }}
        className={`${square} ${looping ? "text-loop hover:bg-loop-soft" : hoverOnly}`}
      >
        <Repeat size={14} strokeWidth={2.1} />
      </button>
      <BookStar index={index} inBook={inBook} takes={takes} />
      <MicButton at={index} count={takes} />
      {!editing && <More index={index} canSplit={canSplit} last={last} inBook={inBook} open={menu} setOpen={setMenu} />}
    </span>
  );
}

/** 「…」: what a sentence needs now and then. */
function More({ index, canSplit, last, inBook, open, setOpen }: { index: number; canSplit: boolean; last: boolean; inBook: boolean; open: boolean; setOpen: (open: boolean) => void }) {
  const key = useKeys();
  const root = useRef<HTMLSpanElement>(null);
  const [up, setUp] = useState(false);
  const close = useCallback(() => setOpen(false), [setOpen]);
  useDismiss(open, close, root);
  const { editSentence, mergeSentence, splitSection, toggleBook } = useApp.getState();
  const run = (action: () => void) => () => {
    setOpen(false);
    action();
  };
  const toggle = () => {
    if (!open) {
      // Near the bottom of the list, open upwards so the menu isn't cut off.
      const r = root.current?.getBoundingClientRect();
      const box = root.current?.closest(".overflow-y-auto")?.getBoundingClientRect();
      setUp(!!r && !!box && r.bottom + MENU_HEIGHT > box.bottom);
    }
    setOpen(!open);
  };

  return (
    <span ref={root} className="relative">
      <button title={t("更多")} aria-haspopup="menu" aria-expanded={open} onClick={toggle} className={`${square} ${open ? "bg-press text-fg" : hoverOnly}`}>
        <Ellipsis size={14} strokeWidth={2.1} />
      </button>
      {open && (
        <div
          role="menu"
          aria-label={t("更多")}
          className={`absolute right-0 z-20 w-[208px] animate-pop-in rounded-[12px] bg-raised p-1 shadow-lift ${
            up ? "bottom-full mb-1.5 origin-bottom-right" : "top-full mt-1.5 origin-top-right"
          }`}
        >
          <MenuItem icon={<PenLine size={15} strokeWidth={1.9} />} label={t("修改这一句")} title={t("修改这一句 ({key})", { key: key("edit") })} onClick={run(() => editSentence(index))} />
          {!last && <MenuItem icon={<FoldVertical size={15} strokeWidth={1.9} />} label={t("与下一句合并")} onClick={run(() => void mergeSentence(index))} />}
          {canSplit && <MenuItem icon={<BetweenHorizontalStart size={15} strokeWidth={1.9} />} label={t("从这句开始新段")} onClick={run(() => splitSection(index))} />}
          <MenuSeparator />
          <MenuItem
            icon={<Star size={15} strokeWidth={1.9} />}
            label={inBook ? t("从句子本拿掉") : t("加进句子本")}
            title={inBook ? t("从句子本拿掉 ({key})", { key: key("book") }) : t("加进句子本，明天再来跟读 ({key})", { key: key("book") })}
            onClick={run(() => toggleBook(index))}
          />
        </div>
      )}
    </span>
  );
}
