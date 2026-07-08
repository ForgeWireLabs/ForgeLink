# Android Mobile Runtime Persistence APK Smoke - 2026-07-08

## Summary

This report records the Android APK smoke validation after commit ecca58a.

Commit under test:

    ecca58a Persist Android mobile runtime metadata locally

Purpose:

    Confirm that Android mobile-local runtime persistence still builds into the Tauri Android APK and still launches on the physical Moto One Hyper.

## Results

Repo audit and Electron suite were green during push of ecca58a:

    ForgeLink audit passed.
    tests 200
    pass 199
    fail 0
    skipped 1

Tauri Rust tests passed locally:

    running 7 tests
    test result: ok. 7 passed; 0 failed

Android APK build passed:

    Finished 1 APK at:
    C:\Projects\ForgeLink\Tauri\src-tauri\gen\android\app\build\outputs\apk\universal\release\app-universal-release-unsigned.apk

APK install succeeded:

    adb install -r -d $Signed
    Success

APK launch succeeded:

    adb shell monkey -p com.forgewire.forgelink 1
    Events injected: 1

Final repo state was clean after generated renderer output was restored.

## Runtime Meaning

This validates that the Android full-cockpit runtime can still be packaged, installed, and launched after adding local mobile runtime persistence for attention policy state and agent channel metadata.

No token files or secret values are persisted by this slice.

## Notes

The APK build emitted Gradle deprecation warnings for future Gradle 9.0 compatibility. These warnings did not block the build.