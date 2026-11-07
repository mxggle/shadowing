//! Tests for folders.rs.

use super::*;

fn paths(list: &[KnownFolder]) -> Vec<&str> {
    list.iter().map(|f| f.path.to_str().unwrap()).collect()
}

fn opened(names: &[&str]) -> Vec<KnownFolder> {
    let mut list = Vec::new();
    for name in names {
        remember(&mut list, Path::new(name));
    }
    list
}

#[test]
fn opening_puts_a_folder_first_and_keeps_the_last_few() {
    let mut list = opened(&["/a", "/b", "/c"]);
    assert_eq!(paths(&list), ["/c", "/b", "/a"]);
    remember(&mut list, Path::new("/a"));
    assert_eq!(paths(&list), ["/a", "/c", "/b"]);

    let many: Vec<String> = (0..10).map(|i| format!("/m{i}")).collect();
    let list = opened(&many.iter().map(String::as_str).collect::<Vec<_>>());
    assert_eq!(list.len(), RECENT_MAX);
    assert_eq!(list[0].path, Path::new("/m9"));
    assert!(!list.iter().any(|f| f.path == Path::new("/m0")));
}

#[test]
fn pinned_folders_are_kept_and_shown_first_in_the_order_pinned() {
    let mut list = opened(&["/old", "/b", "/c"]);
    pin(&mut list, Path::new("/c"), true);
    pin(&mut list, Path::new("/old"), true);
    pin(&mut list, Path::new("/c"), true); // pinning again keeps its place
    for i in 0..10 {
        remember(&mut list, &PathBuf::from(format!("/n{i}")));
    }
    assert!(list.iter().any(|f| f.path == Path::new("/old")));
    let shown = entries(&list, Some(Path::new("/n9")), |_| true);
    let names: Vec<&str> = shown.iter().map(|e| e.path.as_str()).collect();
    assert_eq!(&names[..3], ["/c", "/old", "/n9"]);
    assert_eq!(names.len(), 2 + RECENT_MAX);
    assert!(shown[0].pinned && !shown[2].pinned);
    assert!(shown[2].current && !shown[0].current);
    assert_eq!(shown[2].recency, 0);

    pin(&mut list, Path::new("/c"), false);
    let shown = entries(&list, None, |_| true);
    assert_eq!(shown[0].path, "/old");
    assert!(shown.iter().any(|e| e.path == "/c" && !e.pinned));
}

#[test]
fn each_folder_comes_back_to_its_own_track() {
    let mut list = opened(&["/a"]);
    left_at(&mut list, Some(Path::new("/a")), Some("/a/1.mp3".into()));
    assert_eq!(remember(&mut list, Path::new("/b")), None);
    left_at(&mut list, Some(Path::new("/b")), Some("/b/2.mp3".into()));
    assert_eq!(
        remember(&mut list, Path::new("/a")).as_deref(),
        Some("/a/1.mp3")
    );
    assert_eq!(
        remember(&mut list, Path::new("/b")).as_deref(),
        Some("/b/2.mp3")
    );
}

#[test]
fn the_open_folder_cannot_be_forgotten() {
    let mut list = opened(&["/a", "/b"]);
    forget(&mut list, Path::new("/b"), Some(Path::new("/b")));
    assert_eq!(paths(&list), ["/b", "/a"]);
    forget(&mut list, Path::new("/a"), Some(Path::new("/b")));
    assert_eq!(paths(&list), ["/b"]);
}

#[test]
fn state_from_before_the_list_starts_it_with_the_open_folder() {
    let mut data: Persisted =
        serde_json::from_str(r#"{"folder":"/music/日本語","lastTrack":"/music/日本語/1.mp3"}"#)
            .unwrap();
    seed(&mut data);
    seed(&mut data);
    assert_eq!(data.folders.len(), 1);
    assert_eq!(data.folders[0].path, Path::new("/music/日本語"));
    assert_eq!(
        data.folders[0].last_track.as_deref(),
        Some("/music/日本語/1.mp3")
    );
    let json = serde_json::to_string(&data.folders).unwrap();
    assert!(!json.contains("pin"), "{json}");
}

#[test]
fn missing_folders_are_marked() {
    let list = opened(&["/gone", "/here"]);
    let shown = entries(&list, Some(Path::new("/here")), |p| p == Path::new("/here"));
    assert_eq!(
        shown.iter().map(|e| e.missing).collect::<Vec<_>>(),
        [false, true]
    );
}

#[test]
fn places_are_short() {
    let home = Some(Path::new("/Users/me"));
    assert_eq!(
        place(Path::new("/Users/me/Documents/日语/新标日"), home),
        "~/Documents/日语"
    );
    assert_eq!(place(Path::new("/Users/me/Music"), home), "~");
    assert_eq!(place(Path::new("/Volumes/U盘/课程"), home), "/Volumes/U盘");
    let icloud = "/Users/me/Library/Mobile Documents/com~apple~CloudDocs";
    let in_icloud = place(&Path::new(icloud).join("日语/听力"), home);
    assert!(in_icloud.ends_with("/日语"), "{in_icloud}");
    assert!(!in_icloud.contains("Mobile Documents"), "{in_icloud}");
    assert_eq!(place(Path::new("/srv/audio"), None), "/srv");
}
