// The preload script: exposes only `window.aw` to the sandboxed renderer.
import { contextBridge, ipcRenderer } from "electron";
import { createBridge } from "./bridge.ts";

contextBridge.exposeInMainWorld("aw", createBridge(ipcRenderer));
