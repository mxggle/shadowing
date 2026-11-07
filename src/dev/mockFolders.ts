// Folders opened before, in the browser mock: the podcast folder is open, a textbook
// folder is pinned, a news folder was opened recently, and a USB drive isn't plugged in.
import type { FolderEntry, FolderListing, OpenedFolder, Track } from "../lib/api";

interface MockFolder {
  listing: FolderListing;
  place: string;
  pin: number | null;
  missing: boolean;
  lastTrack: string | null;
}

const audio = (root: string, names: string[]): Track[] =>
  names.map((name, i) => ({ path: `${root}/${name}.mp3`, name, relDir: "", size: 1e6 * (i + 1), kind: "audio" }));

const other = (root: string, place: string, names: string[], extra: Partial<MockFolder> = {}): MockFolder => ({
  listing: { root, name: root.split("/").pop() ?? root, tracks: audio(root, names) },
  place,
  pin: null,
  missing: false,
  lastTrack: null,
  ...extra,
});

/** Most recent first, as Rust keeps them. `current` is the open folder's listing. */
export function mockFolders(current: FolderListing | null, fresh: boolean, gone = false) {
  let list: MockFolder[] = fresh
    ? []
    : [
        ...(current ? [{ listing: current, place: "~/Music", pin: null, missing: gone, lastTrack: null }] : []),
        other("/Users/me/Downloads/NHK やさしいことばニュース", "~/Downloads", ["11月6日 天気", "11月5日 電車"]),
        other("/Users/me/Documents/日语/新标准日本语 初级", "~/Documents/日语", ["第1課 李さんは中国人です", "第2課 これは本です", "第3課 ここはデパートです"], { pin: 0 }),
        other("/Volumes/U盘/听力课程", "/Volumes/U盘", [], { missing: true }),
      ];
  let open = current?.root ?? null;

  const entries = (): FolderEntry[] =>
    list
      .map((f, recency) => ({ f, recency }))
      .sort((a, b) => (a.f.pin ?? Infinity) - (b.f.pin ?? Infinity) || a.recency - b.recency)
      .map(({ f, recency }) => ({
        path: f.listing.root,
        name: f.listing.name,
        place: f.place,
        pinned: f.pin !== null,
        current: f.listing.root === open,
        missing: f.missing,
        recency,
      }));

  return {
    entries,
    /** The open folder's track, remembered for when you come back. */
    leftAt(track: string | null) {
      const f = list.find((x) => x.listing.root === open);
      if (f) f.lastTrack = track;
    },
    /** A folder from the native dialog (the mock has only the podcast folder to pick). */
    chosen(listing: FolderListing): OpenedFolder {
      if (!list.some((x) => x.listing.root === listing.root)) list.unshift({ listing, place: "~/Music", pin: null, missing: false, lastTrack: null });
      return this.open(listing.root);
    },
    open(path: string): OpenedFolder {
      const f = list.find((x) => x.listing.root === path);
      if (!f) throw "这个文件夹不在列表里了，请重新选择";
      if (f.missing) throw "找不到这个文件夹：可能被移动、改了名，或者它所在的硬盘没有接上";
      list = [f, ...list.filter((x) => x !== f)];
      open = path;
      return { folder: { ...f.listing, tracks: [...f.listing.tracks] }, lastTrack: f.lastTrack, folders: entries() };
    },
    pin(path: string, pinned: boolean) {
      const f = list.find((x) => x.listing.root === path);
      const next = Math.max(-1, ...list.map((x) => x.pin ?? -1)) + 1;
      if (f) f.pin = pinned ? (f.pin ?? next) : null;
      return entries();
    },
    forget(path: string) {
      if (path !== open) list = list.filter((x) => x.listing.root !== path);
      return entries();
    },
  };
}
