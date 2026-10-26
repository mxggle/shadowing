//! Where a track's samples are: an ordinary file's tables (`stbl`), or a
//! fragmented file's `moof`s, each followed by the samples' bytes in an `mdat`.

use super::bytes::{bad, boxes, find, need, Bx, Cur};
use super::read::{Sample, Track};

/// More samples than any track has (a day of 60 fps video is 5 million).
const MAX_SAMPLES: usize = 50_000_000;

/// A full box that is a count and then that many entries.
pub(super) fn entries<T>(
    b: &Bx,
    mut entry: impl FnMut(&mut Cur, u8) -> Result<T, String>,
) -> Result<Vec<T>, String> {
    let mut c = Cur::new(b.body);
    let (v, _) = c.version_flags()?;
    let n = c.u32()? as usize;
    if n > c.left() / 4 {
        return Err(bad("表比盒子长"));
    }
    (0..n).map(|_| entry(&mut c, v)).collect()
}

/// `n` values from (count, value) runs; a short list goes on with `rest`.
fn expand<T: Copy>(runs: &[(u32, T)], n: usize, rest: T) -> Vec<T> {
    let mut out = Vec::with_capacity(n);
    for &(count, v) in runs {
        let take = (count as usize).min(n - out.len());
        out.extend(std::iter::repeat_n(v, take));
    }
    out.resize(n, runs.last().map_or(rest, |r| r.1));
    out
}

/// The samples an ordinary file lists in `stbl` (none in a fragmented one).
pub(super) fn table(stbl: &[Bx]) -> Result<Vec<Sample>, String> {
    let mut c = Cur::new(need(stbl, b"stsz")?.body);
    c.version_flags()?;
    let (fixed, n) = (c.u32()?, c.u32()? as usize);
    if n == 0 {
        return Ok(Vec::new());
    }
    if n > MAX_SAMPLES || (fixed == 0 && n > c.left() / 4) {
        return Err(bad("stsz"));
    }
    let sizes: Vec<u32> = (0..n)
        .map(|_| if fixed != 0 { Ok(fixed) } else { c.u32() })
        .collect::<Result<_, _>>()?;
    let chunks = match find(stbl, b"co64") {
        Some(b) => entries(b, |c, _| c.u64())?,
        None => entries(need(stbl, b"stco")?, |c, _| c.u32().map(u64::from))?,
    };
    let stsc = entries(need(stbl, b"stsc")?, |c, _| {
        Ok((c.u32()? as usize, c.u32()?, c.u32()?))
    })?;
    let mut offsets = Vec::with_capacity(n);
    let mut entry = 0;
    for (i, &at) in chunks.iter().enumerate() {
        while stsc.get(entry + 1).is_some_and(|e| e.0 <= i + 1) {
            entry += 1;
        }
        let mut at = at;
        for _ in 0..stsc.get(entry).map_or(0, |e| e.1) {
            let Some(&size) = sizes.get(offsets.len()) else {
                break;
            };
            offsets.push(at);
            at = at.saturating_add(size as u64);
        }
    }
    if offsets.len() != n {
        return Err(bad("样本表对不上"));
    }
    let stts = entries(need(stbl, b"stts")?, |c, _| Ok((c.u32()?, c.u32()?)))?;
    let ctts = match find(stbl, b"ctts") {
        Some(b) => entries(b, |c, _| Ok((c.u32()?, c.u32()? as i32)))?,
        None => Vec::new(),
    };
    let mut sync = vec![find(stbl, b"stss").is_none(); n];
    if let Some(stss) = find(stbl, b"stss") {
        for k in entries(stss, |c, _| c.u32())? {
            if let Some(s) = sync.get_mut((k as usize).wrapping_sub(1)) {
                *s = true;
            }
        }
    }
    let (durations, ctos) = (expand(&stts, n, 0), expand(&ctts, n, 0));
    Ok((0..n)
        .map(|i| Sample {
            offset: offsets[i],
            size: sizes[i],
            duration: durations[i],
            cto: ctos[i],
            sync: sync[i],
        })
        .collect())
}

/// A `moof` at `start` in the file: each `traf` adds its samples to its track.
pub(super) fn fragment(body: &[u8], start: u64, tracks: &mut [Track]) -> Result<(), String> {
    let mut data_end = start;
    for traf in boxes(body)?.iter().filter(|b| &b.typ == b"traf") {
        let kids = boxes(traf.body)?;
        let mut c = Cur::new(need(&kids, b"tfhd")?.body);
        let (_, flags) = c.version_flags()?;
        let id = c.u32()?;
        let Some(t) = tracks.iter_mut().find(|t| t.id == id) else {
            continue;
        };
        let base = match flags {
            f if f & 0x1 != 0 => c.u64()?,
            f if f & 0x2_0000 != 0 => start,
            _ => data_end,
        };
        let [_, mut duration, mut size, mut sample_flags] = t.defaults;
        let mut field = |bit: u32, into: &mut u32| -> Result<(), String> {
            if flags & bit != 0 {
                *into = c.u32()?;
            }
            Ok(())
        };
        field(0x2, &mut 0)?;
        field(0x8, &mut duration)?;
        field(0x10, &mut size)?;
        field(0x20, &mut sample_flags)?;
        if let Some(tfdt) = find(&kids, b"tfdt") {
            let mut c = Cur::new(tfdt.body);
            let (v, _) = c.version_flags()?;
            t.decode_from(c.sized(v)?);
        }
        let mut next = base;
        for trun in kids.iter().filter(|b| &b.typ == b"trun") {
            let mut c = Cur::new(trun.body);
            let (_, f) = c.version_flags()?;
            let n = c.u32()? as usize;
            if f & 0x1 != 0 {
                let offset = c.u32()? as i32 as i64;
                next = base.checked_add_signed(offset).ok_or_else(|| bad("trun"))?;
            }
            let first_flags = if f & 0x4 != 0 { Some(c.u32()?) } else { None };
            if t.samples.len() + n > MAX_SAMPLES {
                return Err(bad("样本太多"));
            }
            let mut value =
                |bit: u32, default: u32| if f & bit != 0 { c.u32() } else { Ok(default) };
            for i in 0..n {
                let d = value(0x100, duration)?;
                let s = value(0x200, size)?;
                let first = if i == 0 { first_flags } else { None };
                let fl = value(0x400, first.unwrap_or(sample_flags))?;
                // Signed in version 1; version 0's unsigned offsets never get near 2^31.
                let cto = value(0x800, 0)? as i32;
                let sync = fl & 0x1_0000 == 0;
                t.samples.push(Sample {
                    offset: next,
                    size: s,
                    duration: d,
                    cto,
                    sync,
                });
                t.end += d as u64;
                next = next.saturating_add(s as u64);
            }
        }
        data_end = next;
    }
    Ok(())
}
