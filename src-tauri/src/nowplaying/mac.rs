//! macOS: MPRemoteCommandCenter for the buttons, MPNowPlayingInfoCenter for what Control Center
//! shows. The sound goes out through Core Audio, not AVFoundation, so macOS can't tell the app is
//! playing: `playbackState` has to say so every time, or the keys go to another app.

use super::{press, Button, Playing};
use block2::RcBlock;
use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2_foundation::{NSDictionary, NSNumber, NSString};
use objc2_media_player::{
    MPMediaItemPropertyArtist, MPMediaItemPropertyPlaybackDuration, MPMediaItemPropertyTitle,
    MPNowPlayingInfoCenter, MPNowPlayingInfoMediaType, MPNowPlayingInfoPropertyElapsedPlaybackTime,
    MPNowPlayingInfoPropertyMediaType, MPNowPlayingInfoPropertyPlaybackRate,
    MPNowPlayingPlaybackState, MPRemoteCommand, MPRemoteCommandCenter, MPRemoteCommandEvent,
    MPRemoteCommandHandlerStatus,
};
use std::cell::RefCell;
use std::ptr::NonNull;
use tauri::AppHandle;

type Target = (Retained<MPRemoteCommand>, Retained<AnyObject>);

thread_local! {
    /// The commands answered, to let go of them again (only touched on the main thread).
    static TARGETS: RefCell<Vec<Target>> = const { RefCell::new(Vec::new()) };
}

pub fn show(app: &AppHandle, playing: Option<&Playing>) {
    // SAFETY (here and below): MediaPlayer's documented API, on the main thread (`now_playing`),
    // with the value types its keys take.
    let center = unsafe { MPNowPlayingInfoCenter::defaultCenter() };
    TARGETS.with_borrow_mut(|targets| match playing {
        Some(p) => {
            if targets.is_empty() {
                *targets = answer(app);
            }
            let state = if p.playing {
                MPNowPlayingPlaybackState::Playing
            } else {
                MPNowPlayingPlaybackState::Paused
            };
            unsafe {
                center.setNowPlayingInfo(Some(&info(p)));
                center.setPlaybackState(state);
            }
        }
        None => {
            for (command, target) in targets.drain(..) {
                unsafe { command.removeTarget(Some(&target)) };
            }
            unsafe {
                center.setNowPlayingInfo(None);
                center.setPlaybackState(MPNowPlayingPlaybackState::Stopped);
            }
        }
    });
}

/// ⏯ (the keyboard's key, AirPods pressed once), play and pause on their own (Control Center,
/// some headsets), ⏭ (twice) and ⏮ (three times).
fn answer(app: &AppHandle) -> Vec<Target> {
    let commands = unsafe { MPRemoteCommandCenter::sharedCommandCenter() };
    let buttons = unsafe {
        [
            (commands.togglePlayPauseCommand(), Button::Toggle),
            (commands.playCommand(), Button::Play),
            (commands.pauseCommand(), Button::Pause),
            (commands.nextTrackCommand(), Button::Next),
            (commands.previousTrackCommand(), Button::Previous),
        ]
    };
    buttons
        .into_iter()
        .map(|(command, button)| {
            let app = app.clone();
            let handler = RcBlock::new(move |_: NonNull<MPRemoteCommandEvent>| {
                press(&app, button);
                MPRemoteCommandHandlerStatus::Success
            });
            let target = unsafe {
                command.setEnabled(true);
                command.addTargetWithHandler(&handler)
            };
            (command, target)
        })
        .collect()
}

fn info(p: &Playing) -> Retained<NSDictionary<NSString, AnyObject>> {
    let title = NSString::from_str(&p.title);
    let artist = NSString::from_str(&p.artist);
    let duration = NSNumber::new_f64(p.duration);
    let elapsed = NSNumber::new_f64(p.position);
    let rate = NSNumber::new_f64(p.rate);
    let audio = NSNumber::new_usize(MPNowPlayingInfoMediaType::Audio.0);
    let keys = unsafe {
        [
            MPMediaItemPropertyTitle,
            MPMediaItemPropertyArtist,
            MPMediaItemPropertyPlaybackDuration,
            MPNowPlayingInfoPropertyElapsedPlaybackTime,
            MPNowPlayingInfoPropertyPlaybackRate,
            MPNowPlayingInfoPropertyMediaType,
        ]
    };
    let values: [&AnyObject; 6] = [&title, &artist, &duration, &elapsed, &rate, &audio];
    NSDictionary::from_slices(&keys, &values)
}
