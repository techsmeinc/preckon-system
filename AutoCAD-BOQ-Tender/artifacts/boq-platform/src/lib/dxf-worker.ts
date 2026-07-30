// Web worker that offloads DXF parsing/scene-building off the main thread so
// large drawings don't freeze the UI. dxf-viewer ships the worker entrypoint;
// SetupWorker() wires its message handler to `self`.
import { DxfViewer } from "dxf-viewer";

DxfViewer.SetupWorker();
