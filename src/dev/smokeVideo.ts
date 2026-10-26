// Smoke-test part for videos (scripts/make-fixtures.sh writes Video/): the picture loads
// from the app's local server (src-tauri/src/media.rs), follows the sound the engine plays
// (play, speed, seek, pause, a loop), and the server gives out nothing but videos in the
// open folder. A WebM is listed, not played.
import { mediaUrl, type Track } from "../lib/api";
import { isWindows } from "../lib/platform";
import { debugEngine, playhead, useApp } from "../store";

interface Kit {
  check: (name: string, ok: boolean, detail?: string) => void;
  waitFor: (pred: () => boolean | Promise<boolean>, timeoutMs: number) => Promise<boolean>;
  tracks: Track[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** In step: the picture may trail a frame or two behind the 30 Hz status it chases. */
const IN_STEP = 0.2;

export async function videoScenario({ check, waitFor, tracks }: Kit) {
  const app = useApp.getState;
  const engine = debugEngine!;
  const video = tracks.find((t) => t.kind === "video");
  if (!video) return check("video fixture present", false, "run scripts/make-fixtures.sh again");

  app().open(video, true);
  const picture = () => document.querySelector("video");
  const shown = await waitFor(() => (picture()?.readyState ?? 0) >= 2 && (picture()?.videoWidth ?? 0) > 0, 5000);
  check("video picture loads from the local server", shown, `ready ${picture()?.readyState} width ${picture()?.videoWidth} error ${picture()?.error?.code}`);
  const sound = await waitFor(async () => (await engine.statusNow()).time > 0.4, 5000);
  check("video's sound plays in the engine", sound && !app().error, app().error ?? "");

  const off = async () => (await engine.statusNow()).time - (picture()?.currentTime ?? NaN);
  const inStep = async (label: string, extra = "") => {
    // Catching up runs 10% faster or slower: 0.25 s off takes 2.5 s.
    await waitFor(async () => Math.abs(await off()) < IN_STEP, 3000);
    const d = await off();
    const p = picture();
    const inner = (playhead()?.time ?? NaN) - (p?.currentTime ?? NaN);
    const state = `picture ${p?.currentTime.toFixed(2)} ${p?.paused ? "paused" : "playing"} rate ${p?.playbackRate.toFixed(3)}, as the app sees it ${inner.toFixed(3)}s, page ${document.visibilityState}`;
    check(`picture in step ${label}`, Math.abs(d) < IN_STEP, `off ${d.toFixed(3)}s${extra} (${state})`);
  };
  await sleep(1000);
  await inStep("while playing");

  app().setRate(0.75);
  await sleep(1500);
  await inStep("at 0.75×", ` rate ${picture()?.playbackRate.toFixed(3)}`);
  app().setRate(1);

  app().seek(1);
  await inStep("after a seek");

  app().toggle();
  const still = await waitFor(() => !!picture()?.paused, 1000);
  await sleep(300);
  check("picture pauses with the sound", still && Math.abs(await off()) < 0.06, `off ${(await off()).toFixed(3)}s`);
  app().toggle();

  // An A–B loop: after going round, the picture is back near A, not running on.
  await sleep(500);
  app().cycleLoop();
  await sleep(1200);
  app().cycleLoop();
  const { a, b } = app().loop;
  if (a === null || b === null) return check("picture loops with the sound", false, "no loop was set");
  const round = await waitFor(() => app().repeats >= 1, (b - a) * 1000 + 2000);
  await sleep(200);
  const t = picture()?.currentTime ?? NaN;
  check("picture loops with the sound", round && t >= a - 0.1 && t < b, `A ${a.toFixed(2)} B ${b.toFixed(2)} picture ${t.toFixed(2)}`);
  app().clearLoop();

  // Only videos inside the folder are served: not its audio, not a file elsewhere.
  const refused = (path: string) =>
    new Promise<boolean>((done) => {
      const v = document.createElement("video");
      v.muted = true;
      v.onerror = () => done(true);
      v.onloadedmetadata = () => done(false);
      window.setTimeout(() => done(false), 3000);
      v.src = mediaUrl(path);
    });
  const audio = tracks.find((t) => t.kind === "audio")!;
  check("video server refuses audio", await refused(audio.path));
  check("video server refuses files outside the folder", await refused(isWindows ? "C:\\Windows\\win.ini" : "/etc/hosts"));

  const webm = tracks.find((t) => t.kind === "unsupported");
  if (!webm) return check("WebM fixture present", false);
  app().open(webm, true);
  await sleep(500);
  const status = await engine.statusNow();
  check("a WebM is shown, not loaded", app().current?.path === webm.path && !status.path && !app().error, `engine ${status.path} error ${app().error}`);
  check("a WebM says why it can't play", document.body.innerText.includes("这个视频放不了"));
}
