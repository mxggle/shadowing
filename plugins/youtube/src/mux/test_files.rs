//! DASH files built for the tests, the way YouTube writes them.

use super::bytes::{bx, full, Put};

/// A sample to build: size, composition offset, sync.
pub type S = (u32, i32, bool);

/// A DASH file as YouTube writes them: an empty `moov` with `mvex`, then `moof` +
/// `mdat` per fragment (at its decode time). Picture: duration in `tfhd`; size,
/// flags and offset per sample in `trun`. Sound: duration and flags in `tfhd`,
/// sizes in `trun`. Every byte of the k-th sample is k.
pub fn dash(
    handler: &[u8; 4],
    timescale: u32,
    duration: u32,
    edit: Option<(u32, i32)>,
    fragments: &[(u64, Vec<S>)],
) -> Vec<u8> {
    let video = handler == b"vide";
    let mut mvhd = Vec::new();
    mvhd.put(&[0; 8]).u32(timescale).put(&[0; 84]);
    let mut tkhd = Vec::new();
    tkhd.put(&[0; 8]).u32(1).put(&[0; 8]).put(&[0; 12]);
    tkhd.u16(if video { 0 } else { 0x100 }).u16(0).put(&[9; 36]);
    tkhd.u32(64 << 16).u32(36 << 16);
    let mut trak = full(b"tkhd", 0, 3, &tkhd);
    if let Some((segment, media_time)) = edit {
        let mut elst = Vec::new();
        elst.u32(1).u32(segment).u32(media_time as u32).u32(0x10000);
        trak.put(&bx(b"edts", &full(b"elst", 0, 0, &elst)));
    }
    let mut mdhd = Vec::new();
    mdhd.put(&[0; 8]).u32(timescale).u32(0).u16(0x55c4).u16(0);
    let mut mdia = full(b"mdhd", 0, 0, &mdhd);
    let mut hdlr = vec![0; 4];
    hdlr.put(handler).put(&[0; 12]).put(b"Test\0");
    mdia.put(&full(b"hdlr", 0, 0, &hdlr));
    let mut minf = match video {
        true => full(b"vmhd", 0, 1, &[0; 8]),
        false => full(b"smhd", 0, 0, &[0; 4]),
    };
    let mut dref = Vec::new();
    dref.u32(1).put(&full(b"url ", 0, 1, &[]));
    minf.put(&bx(b"dinf", &full(b"dref", 0, 0, &dref)));
    let mut stsd = Vec::new();
    stsd.u32(1)
        .put(&bx(if video { b"avc1" } else { b"mp4a" }, &[7; 20]));
    let mut stbl = full(b"stsd", 0, 0, &stsd);
    for typ in [b"stts", b"stsc", b"stco"] {
        stbl.put(&full(typ, 0, 0, &[0; 4]));
    }
    stbl.put(&full(b"stsz", 0, 0, &[0; 8]));
    minf.put(&bx(b"stbl", &stbl));
    mdia.put(&bx(b"minf", &minf));
    trak.put(&bx(b"mdia", &mdia));
    let mut moov = full(b"mvhd", 0, 0, &mvhd);
    moov.put(&bx(b"trak", &trak));
    moov.put(&bx(
        b"mvex",
        &full(
            b"trex",
            0,
            0,
            &[0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        ),
    ));

    let mut file = bx(b"ftyp", b"dash\0\0\0\0iso6mp41");
    file.put(&bx(b"moov", &moov));
    let mut k = 0u8;
    for (n, (decode_time, samples)) in fragments.iter().enumerate() {
        let moof = |data_offset: u32| {
            let mut tfhd = Vec::new();
            tfhd.u32(1).u32(1).u32(duration);
            if !video {
                tfhd.u32(0);
            }
            let mut trun = Vec::new();
            trun.u32(samples.len() as u32).u32(data_offset);
            for &(size, cto, sync) in samples {
                trun.u32(size);
                if video {
                    trun.u32(if sync { 0x0200_0000 } else { 0x0101_0000 })
                        .u32(cto as u32);
                }
            }
            let mut traf = full(b"tfhd", 0, if video { 0x2_000a } else { 0x2_002a }, &tfhd);
            traf.put(&full(b"tfdt", 1, 0, &decode_time.to_be_bytes()));
            traf.put(&full(b"trun", 0, if video { 0xe01 } else { 0x201 }, &trun));
            let mut body = full(b"mfhd", 0, 0, &(n as u32 + 1).to_be_bytes());
            body.put(&bx(b"traf", &traf));
            bx(b"moof", &body)
        };
        let size = moof(0).len() as u32;
        file.put(&moof(size + 8));
        let mut data = Vec::new();
        for &(size, _, _) in samples {
            data.extend(std::iter::repeat_n(k, size as usize));
            k = k.wrapping_add(1);
        }
        file.put(&bx(b"mdat", &data));
    }
    file
}

/// A picture: 30 fps, a key frame and B-frames per fragment of half a second.
pub fn picture(fragments: u64) -> Vec<u8> {
    let half: Vec<S> = (0..15)
        .map(|i| (100 + i * 7, [1024, 2048, 0][i as usize % 3], i == 0))
        .collect();
    let fragments: Vec<_> = (0..fragments)
        .map(|f| (f * 15 * 512, half.clone()))
        .collect();
    dash(b"vide", 15360, 512, Some((15 * 512 * 3, 1024)), &fragments)
}

/// Sound: 44.1 kHz AAC frames, 22 to a fragment.
pub fn sound(fragments: u64) -> Vec<u8> {
    let frames: Vec<S> = (0..22).map(|i| (20 + i % 5, 0, true)).collect();
    let fragments: Vec<_> = (0..fragments)
        .map(|f| (f * 22 * 1024, frames.clone()))
        .collect();
    dash(b"soun", 44100, 1024, None, &fragments)
}
