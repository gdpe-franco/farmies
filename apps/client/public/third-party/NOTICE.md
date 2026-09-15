# MediaPipe face detector

`blaze-face-short-range.tflite` is Google's BlazeFace short-range float16 model, version 1, under Apache-2.0 (see `mediapipe-LICENSE`).

Source: https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite

Model card: https://storage.googleapis.com/mediapipe-assets/MediaPipe%20BlazeFace%20Model%20Card%20(Short%20Range).pdf

Runtime/WASM assets come from the pinned `@mediapipe/tasks-vision` dependency and are served with the app, not from a CDN. Photos and detection results stay on the device; this is not identity recognition.
