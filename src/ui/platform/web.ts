import type { PlatformAdapter } from "./types";

export function createWebPlatform(): PlatformAdapter {
    return {
        sendClientEvent: (event) => {
            console.log("[web-platform] sendClientEvent", event);
        },

        onServerEvent: (callback) => {
            console.log("[web-platform] onServerEvent listener registered");
            // For testing, we could manually invoke this callback from console
            (window as any).__web_emitServerEvent = callback;
            return () => {
                console.log("[web-platform] onServerEvent disabled");
            };
        },

        generateSessionTitle: async (_userInput) => {
            return "Web Session";
        },

        getRecentCwds: async (_limit) => {
            return [];
        },

        selectDirectory: async () => {
            const mockPath = "/mock/web/path";
            console.log("[web-platform] selectDirectory - returning mock path:", mockPath);
            return mockPath;
        },

        invoke: async <TResult = unknown>(channel: string, ...args: unknown[]): Promise<TResult> => {
            console.log(`[web-platform] invoke "${channel}"`, args);

            // Mock specific responses if needed
            if (channel === "get-build-info") {
                return {
                    version: "0.0.0-web",
                    commit: "web-dev",
                    date: new Date().toISOString(),
                    platform: "web"
                } as TResult;
            }

            if (channel === "list-directory") {
                return [
                    { name: "mock-file.txt", isDir: false, sizeBytes: "123" },
                    { name: "mock-folder", isDir: true }
                ] as TResult;
            }

            return null as TResult;
        },

        send: (channel, ...args) => {
            console.log(`[web-platform] send "${channel}"`, args);
        },
    };
}
