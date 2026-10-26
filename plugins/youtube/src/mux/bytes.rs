//! ISO-BMFF boxes: a cursor over big-endian bytes, the boxes in a slice, and
//! writing boxes back.

pub fn bad(what: &str) -> String {
    format!("视频文件看不懂（{what}）")
}

pub struct Cur<'a> {
    b: &'a [u8],
    p: usize,
}

impl<'a> Cur<'a> {
    pub fn new(b: &'a [u8]) -> Self {
        Cur { b, p: 0 }
    }

    pub fn take(&mut self, n: usize) -> Result<&'a [u8], String> {
        let end = self.p.checked_add(n).filter(|e| *e <= self.b.len());
        let end = end.ok_or_else(|| bad("盒子比文件短"))?;
        let out = &self.b[self.p..end];
        self.p = end;
        Ok(out)
    }

    pub fn left(&self) -> usize {
        self.b.len() - self.p
    }

    pub fn skip(&mut self, n: usize) -> Result<(), String> {
        self.take(n).map(|_| ())
    }

    pub fn u8(&mut self) -> Result<u8, String> {
        Ok(self.take(1)?[0])
    }

    pub fn u16(&mut self) -> Result<u16, String> {
        Ok(u16::from_be_bytes(self.take(2)?.try_into().unwrap()))
    }

    pub fn u32(&mut self) -> Result<u32, String> {
        Ok(u32::from_be_bytes(self.take(4)?.try_into().unwrap()))
    }

    pub fn u64(&mut self) -> Result<u64, String> {
        Ok(u64::from_be_bytes(self.take(8)?.try_into().unwrap()))
    }

    /// A full box's version and flags.
    pub fn version_flags(&mut self) -> Result<(u8, u32), String> {
        let v = self.u32()?;
        Ok(((v >> 24) as u8, v & 0x00ff_ffff))
    }

    /// A 32-bit value in version 0, 64-bit in version 1.
    pub fn sized(&mut self, version: u8) -> Result<u64, String> {
        if version == 1 {
            self.u64()
        } else {
            self.u32().map(u64::from)
        }
    }
}

pub struct Bx<'a> {
    pub typ: [u8; 4],
    pub body: &'a [u8],
    /// The whole box, header included.
    pub raw: &'a [u8],
}

/// The boxes one after another in `b` (a file's top, or a container's body).
pub fn boxes(b: &[u8]) -> Result<Vec<Bx<'_>>, String> {
    let mut out = Vec::new();
    let mut c = Cur::new(b);
    while c.p + 8 <= b.len() {
        let start = c.p;
        let small = c.u32()? as u64;
        let typ: [u8; 4] = c.take(4)?.try_into().unwrap();
        let size = match small {
            0 => (b.len() - start) as u64,
            1 => c.u64()?,
            n => n,
        };
        let header = c.p - start;
        if size < header as u64 || size > (b.len() - start) as u64 {
            return Err(bad("盒子的大小不对"));
        }
        let end = start + size as usize;
        out.push(Bx {
            typ,
            body: &b[c.p..end],
            raw: &b[start..end],
        });
        c.p = end;
    }
    Ok(out)
}

pub fn find<'a, 'b>(boxes: &'b [Bx<'a>], typ: &[u8; 4]) -> Option<&'b Bx<'a>> {
    boxes.iter().find(|b| &b.typ == typ)
}

pub fn need<'a, 'b>(boxes: &'b [Bx<'a>], typ: &[u8; 4]) -> Result<&'b Bx<'a>, String> {
    find(boxes, typ).ok_or_else(|| bad(&format!("没有 {}", String::from_utf8_lossy(typ))))
}

/// Big-endian writes onto a byte vector.
pub trait Put {
    fn u16(&mut self, v: u16) -> &mut Self;
    fn u32(&mut self, v: u32) -> &mut Self;
    fn u64(&mut self, v: u64) -> &mut Self;
    fn put(&mut self, b: &[u8]) -> &mut Self;
}

impl Put for Vec<u8> {
    fn u16(&mut self, v: u16) -> &mut Self {
        self.put(&v.to_be_bytes())
    }
    fn u32(&mut self, v: u32) -> &mut Self {
        self.put(&v.to_be_bytes())
    }
    fn u64(&mut self, v: u64) -> &mut Self {
        self.put(&v.to_be_bytes())
    }
    fn put(&mut self, b: &[u8]) -> &mut Self {
        self.extend_from_slice(b);
        self
    }
}

/// A box around `body` (a 64-bit size only when it needs one).
pub fn bx(typ: &[u8; 4], body: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(body.len() + 16);
    match u32::try_from(body.len() + 8) {
        Ok(size) => out.u32(size).put(typ),
        Err(_) => out.u32(1).put(typ).u64(body.len() as u64 + 16),
    };
    out.put(body);
    out
}

/// A full box: version and flags, then `body`.
pub fn full(typ: &[u8; 4], version: u8, flags: u32, body: &[u8]) -> Vec<u8> {
    let mut b = Vec::with_capacity(body.len() + 4);
    b.u32((version as u32) << 24 | flags).put(body);
    bx(typ, &b)
}

/// `v` ticks of `from` per second in ticks of `to`, rounded.
pub fn rescale(v: u64, from: u32, to: u32) -> u64 {
    if from == 0 {
        return 0;
    }
    ((v as u128 * to as u128 + from as u128 / 2) / from as u128) as u64
}
