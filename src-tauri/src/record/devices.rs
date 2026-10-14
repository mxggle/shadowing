//! Which microphone records. Normally the system's default; but a Bluetooth
//! headset (AirPods) drops to call quality the moment its mic opens, and the
//! original would sound like a phone call while you practise. So with one, the
//! Mac's own microphone records instead (it can't hear the earphones: no echo
//! either) and the headset keeps playing in full quality.

#[cfg(target_os = "macos")]
mod mac {
    use coreaudio::audio_unit::macos_helpers::{
        get_audio_device_ids_for_scope, get_default_device_id, get_device_name,
    };
    use coreaudio::audio_unit::Scope;
    use objc2_core_audio::{
        kAudioDevicePropertyTransportType, kAudioDeviceTransportTypeBluetooth,
        kAudioDeviceTransportTypeBluetoothLE, kAudioDeviceTransportTypeBuiltIn,
        kAudioObjectPropertyElementMain, kAudioObjectPropertyScopeGlobal,
        AudioObjectGetPropertyData, AudioObjectPropertyAddress,
    };
    use std::ptr::{null, NonNull};

    fn transport(device: u32) -> Option<u32> {
        let address = AudioObjectPropertyAddress {
            mSelector: kAudioDevicePropertyTransportType,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain,
        };
        let mut value: u32 = 0;
        let size = std::mem::size_of::<u32>() as u32;
        // SAFETY: a plain u32 property; every pointer is to a live local of the right size.
        let status = unsafe {
            AudioObjectGetPropertyData(
                device,
                NonNull::from(&address),
                0,
                null(),
                NonNull::from(&size),
                NonNull::from(&mut value).cast(),
            )
        };
        (status == 0).then_some(value)
    }

    fn bluetooth(device: u32) -> bool {
        let kinds = [
            kAudioDeviceTransportTypeBluetooth,
            kAudioDeviceTransportTypeBluetoothLE,
        ];
        transport(device).is_some_and(|t| kinds.contains(&t))
    }

    /// The default output is Bluetooth earphones (their delay isn't reported reliably).
    pub fn bluetooth_output() -> bool {
        get_default_device_id(false).is_some_and(bluetooth)
    }

    /// The built-in microphone's name, when the default input is a Bluetooth headset.
    pub fn instead_of_headset() -> Option<String> {
        let default = get_default_device_id(true)?;
        if !bluetooth(default) {
            return None;
        }
        let built_in = get_audio_device_ids_for_scope(Scope::Input)
            .ok()?
            .into_iter()
            .find(|&id| transport(id) == Some(kAudioDeviceTransportTypeBuiltIn))?;
        get_device_name(built_in).ok()
    }
}

/// Name of the microphone to use instead of the default, if any.
pub fn preferred_input() -> Option<String> {
    if let Ok(name) = std::env::var("SHADOWING_INPUT_DEVICE") {
        return Some(name); // manual tests
    }
    #[cfg(target_os = "macos")]
    return mac::instead_of_headset();
    #[cfg(not(target_os = "macos"))]
    None
}

/// Whether the original plays through Bluetooth earphones: they add a delay of
/// their own (0.1–0.3 s) that isn't measured, so how far behind you shadowed
/// can't be told.
pub fn bluetooth_output() -> bool {
    #[cfg(target_os = "macos")]
    return std::env::var("SHADOWING_OUTPUT_DEVICE").is_err() && mac::bluetooth_output();
    #[cfg(not(target_os = "macos"))]
    false
}
