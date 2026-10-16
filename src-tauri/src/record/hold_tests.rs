use super::*;
use crate::record::take::{place, RATE};

const NS: u64 = 1_000_000_000 / RATE as u64; // one sample at RATE, exactly

fn mark(at: u64, frames: u32) -> Mark {
    Mark {
        at,
        frames,
        rate: RATE,
    }
}

#[test]
fn what_comes_after_a_pause_moves_back_by_it() {
    let mut cuts = Cuts::default();
    cuts.pause(100);
    assert_eq!(cuts.place(50), Some(50));
    assert_eq!(cuts.place(100), None, "heard while paused");
    cuts.resume(300);
    assert_eq!(cuts.place(299), None);
    assert_eq!(cuts.place(300), Some(100), "right where the pause began");
    assert_eq!(cuts.place(450), Some(250));
    cuts.pause(500);
    assert_eq!(cuts.place(450), Some(250), "before the second pause");
    assert_eq!(cuts.place(10_000), None);
    cuts.resume(600);
    assert_eq!(cuts.place(700), Some(400), "both pauses cut out");
}

#[test]
fn blocks_heard_while_paused_are_left_out_with_their_samples() {
    let mut cuts = Cuts::default();
    let mut p = Played::default();
    p.samples.extend([1.0, 1.0, 2.0, 2.0]);
    p.mark(mark(0, 2), &cuts);
    cuts.pause(10);
    p.mark(mark(10, 2), &cuts);
    assert_eq!(p.samples, [1.0, 1.0], "the paused block's samples go too");
    p.samples.extend([3.0, 3.0, 4.0]);
    cuts.resume(30);
    p.mark(mark(30, 2), &cuts);
    assert_eq!(p.marks.len(), 2);
    assert_eq!(p.marks[1].at, 10, "moved back to where the pause began");
    assert_eq!(p.samples, [1.0, 1.0, 3.0, 3.0, 4.0]);
    // Copied ahead of time (in before the pause, heard after it): out too.
    p.samples.extend([4.0, 5.0, 5.0]);
    p.mark(mark(40, 2), &cuts); // at 20 with the pause cut out
    p.mark(mark(42, 2), &cuts);
    cuts.pause(41);
    p.cut(&cuts);
    assert_eq!(
        p.marks.iter().map(|m| m.at).collect::<Vec<_>>(),
        [0, 10, 20]
    );
    assert_eq!(p.samples, [1.0, 1.0, 3.0, 3.0, 4.0, 4.0]);
}

#[test]
fn a_new_round_keeps_a_block_still_on_its_way() {
    let cuts = Cuts::default();
    let mut p = Played::default();
    p.samples.extend([1.0, 1.0, 1.0, 2.0, 2.0, 3.0, 3.0]);
    p.mark(mark(0, 3), &cuts);
    p.mark(mark(1, 2), &cuts);
    let (taken, out) = p.take();
    assert_eq!(taken.len(), 2);
    assert_eq!(
        out,
        [1.0, 1.0, 1.0, 2.0, 2.0],
        "the marked blocks go with them"
    );
    assert!(p.marks.is_empty());
    assert_eq!(
        p.samples,
        [3.0, 3.0],
        "the next block's samples, its mark to come"
    );
    p.mark(mark(2, 2), &cuts);
    assert_eq!(p.take().1, [3.0, 3.0]);
}

/// The original as the engine plays it, block by block from `OFFSET`; paused
/// (silent) from block `pause` to block `resume`. A value per sample of the
/// original, so where it is can be read back.
fn output(len: usize, pause: usize, resume: usize) -> Vec<f32> {
    const OFFSET: usize = 96;
    let mut out = vec![0.0; len];
    let mut said = 0;
    for (k, chunk) in out[OFFSET..].chunks_mut(BLOCK).enumerate() {
        if (pause..resume).contains(&k) {
            continue;
        }
        for v in chunk {
            said += 1;
            *v = said as f32 / 1e6;
        }
    }
    out
}

const BLOCK: usize = 320;

#[test]
fn a_paused_take_lines_up_as_if_there_had_been_no_pause() {
    // 5 s; the mic hears the speakers 7 ms late. Paused at 1 s, going on at
    // 3 s; the engine stops a block or two after the take pauses and starts a
    // block or two after it goes on, as it does at its next callback.
    let first_at = 1_000_000_000u64;
    let (len, delay) = (RATE as usize * 5, 224);
    let (pause, resume) = (RATE as usize, RATE as usize * 3);
    let out = output(len, 101, 301);
    let mic: Vec<f32> = (0..len)
        .map(|i| if i >= delay { out[i - delay] } else { 0.0 })
        .collect();
    let mut hold = Hold::new(first_at, RATE);
    let (mut buf, mut played) = (Vec::new(), Played::default());
    let mut next_block = 0;
    for poll in (0..len).step_by(BLOCK) {
        if poll == pause || poll == resume {
            hold.set(poll == pause);
            if poll == pause {
                played.cut(hold.cuts());
            }
        }
        for &v in &mic[poll..poll + BLOCK] {
            if hold.mic() {
                buf.push(v);
            }
        }
        // The output runs a block ahead of what's heard.
        while 96 + next_block * BLOCK < (poll + 2 * BLOCK).min(len) {
            let from = 96 + next_block * BLOCK;
            let to = (from + BLOCK).min(len);
            played.samples.extend_from_slice(&out[from..to]);
            let m = mark(first_at + from as u64 * NS, (to - from) as u32);
            played.mark(m, hold.cuts());
            next_block += 1;
        }
    }
    assert_eq!(
        buf.len(),
        len - (resume - pause),
        "the paused time is left out"
    );
    let line = place(
        &played.marks,
        &played.samples,
        first_at,
        buf.len() as f64 / RATE as f64,
    );
    assert_eq!(line.len(), buf.len());
    // The echo is where it always is: what the mic has is what played 7 ms before…
    let tail = pause..pause + delay + BLOCK; // …except the echo of the last moment before the pause
    let off = (delay + 96..buf.len())
        .filter(|j| !tail.contains(j) && (buf[*j] - line[j - delay]).abs() > 1e-7)
        .count();
    assert_eq!(off, 0, "samples out of line");
    // And the original goes on where it stopped: a block lost at most, a block of quiet between.
    let said = |x: f32| (x * 1e6).round() as i64;
    let before = line[..pause].iter().rposition(|&v| v != 0.0).unwrap();
    let after = pause + line[pause..].iter().position(|&v| v != 0.0).unwrap();
    assert!(
        after - before <= 2 * BLOCK,
        "quiet between: {}",
        after - before
    );
    let skipped = said(line[after]) - said(line[before]) - 1;
    assert!(
        (0..=BLOCK as i64).contains(&skipped),
        "original skipped: {skipped}"
    );
}
