import { isDev } from "./util.js"
import path from "path"
import { app } from "electron"

export function getPreloadPath() {
    return path.join(
        app.getAppPath(),
        isDev() ? './' : '../',
        '/dist-electron/preload.cjs'
    )
}

export function getUIPath() {
    return path.join(app.getAppPath(), '/dist-react/index.html');
}

export function getIconPath() {
    return path.join(
        app.getAppPath(),
        isDev() ? './' : '../',
        '/templateIcon.png'
    )
}