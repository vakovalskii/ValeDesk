// External module declarations
declare module 'pdf-parse';
declare module 'mammoth';

type Statistics = {
    cpuUsage: number;
    ramUsage: number;
    storageData: number;
}

type StaticData = {
    totalStorage: number;
    cpuModel: string;
    totalMemoryGB: number;
}

type UnsubscribeFunction = () => void;

type BuildInfo = {
    version: string;
    commit: string;
    commitShort: string;
    buildTime: string;
}

type FileItem = {
    name: string;
    path: string;
    isDirectory: boolean;
    size?: number;
}

type EventPayloadMapping = {
    statistics: Statistics;
    getStaticData: StaticData;
    "generate-session-title": string;
    "get-recent-cwds": string[];
    "select-directory": string | null;
    "list-directory": FileItem[];
    "open-path-in-finder": { success: boolean; error?: string };
    "read-memory": string;
    "write-memory": void;
    "get-build-info": BuildInfo;
    "open-external-url": { success: boolean; error?: string };
    "get-file-old-content": string;
    "get-file-new-content": string;
}

interface Window {
    electron: {
        subscribeStatistics: (callback: (statistics: Statistics) => void) => UnsubscribeFunction;
        getStaticData: () => Promise<StaticData>;
        // Claude Agent IPC APIs
        sendClientEvent: (event: any) => void;
        onServerEvent: (callback: (event: any) => void) => UnsubscribeFunction;
        generateSessionTitle: (userInput: string | null) => Promise<string>;
        getRecentCwds: (limit?: number) => Promise<string[]>;
        selectDirectory: () => Promise<string | null>;
        // File browser APIs
        invoke: (channel: string, ...args: any[]) => Promise<any>;
        send: (channel: string, ...args: any[]) => void;
    }
}
