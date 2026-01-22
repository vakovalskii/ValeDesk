import { ipcMain, WebContents, WebFrameMain } from "electron";
import { getUIPath } from "./pathResolver.js";
import { pathToFileURL } from "url";
export const DEV_PORT = 5173;

// Checks if you are in development mode
export function isDev(): boolean {
    return process.env.NODE_ENV == "development";
}

// Making IPC Typesafe
export function ipcMainHandle<Key extends keyof EventPayloadMapping>(key: Key, handler: (...args: any[]) => EventPayloadMapping[Key] | Promise<EventPayloadMapping[Key]>) {
    ipcMain.handle(key, (event, ...args) => {
        if (event.senderFrame) validateEventFrame(event.senderFrame);

        return handler(event, ...args)
    });
}

export function ipcWebContentsSend<Key extends keyof EventPayloadMapping>(key: Key, webContents: WebContents, payload: EventPayloadMapping[Key]) {
    webContents.send(key, payload);
}

export function validateEventFrame(frame: WebFrameMain) {
    if (isDev() && new URL(frame.url).host === `localhost:${DEV_PORT}`) return;

    // Normalize URLs for comparison:
    // - Windows paths may have different case for drive letter (C: vs c:)
    // - Cyrillic usernames may be encoded differently (percent-encoding vs decoded)
    try {
        const expectedUrl = new URL(pathToFileURL(getUIPath()).toString());
        const actualUrl = new URL(frame.url);
        
        // Compare decoded pathnames (handles Cyrillic and other non-ASCII chars)
        const expectedPath = decodeURIComponent(expectedUrl.pathname).toLowerCase();
        const actualPath = decodeURIComponent(actualUrl.pathname).toLowerCase();
        
        // Also check protocol
        if (actualUrl.protocol !== expectedUrl.protocol || actualPath !== expectedPath) {
            console.error('[Security] Frame URL mismatch:', { 
                actual: frame.url, 
                expected: pathToFileURL(getUIPath()).toString(),
                actualPath,
                expectedPath
            });
            throw new Error("Malicious event");
        }
    } catch (e) {
        console.error('[Security] URL validation error:', e);
        throw new Error("Malicious event");
    }
}
